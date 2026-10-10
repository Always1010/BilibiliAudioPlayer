import { MESSAGE, STORAGE_KEYS, UPDATE_ALARM } from "../shared/constants.js";
import {
  clearPlaybackHistory,
  deletePlaybackCheckpoint,
  getAppState,
  initializeStorage,
  savePlayerState,
  saveSettings,
  updateStorageValue
} from "../shared/storage.js";
import {
  getCreator,
  getVideoInfo,
  getLoginStatus,
  listAllCreatorContainers,
  listContainerVideos,
  listCreatorVideos,
  resolveAudioStream,
  searchCreators
} from "../services/bilibili.js";
import { toErrorMessage } from "../shared/utils.js";
import { configureBilibiliAudioRequestRules } from "../services/cdn-request-rules.js";
import {
  addTracksToPlaylist,
  createPlaylist,
  deletePlaylist,
  normalizePlaylists,
  removeTrackFromPlaylist,
  renamePlaylist,
  reorderPlaylistTrack
} from "../services/playlists.js";
import { mergePlaylistDurations, repairPlaylistDurations } from "../services/playlists.js";
import { mergeImportedPlaylists } from "../services/playlist-transfer.js";
import { favoriteSectionMetadata } from "../services/favorite-section-metadata.js";
import {
  addFavoriteSection,
  normalizeFavoriteSections,
  removeFavoriteSection
} from "../services/favorite-sections.js";
import { actionLaunchConfiguration } from "../services/action-launch.js";
import { loadSubscriptionVideos, mergeSubscriptionCheckResults, subscriptionIsCurrent } from "../services/subscriptions.js";
import { autoCacheJobIsCurrent, cacheOutcomeKeys, createAutoCacheJobs, failedAutoCacheJob } from "../services/auto-cache-jobs.js";

const OFFSCREEN_URL = "offscreen/offscreen.html";
let creatingOffscreen = null;
let playerSaveChain = Promise.resolve();
let checkingCreators = null;
let dispatchingAutoCache = null;

async function configureExtension() {
  await Promise.all([
    initializeStorage(),
    configureBilibiliAudioRequestRules()
  ]);
  const { settings } = await getAppState();
  await configureActionLaunch(settings.actionLaunchMode);
  await chrome.alarms.create(UPDATE_ALARM, {
    periodInMinutes: Math.max(30, settings.updateIntervalMinutes)
  });
}

async function configureActionLaunch(mode) {
  const configuration = actionLaunchConfiguration(mode);
  await Promise.all([
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: configuration.opensSidePanel }),
    chrome.action.setTitle({ title: configuration.title })
  ]);
}

chrome.runtime.onInstalled.addListener(() => {
  configureExtension().then(dispatchAutoCacheJobs).catch(console.error);
});

chrome.runtime.onStartup.addListener(() => {
  configureExtension()
    .then(async () => {
      await dispatchAutoCacheJobs();
      const { settings } = await getAppState();
      if (settings.checkUpdatesOnStartup) await checkAllCreators();
    })
    .catch(console.error);
});

chrome.action.onClicked.addListener(() => {
  getAppState()
    .then(({ settings }) => {
      const configuration = actionLaunchConfiguration(settings.actionLaunchMode);
      if (configuration.mode === "page") {
        return chrome.tabs.create({ url: chrome.runtime.getURL("player.html") });
      }
      return undefined;
    })
    .catch(console.error);
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === UPDATE_ALARM) checkAllCreators().catch(console.error);
});

async function ensureOffscreenDocument() {
  const absoluteUrl = chrome.runtime.getURL(OFFSCREEN_URL);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [absoluteUrl]
  });
  if (contexts.length) return false;
  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: ["AUDIO_PLAYBACK", "BLOBS", "WORKERS"],
      justification: "后台播放哔哩哔哩音频，并为本地缓存处理音频数据"
    }).finally(() => {
      creatingOffscreen = null;
    });
  }
  await creatingOffscreen;
  return true;
}

async function appStateWithLivePlayer() {
  const appState = await getAppState();
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)]
  });
  if (!contexts.length) {
    appState.player = { ...appState.player, playing: false, loading: false, source: null };
    return appState;
  }
  try {
    const response = await chrome.runtime.sendMessage({
      type: MESSAGE.playerCommand,
      command: "status",
      target: "offscreen"
    });
    if (response?.ok && response.data?.hydrated) {
      const { hydrated: _, ...livePlayer } = response.data;
      appState.player = { ...appState.player, ...livePlayer };
    } else {
      appState.player = { ...appState.player, playing: false, loading: false, source: null };
    }
  } catch {}
  return appState;
}

function savePlayerEvent(player) {
  const task = playerSaveChain.then(() => savePlayerState(player));
  playerSaveChain = task.catch(() => {});
  return task;
}

async function addCreator(creatorLike) {
  const creator = creatorLike.name ? creatorLike : await getCreator(creatorLike.id);
  const creators = await updateStorageValue(STORAGE_KEYS.creators, current => {
    const list = Array.isArray(current) ? current : [];
    const existing = list.find(item => String(item.id) === String(creator.id));
    return existing
      ? list.map(item => String(item.id) === String(creator.id) ? { ...item, ...creator } : item)
      : [...list, { ...creator, addedAt: Date.now() }];
  });
  await saveSettings({ activeCreatorId: String(creator.id) });
  return { creator, creators };
}

async function removeCreator(id) {
  const creators = await updateStorageValue(STORAGE_KEYS.creators, current =>
    (current ?? []).filter(item => String(item.id) !== String(id))
  );
  await updateStorageValue(STORAGE_KEYS.creatorContent, current => {
    const next = { ...(current ?? {}) };
    delete next[id];
    return next;
  });
  const { settings } = await getAppState();
  if (String(settings.activeCreatorId) === String(id)) {
    await saveSettings({ activeCreatorId: creators[0]?.id ?? null });
  }
  return creators;
}

async function loadCreator(id, force = false) {
  const state = await getAppState();
  const cached = state.creatorContent[id];
  const cachedPreviewItems = [
    ...(cached?.all?.items ?? []),
    ...(cached?.containers?.seasons ?? []).flatMap(item => item.preview ?? []),
    ...(cached?.containers?.series ?? []).flatMap(item => item.preview ?? [])
  ];
  const cachedPreviewHasMissingDurations = cachedPreviewItems.some(item => Number(item.duration) <= 0);
  if (!force && cached && !cachedPreviewHasMissingDurations && Date.now() - cached.loadedAt < 10 * 60 * 1000) return cached;

  const knownCreator = state.creators.find(item => String(item.id) === String(id));
  const results = await Promise.allSettled([
    getCreator(id),
    listCreatorVideos(id, 1, 30),
    listAllCreatorContainers(id, 20),
    getLoginStatus()
  ]);

  const requiredFailures = results.slice(1, 3).filter(result => result.status === "rejected");
  if (requiredFailures.length === 2 && !cached) throw requiredFailures[0].reason;

  const creator = results[0].status === "fulfilled" ? results[0].value : knownCreator;
  const all = results[1].status === "fulfilled" ? results[1].value : cached?.all ?? { items: [], total: 0, page: 1 };
  const containers = results[2].status === "fulfilled" ? results[2].value : cached?.containers ?? { seasons: [], series: [] };
  const login = results[3].status === "fulfilled" ? results[3].value : { isLoggedIn: false };
  const content = {
    creator,
    all,
    containers,
    login,
    loadedAt: Date.now(),
    warnings: results
      .map((result, index) => {
        if (result.status !== "rejected") return null;
        const label = ["UP 主资料", "全部作品", "合集与系列", "登录状态"][index];
        const code = result.reason?.code;
        const details = toErrorMessage(result.reason);
        return `${label}（${code == null ? details : `${code}: ${details}`}）`;
      })
      .filter(Boolean)
  };

  await updateStorageValue(STORAGE_KEYS.creatorContent, current => ({
    ...(current ?? {}),
    [id]: content
  }));
  if (creator) {
    await updateStorageValue(STORAGE_KEYS.creators, current => (current ?? []).map(item =>
      String(item.id) === String(id) ? { ...item, ...creator } : item
    ));
  }
  return content;
}

async function loadSection({ creatorId, section, page = 1, pageSize = 30 }) {
  if (section.type === "all") return listCreatorVideos(creatorId, page, pageSize);
  return listContainerVideos(creatorId, section.type, section.id, page, pageSize);
}

function checkAllCreators() {
  if (!checkingCreators) {
    checkingCreators = checkCreators().finally(() => { checkingCreators = null; });
  }
  return checkingCreators;
}

async function checkCreators() {
  const state = await getAppState();
  const results = {};
  const subscriptionUpdates = {};
  for (const creator of state.creators) {
    try {
      const latest = await listCreatorVideos(creator.id, 1, 10);
      const knownIds = new Set((state.creatorContent[creator.id]?.all?.items ?? []).map(item => item.id));
      const newItems = latest.items.filter(item => !knownIds.has(item.id));
      results[creator.id] = {
        checkedAt: Date.now(),
        newCount: newItems.length,
        newItems
      };
    } catch (error) {
      results[creator.id] = {
        checkedAt: Date.now(), newCount: 0, error: toErrorMessage(error)
      };
    }
    const creatorSubscriptions = Object.entries(state.subscriptions)
      .filter(([, subscription]) => String(subscription.creatorId) === String(creator.id) && subscription.enabled);
    for (const [key, subscription] of creatorSubscriptions) {
      try {
        if (!subscriptionIsCurrent((await getAppState()).subscriptions[key], subscription)) continue;
        const listing = await loadSubscriptionVideos(subscription, loadSection);
        const known = new Set(subscription.lastSeenIds ?? []);
        const needsBaseline = subscription.baselinePending || subscription.baselineVersion !== 2;
        const newItems = needsBaseline ? [] : listing.items.filter(item => !known.has(String(item.id)));
        let accepted = newItems.length === 0 || subscription.mode !== "download";
        if (newItems.length && subscription.mode === "download") {
          if (!subscriptionIsCurrent((await getAppState()).subscriptions[key], subscription)) continue;
          const tracks = newItems.map(track => ({ ...track, creator: { id: creator.id, name: creator.name }, sectionTitle: subscription.section.title }));
          const jobs = createAutoCacheJobs(key, subscription, tracks, state.settings);
          await updateStorageValue(STORAGE_KEYS.autoCacheJobs, current => {
            const next = { ...(current ?? {}) };
            for (const job of jobs) next[job.key] ??= job;
            return next;
          });
          // Persist work before advancing discovery; queue acceptance is not completion.
          accepted = true;
        }
        subscriptionUpdates[key] = { subscription, patch: {
          lastCheckedAt: Date.now(),
          baselinePending: false,
          baselineVersion: 2,
          lastError: accepted ? null : "缓存目录不可用，新作品已保留待下次检查",
          lastSeenIds: accepted ? listing.items.map(item => String(item.id)) : subscription.lastSeenIds
        } };
      } catch (error) {
        subscriptionUpdates[key] = { subscription, patch: { lastCheckedAt: Date.now(), lastError: toErrorMessage(error) } };
      }
    }
  }
  await updateStorageValue(STORAGE_KEYS.updateState, current => ({ ...(current ?? {}), ...results }));
  await updateStorageValue(STORAGE_KEYS.subscriptions, async current => {
    const { autoCacheJobs = {} } = await getAppState();
    for (const [key, update] of Object.entries(subscriptionUpdates)) {
      if (update.patch.lastError === null) {
        update.patch.lastError = Object.values(autoCacheJobs).find(job => job.subscriptionKey === key
          && autoCacheJobIsCurrent(job, current) && job.status === "failed")?.lastError ?? null;
      }
    }
    return mergeSubscriptionCheckResults(current, subscriptionUpdates);
  });
  await dispatchAutoCacheJobs();
  return results;
}

async function applyAutoCacheOutcome(cache) {
  const status = cache?.status ?? cache?.activity?.status;
  if (!["completed", "skipped", "failed"].includes(status)) return;
  const keys = cacheOutcomeKeys(cache);
  if (!keys.length) return;
  const state = await getAppState();
  const updates = {};
  await updateStorageValue(STORAGE_KEYS.autoCacheJobs, current => {
    const next = { ...(current ?? {}) };
    for (const key of keys) {
      const job = next[key];
      if (!job) continue;
      const request = cache.autoCacheRequests?.find(item => item.key === key);
      if (request && request.attemptId !== job.attemptId) continue;
      if (cache.rootId && job.rootId && cache.rootId !== job.rootId) continue;
      if (cache.outcomeId && cache.outcomeId === job.lastOutcomeId) continue;
      if (autoCacheJobIsCurrent(job, state.subscriptions)) {
        const lastError = status === "failed" ? cache.message || cache.activity?.message || "自动缓存失败，稍后重试" : null;
        updates[job.subscriptionKey] = { subscription: job.subscription, patch: { lastError } };
      }
      if (status === "failed") next[key] = { ...failedAutoCacheJob(job, cache.message || cache.activity?.message), lastOutcomeId: cache.outcomeId };
      else delete next[key];
    }
    for (const [subscriptionKey, update] of Object.entries(updates)) {
      const remainingFailure = Object.values(next).find(job => job.subscriptionKey === subscriptionKey
        && autoCacheJobIsCurrent(job, state.subscriptions) && job.status === "failed");
      if (remainingFailure) update.patch.lastError = remainingFailure.lastError;
    }
    return next;
  });
  await updateStorageValue(STORAGE_KEYS.subscriptions, current => mergeSubscriptionCheckResults(current, updates));
}

function dispatchAutoCacheJobs() {
  if (!dispatchingAutoCache) {
    dispatchingAutoCache = dispatchPendingAutoCacheJobs().finally(() => { dispatchingAutoCache = null; });
  }
  return dispatchingAutoCache;
}

async function dispatchPendingAutoCacheJobs() {
  const jobs = await updateStorageValue(STORAGE_KEYS.autoCacheJobs, async current => {
    const { subscriptions } = await getAppState();
    return Object.fromEntries(Object.entries(current ?? {}).filter(([, job]) => autoCacheJobIsCurrent(job, subscriptions)));
  });
  if (!Object.keys(jobs).length) return;
  let snapshot;
  try {
    await ensureOffscreenDocument();
    const response = await chrome.runtime.sendMessage({ type: MESSAGE.cacheCommand, command: "status", target: "offscreen" });
    if (!response?.ok) throw new Error(response?.error || "无法读取自动缓存队列");
    snapshot = response.data;
  } catch (error) {
    snapshot = { unavailable: toErrorMessage(error) };
  }
  // Reconcile retained terminal history after a worker restart or missed event.
  for (const outcome of [...(snapshot?.recent ?? [])].reverse()) await applyAutoCacheOutcome(outcome);
  const activeKeys = new Set([snapshot?.current, ...(snapshot?.pending ?? [])].flatMap(task => task?.autoCacheKeys ?? []));
  for (const [key, initial] of Object.entries(jobs)) {
    const latest = await getAppState();
    const job = latest.autoCacheJobs?.[key];
    if (!job || !autoCacheJobIsCurrent(job, latest.subscriptions) || activeKeys.has(key) || job.nextRetryAt > Date.now()) continue;
    try {
      if (snapshot?.unavailable) throw new Error(snapshot.unavailable);
      if (snapshot?.directory?.permission !== "granted" || !snapshot.directory.rootId) throw new Error("缓存目录不可用，任务已保留待重试");
      const attemptId = crypto.randomUUID();
      await updateStorageValue(STORAGE_KEYS.autoCacheJobs, current => {
        const next = { ...(current ?? {}) };
        if (next[key]) next[key] = { ...next[key], status: "dispatching", attemptId, rootId: snapshot.directory.rootId, updatedAt: Date.now() };
        return next;
      });
      // Re-read immediately before dispatch to respect disable/reconfigure during awaits.
      const beforeSend = await getAppState();
      if (!autoCacheJobIsCurrent(initial, beforeSend.subscriptions) || !beforeSend.autoCacheJobs?.[key]) continue;
      const response = await chrome.runtime.sendMessage({
        type: MESSAGE.cacheCommand, command: "cacheTracks", target: "offscreen",
        payload: { tracks: [job.track], section: job.section, format: job.format, bitrate: job.bitrate,
          rootId: snapshot.directory.rootId, autoCache: { key, attemptId } }
      });
      if (!response?.ok || response.data?.accepted !== true) throw new Error(response?.error || "自动缓存任务未被接收");
      await updateStorageValue(STORAGE_KEYS.autoCacheJobs, current => {
        const next = { ...(current ?? {}) };
        // A terminal event can arrive before the command acknowledgement.
        if (next[key]?.status === "dispatching") next[key] = { ...next[key], status: "queued", updatedAt: Date.now() };
        return next;
      });
    } catch (error) {
      const current = (await getAppState()).autoCacheJobs?.[key];
      if (current && current.status !== "failed") {
        await applyAutoCacheOutcome({ status: "failed", autoCacheKeys: [key], message: toErrorMessage(error) });
      } else if (current && current.attemptId === job.attemptId) {
        await applyAutoCacheOutcome({ status: "failed", autoCacheKeys: [key], message: toErrorMessage(error) });
      }
    }
  }
}

async function setSubscription({ creatorId, section, enabled, mode = "download" }) {
  const key = `${creatorId}:${section.key ?? `${section.type}:${section.id}`}`;
  let subscriptions = await updateStorageValue(STORAGE_KEYS.subscriptions, current => {
    const next = { ...(current ?? {}) };
    if (!enabled) delete next[key];
    else {
      next[key] = {
        creatorId: String(creatorId),
        section: {
          id: String(section.id),
          key: section.key,
          type: section.type,
          title: section.title
        },
        enabled: true,
        revision: crypto.randomUUID(),
        mode,
        lastSeenIds: [],
        baselinePending: true,
        baselineVersion: 2,
        createdAt: next[key]?.createdAt ?? Date.now(),
        lastCheckedAt: next[key]?.lastCheckedAt ?? null,
        lastError: null
      };
    }
    return next;
  });
  if (enabled) {
    const subscription = subscriptions[key];
    let patch;
    try {
      const listing = await loadSubscriptionVideos(subscription, loadSection);
      patch = { baselinePending: false, baselineVersion: 2, lastSeenIds: listing.items.map(item => String(item.id)), lastError: null };
    } catch (error) {
      patch = { lastError: `建立追更基线失败，下次检查将重试：${toErrorMessage(error)}` };
    }
    subscriptions = await updateStorageValue(STORAGE_KEYS.subscriptions, current =>
      current?.[key]?.baselinePending
        ? mergeSubscriptionCheckResults(current, { [key]: { subscription, patch } }) : current
    );
  }
  return subscriptions;
}

async function handlePlaylistCommand(command, payload = {}) {
  if (command === "list") {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.playlists);
    return normalizePlaylists(stored[STORAGE_KEYS.playlists]);
  }
  if (command === "repairDurations") {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.playlists);
    const repaired = await repairPlaylistDurations(stored[STORAGE_KEYS.playlists], item => getVideoInfo(item));
    return updateStorageValue(STORAGE_KEYS.playlists, current => mergePlaylistDurations(current, repaired));
  }
  if (command === "delete") {
    const playlists = await updateStorageValue(STORAGE_KEYS.playlists, current => deletePlaylist(current, payload.playlistId));
    await deletePlaybackCheckpoint(`playlist:${String(payload.playlistId)}`);
    return playlists;
  }
  return updateStorageValue(STORAGE_KEYS.playlists, current => {
    if (command === "create") return createPlaylist(current, payload.name);
    if (command === "rename") return renamePlaylist(current, payload.playlistId, payload.name);
    if (command === "addTracks") return addTracksToPlaylist(current, payload.playlistId, payload.tracks);
    if (command === "removeTrack") return removeTrackFromPlaylist(current, payload.playlistId, payload.bvid);
    if (command === "reorderTrack") {
      return reorderPlaylistTrack(current, payload.playlistId, payload.fromIndex, payload.toIndex);
    }
    if (command === "import") return mergeImportedPlaylists(current, payload.playlists, { mode: payload.mode });
    throw new Error(`未知播放列表命令：${command}`);
  });
}

async function handleFavoriteSectionCommand(command, payload = {}) {
  if (command === "list") {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.favoriteSections);
    return normalizeFavoriteSections(stored[STORAGE_KEYS.favoriteSections]);
  }
  if (command === "hydrateMetadata") {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.favoriteSections);
    const favorites = normalizeFavoriteSections(stored[STORAGE_KEYS.favoriteSections]);
    const requestedKeys = new Set((payload.keys ?? []).map(String));
    const requested = requestedKeys.size ? favorites.filter(item => requestedKeys.has(item.key)) : favorites;
    const groups = new Map();
    requested.forEach(favorite => {
      const list = groups.get(favorite.creatorId) ?? [];
      list.push(favorite);
      groups.set(favorite.creatorId, list);
    });
    const entries = await Promise.allSettled([...groups.keys()].map(async creatorId => [
      creatorId,
      await listAllCreatorContainers(creatorId)
    ]));
    const containersByCreator = {};
    const failedCreatorIds = [];
    entries.forEach((entry, index) => {
      const creatorId = [...groups.keys()][index];
      if (entry.status === "fulfilled") containersByCreator[creatorId] = entry.value[1];
      else failedCreatorIds.push(creatorId);
    });
    return {
      items: favoriteSectionMetadata(requested, containersByCreator),
      failedCreatorIds
    };
  }
  return updateStorageValue(STORAGE_KEYS.favoriteSections, current => {
    if (command === "add") return addFavoriteSection(current, payload.section);
    if (command === "remove") return removeFavoriteSection(current, payload.key);
    throw new Error(`未知收藏栏目命令：${command}`);
  });
}

async function handleMessage(message) {
  switch (message.type) {
    case MESSAGE.getAppState:
      await initializeStorage();
      return { ok: true, data: await appStateWithLivePlayer() };
    case MESSAGE.searchCreators:
      return { ok: true, data: await searchCreators(message.keyword, message.page) };
    case MESSAGE.addCreator:
      return { ok: true, data: await addCreator(message.creator) };
    case MESSAGE.removeCreator:
      return { ok: true, data: await removeCreator(message.id) };
    case MESSAGE.selectCreator:
      return { ok: true, data: await saveSettings({ activeCreatorId: String(message.id) }) };
    case MESSAGE.loadCreator:
      return { ok: true, data: await loadCreator(String(message.id), Boolean(message.force)) };
    case MESSAGE.loadSection:
      return { ok: true, data: await loadSection(message) };
    case MESSAGE.resolveAudio:
      return { ok: true, data: await resolveAudioStream(message.track) };
    case MESSAGE.playerCommand:
      const created = await ensureOffscreenDocument();
      if (message.command !== "hydrate") {
        const { player } = await getAppState();
        let needsHydration = created;
        if (!needsHydration) {
          try {
            const status = await chrome.runtime.sendMessage({
              type: MESSAGE.playerCommand,
              command: "status",
              target: "offscreen"
            });
            needsHydration = !status?.ok || !status.data?.hydrated;
          } catch {
            needsHydration = true;
          }
        }
        if (needsHydration) {
          await chrome.runtime.sendMessage({
            type: MESSAGE.playerCommand,
            command: "hydrate",
            payload: { player },
            target: "offscreen"
          });
        }
      }
      return await chrome.runtime.sendMessage({ ...message, target: "offscreen" });
    case MESSAGE.cacheCommand:
      await ensureOffscreenDocument();
      return await chrome.runtime.sendMessage({ ...message, target: "offscreen" });
    case MESSAGE.cacheEvent:
      await applyAutoCacheOutcome(message.cache);
      return { ok: true };
    case MESSAGE.playerEvent:
      if (message.persist !== false) await savePlayerEvent(message.player);
      return { ok: true };
    case MESSAGE.openPlayer:
      await chrome.tabs.create({ url: chrome.runtime.getURL("player.html") });
      return { ok: true };
    case MESSAGE.saveSettings: {
      const settings = await saveSettings(message.patch);
      if (Object.hasOwn(message.patch, "rememberProgress") && !settings.rememberProgress) {
        await playerSaveChain;
        await clearPlaybackHistory();
      }
      if (Object.hasOwn(message.patch, "actionLaunchMode")) {
        await configureActionLaunch(settings.actionLaunchMode);
      }
      if (message.patch.updateIntervalMinutes) {
        await chrome.alarms.create(UPDATE_ALARM, {
          periodInMinutes: Math.max(30, settings.updateIntervalMinutes)
        });
      }
      return { ok: true, data: settings };
    }
    case MESSAGE.checkUpdates:
      return { ok: true, data: await checkAllCreators() };
    case MESSAGE.setSubscription:
      return { ok: true, data: await setSubscription(message) };
    case MESSAGE.playlistCommand:
      return { ok: true, data: await handlePlaylistCommand(message.command, message.payload) };
    case MESSAGE.favoriteSectionCommand:
      return { ok: true, data: await handleFavoriteSectionCommand(message.command, message.payload) };
    default:
      return { ok: false, error: `未知消息：${message.type}` };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target === "offscreen") return false;
  handleMessage(message)
    .then(sendResponse)
    .catch(error => sendResponse({ ok: false, error: toErrorMessage(error), code: error?.code ?? null }));
  return true;
});

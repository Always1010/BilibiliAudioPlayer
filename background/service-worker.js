import { MESSAGE, STORAGE_KEYS, UPDATE_ALARM } from "../shared/constants.js";
import {
  getAppState,
  initializeStorage,
  savePlayerState,
  saveSettings,
  updateStorageValue
} from "../shared/storage.js";
import {
  getCreator,
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

const OFFSCREEN_URL = "offscreen/offscreen.html";
let creatingOffscreen = null;

async function configureExtension() {
  await Promise.all([
    initializeStorage(),
    configureBilibiliAudioRequestRules()
  ]);
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  const { settings } = await getAppState();
  await chrome.alarms.create(UPDATE_ALARM, {
    periodInMinutes: Math.max(30, settings.updateIntervalMinutes)
  });
}

chrome.runtime.onInstalled.addListener(() => {
  configureExtension().catch(console.error);
});

chrome.runtime.onStartup.addListener(() => {
  configureExtension()
    .then(async () => {
      const { settings } = await getAppState();
      if (settings.checkUpdatesOnStartup) await checkAllCreators();
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
  if (contexts.length) return;
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
  if (!force && cached && Date.now() - cached.loadedAt < 10 * 60 * 1000) return cached;

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
  if (creator) await addCreator(creator);
  return content;
}

async function loadSection({ creatorId, section, page = 1, pageSize = 30 }) {
  if (section.type === "all") return listCreatorVideos(creatorId, page, pageSize);
  return listContainerVideos(creatorId, section.type, section.id, page, pageSize);
}

async function checkAllCreators() {
  const state = await getAppState();
  const results = {};
  const nextSubscriptions = { ...state.subscriptions };
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

      const creatorSubscriptions = Object.entries(state.subscriptions)
        .filter(([, subscription]) => String(subscription.creatorId) === String(creator.id) && subscription.enabled);
      for (const [key, subscription] of creatorSubscriptions) {
        try {
          const listing = subscription.section.type === "all"
            ? latest
            : await listContainerVideos(creator.id, subscription.section.type, subscription.section.id, 1, 30);
          const known = new Set(subscription.lastSeenIds ?? []);
          const newItems = listing.items.filter(item => !known.has(String(item.id)));
          let accepted = newItems.length === 0;
          if (newItems.length && subscription.mode === "download") {
            await ensureOffscreenDocument();
            const status = await chrome.runtime.sendMessage({
              type: MESSAGE.cacheCommand,
              command: "status",
              target: "offscreen"
            });
            if (status?.ok && status.data?.directory?.permission === "granted") {
              const tracks = newItems.map(track => ({
                ...track,
                creator: { id: creator.id, name: creator.name },
                sectionTitle: subscription.section.title
              }));
              await chrome.runtime.sendMessage({
                type: MESSAGE.cacheCommand,
                command: "cacheTracks",
                payload: {
                  tracks,
                  section: subscription.section,
                  format: state.settings.defaultFormat,
                  bitrate: state.settings.mp3Bitrate
                },
                target: "offscreen"
              });
              accepted = true;
            }
          }
          nextSubscriptions[key] = {
            ...subscription,
            lastCheckedAt: Date.now(),
            lastError: accepted ? null : "缓存目录不可用，新作品已保留待下次检查",
            lastSeenIds: accepted ? listing.items.map(item => String(item.id)) : subscription.lastSeenIds
          };
        } catch (error) {
          nextSubscriptions[key] = { ...subscription, lastCheckedAt: Date.now(), lastError: toErrorMessage(error) };
        }
      }
    } catch (error) {
      results[creator.id] = {
        checkedAt: Date.now(),
        newCount: 0,
        error: toErrorMessage(error)
      };
    }
  }
  await chrome.storage.local.set({
    [STORAGE_KEYS.updateState]: results,
    [STORAGE_KEYS.subscriptions]: nextSubscriptions
  });
  return results;
}

async function setSubscription({ creatorId, section, enabled, mode = "download", lastSeenIds = [] }) {
  const key = `${creatorId}:${section.key ?? `${section.type}:${section.id}`}`;
  const subscriptions = await updateStorageValue(STORAGE_KEYS.subscriptions, current => {
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
        mode,
        lastSeenIds: lastSeenIds.map(String),
        createdAt: next[key]?.createdAt ?? Date.now(),
        lastCheckedAt: next[key]?.lastCheckedAt ?? null,
        lastError: null
      };
    }
    return next;
  });
  return subscriptions;
}

async function handlePlaylistCommand(command, payload = {}) {
  if (command === "list") {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.playlists);
    return normalizePlaylists(stored[STORAGE_KEYS.playlists]);
  }
  return updateStorageValue(STORAGE_KEYS.playlists, current => {
    if (command === "create") return createPlaylist(current, payload.name);
    if (command === "rename") return renamePlaylist(current, payload.playlistId, payload.name);
    if (command === "delete") return deletePlaylist(current, payload.playlistId);
    if (command === "addTracks") return addTracksToPlaylist(current, payload.playlistId, payload.tracks);
    if (command === "removeTrack") return removeTrackFromPlaylist(current, payload.playlistId, payload.bvid);
    if (command === "reorderTrack") {
      return reorderPlaylistTrack(current, payload.playlistId, payload.fromIndex, payload.toIndex);
    }
    throw new Error(`未知播放列表命令：${command}`);
  });
}

async function handleMessage(message) {
  switch (message.type) {
    case MESSAGE.getAppState:
      await initializeStorage();
      return { ok: true, data: await getAppState() };
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
      await ensureOffscreenDocument();
      if (message.command !== "hydrate") {
        const { player } = await getAppState();
        await chrome.runtime.sendMessage({
          type: MESSAGE.playerCommand,
          command: "hydrate",
          payload: { player },
          target: "offscreen"
        });
      }
      return await chrome.runtime.sendMessage({ ...message, target: "offscreen" });
    case MESSAGE.cacheCommand:
      await ensureOffscreenDocument();
      return await chrome.runtime.sendMessage({ ...message, target: "offscreen" });
    case MESSAGE.cacheEvent:
      return { ok: true };
    case MESSAGE.playerEvent:
      await savePlayerState(message.player);
      return { ok: true };
    case MESSAGE.openPlayer:
      await chrome.tabs.create({ url: chrome.runtime.getURL("player.html") });
      return { ok: true };
    case MESSAGE.saveSettings: {
      const settings = await saveSettings(message.patch);
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

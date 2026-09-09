import { DEFAULT_PLAYER, MESSAGE } from "../shared/constants.js";
import {
  clearCacheDirectoryHandle,
  deleteCacheLocation,
  findCachedFile,
  findCachedFiles,
  getCacheDirectoryInfo,
  getCacheRecord,
  getOrCreateDirectory,
  listCacheRecords,
  putCacheRecord,
  requireWritableDirectory,
  safeFilePart
} from "../services/file-store.js";
import { archiveScope, scopeKeyFromContext } from "../services/cache-records.js";
import { encodeAudioBufferToMp3, normalizeMp3Bitrate } from "../services/mp3.js";
import { addCacheHistory, summarizeCacheTask } from "../services/cache-queue-state.js";
import { audioStreamCandidates, mediaErrorText, mediaSourceType } from "../services/audio-stream.js";
import { cachedPlaybackSource, onlinePlaybackSource } from "../services/playback-source.js";
import { insertQueueItems, removeQueueItem, reorderQueue } from "../services/play-queue.js";
import {
  ARCHIVE_MANIFEST_FILENAME,
  buildArchiveManifest,
  parseArchiveAudioFilename,
  parseArchiveManifest,
  recoveredArchiveScope
} from "../services/archive-manifest.js";

const audio = document.getElementById("audio");
let state = { ...DEFAULT_PLAYER };
let lastReportedSecond = -1;
let currentObjectUrl = null;
let currentStreamAbort = null;
let currentStreamPump = null;
const cacheQueue = [];
let cacheRunning = false;
let currentCacheTask = null;
let cacheHistory = [];
let cacheActivity = { status: "idle" };

async function sendToBackground(message) {
  const response = await chrome.runtime.sendMessage({ ...message, target: "background" });
  if (!response?.ok) throw new Error(response?.error || "后台请求失败");
  return response.data;
}

function publicPlayerState(patch = {}) {
  return {
    queue: state.queue,
    queueIndex: state.queueIndex,
    queueContext: state.queueContext ?? null,
    currentTrack: state.currentTrack,
    playing: !audio.paused && !audio.ended,
    currentTime: Number.isFinite(audio.currentTime) ? audio.currentTime : state.currentTime,
    duration: Number.isFinite(audio.duration) ? audio.duration : state.duration,
    loading: Boolean(state.loading),
    source: state.source ?? null,
    volume: audio.volume,
    mode: state.mode,
    error: null,
    ...patch
  };
}

async function report(patch = {}, includeQueue = false) {
  const player = publicPlayerState(patch);
  state = { ...state, ...player };
  const eventPlayer = { ...player };
  if (!includeQueue) delete eventPlayer.queue;
  await chrome.runtime.sendMessage({ type: MESSAGE.playerEvent, player: eventPlayer, target: "background" });
}

function updateMediaSession(track) {
  if (!("mediaSession" in navigator) || !track) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title,
    artist: track.creator?.name || "哔哩哔哩",
    album: track.sectionTitle || "哔哩音频",
    artwork: track.cover ? [{ src: track.cover }] : []
  });
}

function disposeCurrentSource() {
  currentStreamAbort?.abort();
  currentStreamAbort = null;
  currentStreamPump = null;
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }
}

function waitForAudioReady(label, resumeAt = 0) {
  return new Promise((resolve, reject) => {
    const ready = () => {
      cleanup();
      if (resumeAt > 0) {
        try { audio.currentTime = Math.min(resumeAt, Number.isFinite(audio.duration) ? audio.duration : resumeAt); }
        catch {}
      }
      resolve();
    };
    const failed = () => {
      const details = mediaErrorText(audio.error);
      cleanup();
      reject(new Error(`${label}失败：${details}`));
    };
    const cleanup = () => {
      audio.removeEventListener("canplay", ready);
      audio.removeEventListener("error", failed);
    };
    audio.addEventListener("canplay", ready, { once: true });
    audio.addEventListener("error", failed, { once: true });
  });
}

async function fetchStreamResponse(stream, signal) {
  const failures = [];
  for (const url of audioStreamCandidates(stream)) {
    try {
      const response = await fetch(url, {
        credentials: "include",
        signal
      });
      if (response.ok && response.body) return response;
      failures.push(`${new URL(url).hostname} HTTP ${response.status}`);
    } catch (error) {
      if (signal?.aborted) throw error;
      failures.push(`${new URL(url).hostname} ${error.message}`);
    }
  }
  throw new Error(failures.length
    ? `所有 CDN 均不可用（${failures.join("；")}）`
    : "没有可用的 CDN 音频地址");
}

function appendToSourceBuffer(sourceBuffer, value, signal) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      sourceBuffer.removeEventListener("updateend", updated);
      sourceBuffer.removeEventListener("error", failed);
      signal.removeEventListener("abort", aborted);
    };
    const updated = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(new Error("浏览器无法解析 DASH 音频片段")); };
    const aborted = () => { cleanup(); reject(new DOMException("音频加载已中止", "AbortError")); };
    sourceBuffer.addEventListener("updateend", updated, { once: true });
    sourceBuffer.addEventListener("error", failed, { once: true });
    signal.addEventListener("abort", aborted, { once: true });
    try {
      sourceBuffer.appendBuffer(value);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

async function waitForBufferSpace(sourceBuffer, signal) {
  while (sourceBuffer.buffered.length
    && sourceBuffer.buffered.end(sourceBuffer.buffered.length - 1) - audio.currentTime > 120) {
    await new Promise((resolve, reject) => {
      let timer = null;
      const done = () => { cleanup(); resolve(); };
      const aborted = () => {
        cleanup();
        reject(new DOMException("音频加载已中止", "AbortError"));
      };
      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", aborted);
      };
      timer = setTimeout(done, 1000);
      signal.addEventListener("abort", aborted, { once: true });
    });
  }
}

function startMediaSourceStream(stream) {
  const type = mediaSourceType(stream);
  if (!type || !("MediaSource" in globalThis) || !MediaSource.isTypeSupported(type)) {
    throw new Error(`浏览器不支持流式解析 ${type || stream.mimeType || "该音频格式"}`);
  }

  const controller = new AbortController();
  currentStreamAbort = controller;
  const mediaSource = new MediaSource();
  currentObjectUrl = URL.createObjectURL(mediaSource);
  const opened = new Promise((resolve, reject) => {
    mediaSource.addEventListener("sourceopen", resolve, { once: true });
    mediaSource.addEventListener("error", () => reject(new Error("流式媒体容器初始化失败")), { once: true });
  });
  audio.src = currentObjectUrl;
  audio.load();

  const pump = opened.then(async () => {
    const sourceBuffer = mediaSource.addSourceBuffer(type);
    const response = await fetchStreamResponse(stream, controller.signal);
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      await appendToSourceBuffer(sourceBuffer, value, controller.signal);
      await waitForBufferSpace(sourceBuffer, controller.signal);
    }
    if (mediaSource.readyState === "open") mediaSource.endOfStream();
  });
  currentStreamPump = pump;
  return { pump, controller };
}

async function loadRemoteAudio(track, resumeAt) {
  const stream = await sendToBackground({ type: MESSAGE.resolveAudio, track });
  let streamError = null;
  try {
    const session = startMediaSourceStream(stream);
    const ready = waitForAudioReady("DASH 流式加载", resumeAt);
    await Promise.race([ready, session.pump.then(() => ready)]);
    session.pump.catch(error => {
      if (!session.controller.signal.aborted && currentStreamPump === session.pump) {
        report({ error: `音频流中断：${error.message}` }).catch(console.error);
      }
    });
    return;
  } catch (error) {
    streamError = error;
    disposeCurrentSource();
  }

  const controller = new AbortController();
  currentStreamAbort = controller;
  try {
    const response = await fetchStreamResponse(stream, controller.signal);
    const blob = await response.blob();
    if (!blob.size) throw new Error("CDN 返回了空音频文件");
    currentObjectUrl = URL.createObjectURL(new Blob([blob], { type: stream.mimeType || blob.type }));
    audio.src = currentObjectUrl;
    audio.load();
    await waitForAudioReady("完整音频回退加载", resumeAt);
  } catch (error) {
    throw new Error(`在线播放失败：${streamError?.message || "流式加载不可用"}；回退加载失败：${error.message}`);
  }
}

async function loadAndPlay(index, resumeAt = 0) {
  if (!state.queue.length) throw new Error("播放队列为空");
  const normalizedIndex = Math.max(0, Math.min(index, state.queue.length - 1));
  const track = state.queue[normalizedIndex];
  state.queueIndex = normalizedIndex;
  state.currentTrack = track;
  await report({ loading: true, source: null, currentTrack: track, queueIndex: normalizedIndex }, true);
  disposeCurrentSource();

  const cachedRecord = await getCacheRecord(track.id);
  const cachedFiles = cachedRecord
    ? await findCachedFiles(cachedRecord, { preferredScopeKey: scopeKeyFromContext(state.queueContext) })
    : [];
  let source = null;
  for (const cached of cachedFiles) {
    try {
      currentObjectUrl = URL.createObjectURL(cached.file);
      audio.src = currentObjectUrl;
      audio.load();
      await waitForAudioReady("本地缓存加载", resumeAt);
      source = cachedPlaybackSource(cached.location);
      break;
    } catch {
      disposeCurrentSource();
      await deleteCacheLocation(cachedRecord.trackId, cached.location.id);
    }
  }
  if (!source) {
    await loadRemoteAudio(track, resumeAt);
    source = onlinePlaybackSource();
  }

  audio.volume = state.volume ?? 0.8;
  updateMediaSession(track);
  await audio.play();
  await report({ loading: false, source });
}

function cacheSnapshot(patch = {}) {
  return {
    running: cacheRunning,
    queued: cacheQueue.length,
    current: summarizeCacheTask(currentCacheTask),
    pending: cacheQueue.map(summarizeCacheTask),
    recent: cacheHistory,
    activity: cacheActivity,
    ...patch
  };
}

async function reportCache(patch) {
  cacheActivity = { ...patch };
  cacheHistory = addCacheHistory(cacheHistory, currentCacheTask, patch);
  await chrome.runtime.sendMessage({
    type: MESSAGE.cacheEvent,
    cache: cacheSnapshot(patch),
    target: "background"
  });
}

function extensionForStream(stream) {
  if (stream.mimeType?.includes("webm") || stream.codec?.includes("opus")) return "webm";
  return "m4a";
}

function archiveDirectoryParts(task, creator) {
  if (task.section?.type === "playlist") {
    const shortId = safeFilePart(String(task.section.id || "list").slice(0, 8));
    return ["我的播放列表", `${safeFilePart(task.section.title || "未命名播放列表")} [${shortId}]`];
  }
  const creatorFolder = `${safeFilePart(creator.name || "未知UP主")}_${safeFilePart(creator.id || "unknown")}`;
  const typeFolder = task.section?.type === "season" ? "合集" : task.section?.type === "series" ? "系列" : "全部作品";
  return task.section?.type === "all"
    ? [creatorFolder, typeFolder]
    : [creatorFolder, typeFolder, safeFilePart(task.section?.title || task.track.sectionTitle)];
}

function extensionForLocation(location) {
  if (location?.format === "mp3") return "mp3";
  const extension = String(location?.path?.at(-1) || "").split(".").at(-1).toLowerCase();
  return ["m4a", "webm"].includes(extension) ? extension : "m4a";
}

async function updatePlaylistArchiveManifest(root, task, location) {
  if (task.section?.type !== "playlist") return;
  const directory = await getOrCreateDirectory(root, location.path.slice(0, -1));
  const handle = await directory.getFileHandle(ARCHIVE_MANIFEST_FILENAME, { create: true });
  let existing = null;
  try {
    const file = await handle.getFile();
    if (file.size) existing = parseArchiveManifest(await file.text());
  } catch {}
  const manifest = buildArchiveManifest(location.scope, task.archiveItems, existing, {
    bvid: task.track.bvid || task.track.id,
    filename: location.path.at(-1),
    format: location.format,
    bitrate: location.bitrate,
    size: location.size
  });
  const writable = await handle.createWritable();
  await writable.write(`${JSON.stringify(manifest, null, 2)}\n`);
  await writable.close();
}

async function readArchiveManifest(directory) {
  try {
    const handle = await directory.getFileHandle(ARCHIVE_MANIFEST_FILENAME);
    return parseArchiveManifest(await (await handle.getFile()).text());
  } catch {
    return null;
  }
}

async function scanArchiveDirectory(directory, path, summary) {
  const manifest = await readArchiveManifest(directory);
  if (manifest) summary.manifests += 1;
  const manifestItems = new Map((manifest?.items ?? []).filter(item => item.filename).map(item => [item.filename, item]));
  for await (const [name, handle] of directory.entries()) {
    if (handle.kind === "directory") {
      await scanArchiveDirectory(handle, [...path, name], summary);
      continue;
    }
    if (name === ARCHIVE_MANIFEST_FILENAME) continue;
    const parsed = parseArchiveAudioFilename(name);
    if (!parsed) continue;
    try {
      const file = await handle.getFile();
      if (!file.size) continue;
      const item = manifestItems.get(name) ?? {};
      const scope = manifest?.scope?.key ? manifest.scope : recoveredArchiveScope(path);
      const creator = item.creatorId || item.creatorName
        ? { id: String(item.creatorId || ""), name: String(item.creatorName || "") }
        : null;
      const bitrate = parsed.format === "mp3" ? Number(item.bitrate) || null : null;
      const location = {
        id: manifest?.scope?.key
          ? `${scope.key}:${parsed.format}:${parsed.format === "mp3" ? bitrate ?? "unknown" : "source"}`
          : `recovered:${[...path, name].join("/")}`,
        scope,
        path: [...path, name],
        format: parsed.format,
        bitrate,
        mimeType: parsed.format === "mp3" ? "audio/mpeg" : parsed.extension === "webm" ? "audio/webm" : "audio/mp4",
        codec: parsed.format === "mp3" ? "mp3" : "",
        size: file.size,
        cachedAt: Number(file.lastModified) || Date.now(),
        verifiedAt: Date.now()
      };
      await putCacheRecord({
        trackId: parsed.bvid,
        bvid: parsed.bvid,
        title: item.title || parsed.title,
        creator,
        locations: [location]
      });
      summary.files += 1;
    } catch {
      summary.errors += 1;
    }
  }
}

async function scanCacheArchives() {
  const root = await requireWritableDirectory();
  const existing = await listCacheRecords();
  for (const record of existing) await findCachedFiles(record);
  const summary = { manifests: 0, files: 0, errors: 0 };
  await scanArchiveDirectory(root, [], summary);
  return summary;
}

async function fetchAudio(stream, track, writable = null) {
  const response = await fetchStreamResponse(stream);

  const total = Number(response.headers.get("content-length")) || 0;
  const reader = response.body.getReader();
  const chunks = writable ? null : [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (writable) await writable.write(value);
    else chunks.push(value);
    received += value.byteLength;
    await reportCache({
      track,
      status: "downloading",
      received,
      total,
      progress: total ? received / total : null
    });
  }
  return {
    blob: chunks ? new Blob(chunks, { type: stream.mimeType }) : null,
    size: received
  };
}

async function transcodeToMp3(sourceBlob, task) {
  const AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!AudioContextClass) throw new Error("当前浏览器无法解码音频，请升级到最新版 Edge 或 Chrome");
  await reportCache({ track: task.track, status: "decoding", progress: null });
  const context = new AudioContextClass({ sampleRate: 48000 });
  let decoded;
  try {
    decoded = await context.decodeAudioData(await sourceBlob.arrayBuffer());
  } finally {
    await context.close().catch(() => {});
  }

  await reportCache({ track: task.track, status: "encoding", progress: 0 });
  let lastReportedPercent = 0;
  const progressReports = [];
  const output = await encodeAudioBufferToMp3(decoded, task.bitrate, progress => {
    const percent = Math.floor(progress * 100);
    if (percent === lastReportedPercent || (percent < 100 && percent % 5 !== 0)) return;
    lastReportedPercent = percent;
    progressReports.push(reportCache({ track: task.track, status: "encoding", progress }));
  });
  await Promise.allSettled(progressReports);
  return output;
}

async function downloadTrack(task, getRoot) {
  const existing = await getCacheRecord(task.track.id);
  const creator = task.track.creator ?? {};
  const scope = archiveScope(task.section, creator);
  const target = existing ? await findCachedFile(existing, {
    preferredScopeKey: scope.key,
    onlyPreferred: true,
    format: task.format,
    bitrate: task.bitrate
  }) : null;
  if (target) {
    const root = await getRoot();
    await updatePlaylistArchiveManifest(root, task, target.location);
    await reportCache({ track: task.track, status: "skipped", message: "文件已经缓存" });
    return existing;
  }

  const root = await getRoot();
  const localSource = existing ? await findCachedFile(existing, {
    format: task.format,
    bitrate: task.bitrate
  }) : null;
  const stream = localSource ? null : await sendToBackground({ type: MESSAGE.resolveAudio, track: task.track });
  const extension = task.format === "mp3" ? "mp3" : localSource ? extensionForLocation(localSource.location) : extensionForStream(stream);
  const parts = archiveDirectoryParts(task, creator);
  const directory = await getOrCreateDirectory(root, parts);
  const prefix = Number.isFinite(task.position) ? `${String(task.position + 1).padStart(3, "0")} - ` : "";
  const identity = task.track.bvid ? ` [${safeFilePart(task.track.bvid)}]` : "";
  const filename = `${prefix}${safeFilePart(task.track.title)}${identity}.${extension}`;
  const fileHandle = await directory.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();

  let output;
  try {
    if (localSource) {
      await reportCache({
        track: task.track,
        status: "copying",
        progress: null,
        message: `正在从“${localSource.location.scope?.title || "其他本地归档"}”复制`
      });
      await writable.write(localSource.file);
      output = { size: localSource.file.size };
    } else if (task.format === "mp3") {
      const source = await fetchAudio(stream, task.track);
      output = await transcodeToMp3(source.blob, task);
      await writable.write(output);
    } else {
      output = await fetchAudio(stream, task.track, writable);
    }
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => {});
    throw error;
  }

  const location = {
    id: `${scope.key}:${task.format}:${task.format === "mp3" ? task.bitrate : "source"}`,
    scope,
    path: [...parts, filename],
    format: task.format,
    bitrate: task.format === "mp3" ? task.bitrate : null,
    mimeType: task.format === "mp3" ? "audio/mpeg" : localSource?.location.mimeType || stream.mimeType,
    codec: task.format === "mp3" ? "mp3" : localSource?.location.codec || stream.codec,
    size: output.size,
    cachedAt: Date.now(),
    verifiedAt: Date.now()
  };
  const record = {
    trackId: String(task.track.id),
    bvid: task.track.bvid,
    title: task.track.title,
    creator,
    locations: [location]
  };
  const saved = await putCacheRecord(record);
  await updatePlaylistArchiveManifest(root, task, location);
  await reportCache({
    track: task.track,
    status: "completed",
    message: localSource ? "已从其他本地归档复制" : "已从线上缓存",
    record: { ...record, ...location }
  });
  return saved;
}

async function processCacheQueue() {
  if (cacheRunning) return;
  cacheRunning = true;
  let rootPromise = null;
  const getRoot = () => {
    if (!rootPromise) rootPromise = requireWritableDirectory();
    return rootPromise;
  };
  await reportCache({ status: "started" });
  while (cacheQueue.length) {
    const task = cacheQueue.shift();
    currentCacheTask = task;
    try {
      await reportCache({ track: task.track, status: "preparing", progress: 0 });
      await downloadTrack(task, getRoot);
    } catch (error) {
      await reportCache({ track: task.track, status: "failed", message: error.message });
    } finally {
      currentCacheTask = null;
    }
  }
  cacheRunning = false;
  await reportCache({ status: "idle" });
}

async function handleCacheCommand(command, payload = {}) {
  if (command === "status") {
    const [directory, records] = await Promise.all([getCacheDirectoryInfo(), listCacheRecords()]);
    return cacheSnapshot({ directory, records });
  }
  if (command === "refreshDirectory") {
    clearCacheDirectoryHandle();
    return { refreshed: true };
  }
  if (command === "scanArchives") {
    const recovery = await scanCacheArchives();
    const [directory, records] = await Promise.all([getCacheDirectoryInfo(), listCacheRecords()]);
    return cacheSnapshot({ directory, records, recovery });
  }
  if (command === "cacheTracks") {
    const format = payload.format === "mp3" ? "mp3" : "original";
    const bitrate = normalizeMp3Bitrate(payload.bitrate);
    const taskKey = task => {
      const scope = archiveScope(task.section, task.track.creator ?? {});
      return `${task.track.id}:${scope.key}:${task.format}:${task.format === "mp3" ? task.bitrate : "source"}`;
    };
    const known = new Set([...cacheQueue, currentCacheTask].filter(Boolean).map(taskKey));
    (payload.tracks ?? []).forEach((track, position) => {
      const task = {
        track,
        section: payload.section,
        position,
        format,
        bitrate,
        archiveItems: payload.section?.type === "playlist" ? payload.tracks : null
      };
      const key = taskKey(task);
      if (!known.has(key)) {
        cacheQueue.push(task);
        known.add(key);
      }
    });
    processCacheQueue().catch(error => reportCache({ status: "failed", message: error.message }));
    return cacheSnapshot({ accepted: true });
  }
  throw new Error(`未知缓存命令：${command}`);
}

async function move(direction) {
  if (!state.queue.length) return;
  if (state.mode === "shuffle" && state.queue.length > 1) {
    let index = state.queueIndex;
    while (index === state.queueIndex) index = Math.floor(Math.random() * state.queue.length);
    await loadAndPlay(index);
    return;
  }
  let next = state.queueIndex + direction;
  if (next >= state.queue.length) next = state.mode === "list" ? 0 : state.queue.length - 1;
  if (next < 0) next = state.mode === "list" ? state.queue.length - 1 : 0;
  await loadAndPlay(next);
}

async function handleCommand(command, payload = {}) {
  let includeQueue = false;
  switch (command) {
    case "hydrate":
      state = { ...state, ...payload.player };
      audio.volume = state.volume;
      return state;
    case "playQueue":
      state.queue = payload.queue ?? [];
      state.queueContext = payload.queueContext ?? { kind: "manual", title: "播放队列" };
      state.mode = payload.mode ?? state.mode;
      await loadAndPlay(payload.index ?? 0, payload.resumeAt ?? 0);
      break;
    case "playIndex":
      await loadAndPlay(Number(payload.index));
      break;
    case "appendQueue":
      state.queue = insertQueueItems(state.queue, payload.tracks, state.queueIndex, Boolean(payload.playNext));
      state.queueContext = payload.queueContext ?? state.queueContext ?? { kind: "manual", title: "手动播放队列" };
      includeQueue = true;
      break;
    case "reorderQueue": {
      const reordered = reorderQueue(state.queue, Number(payload.fromIndex), Number(payload.toIndex), state.queueIndex);
      state.queue = reordered.queue;
      state.queueIndex = reordered.currentIndex;
      includeQueue = true;
      break;
    }
    case "removeQueueItem": {
      const removed = removeQueueItem(state.queue, Number(payload.index), state.queueIndex);
      state.queue = removed.queue;
      state.queueIndex = removed.currentIndex;
      if (!state.queue.length) {
        disposeCurrentSource();
        state.currentTrack = null;
        state.currentTime = 0;
        state.duration = 0;
        state.source = null;
        state.loading = false;
        includeQueue = true;
      } else if (removed.removedCurrent) {
        await loadAndPlay(state.queueIndex);
      } else {
        includeQueue = true;
      }
      break;
    }
    case "clearQueue":
      disposeCurrentSource();
      state.queue = [];
      state.queueIndex = -1;
      state.queueContext = null;
      state.currentTrack = null;
      state.currentTime = 0;
      state.duration = 0;
      state.source = null;
      state.loading = false;
      includeQueue = true;
      break;
    case "resume":
      if (!audio.src && state.currentTrack) await loadAndPlay(state.queueIndex, state.currentTime);
      else await audio.play();
      break;
    case "pause":
      audio.pause();
      break;
    case "next":
      await move(1);
      break;
    case "previous":
      if (audio.currentTime > 5) audio.currentTime = 0;
      else await move(-1);
      break;
    case "seek":
      if (Number.isFinite(payload.time)) audio.currentTime = Math.max(0, payload.time);
      break;
    case "volume":
      audio.volume = Math.max(0, Math.min(1, Number(payload.volume)));
      break;
    case "mode":
      state.mode = payload.mode;
      break;
    default:
      throw new Error(`未知播放命令：${command}`);
  }
  await report({}, includeQueue);
  return publicPlayerState();
}

audio.addEventListener("play", () => report().catch(console.error));
audio.addEventListener("pause", () => report().catch(console.error));
audio.addEventListener("durationchange", () => report().catch(console.error));
audio.addEventListener("volumechange", () => report().catch(console.error));
audio.addEventListener("timeupdate", () => {
  const second = Math.floor(audio.currentTime);
  if (second !== lastReportedSecond && second % 2 === 0) {
    lastReportedSecond = second;
    report().catch(console.error);
  }
});
audio.addEventListener("ended", () => {
  if (state.mode === "single") loadAndPlay(state.queueIndex).catch(error => report({ error: error.message }));
  else move(1).catch(error => report({ error: error.message }));
});
audio.addEventListener("error", () => {
  if (!state.loading) report({ error: `音频播放失败：${mediaErrorText(audio.error)}` }).catch(console.error);
});

if ("mediaSession" in navigator) {
  navigator.mediaSession.setActionHandler("play", () => handleCommand("resume"));
  navigator.mediaSession.setActionHandler("pause", () => handleCommand("pause"));
  navigator.mediaSession.setActionHandler("previoustrack", () => handleCommand("previous"));
  navigator.mediaSession.setActionHandler("nexttrack", () => handleCommand("next"));
  navigator.mediaSession.setActionHandler("seekto", details => handleCommand("seek", { time: details.seekTime }));
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target !== "offscreen") return false;
  const handler = message.type === MESSAGE.playerCommand
    ? handleCommand(message.command, message.payload)
    : message.type === MESSAGE.cacheCommand
      ? handleCacheCommand(message.command, message.payload)
      : null;
  if (!handler) return false;
  handler
    .then(data => sendResponse({ ok: true, data }))
    .catch(error => {
      if (message.type === MESSAGE.playerCommand) report({ error: error.message, loading: false }).catch(console.error);
      sendResponse({ ok: false, error: error.message });
    });
  return true;
});

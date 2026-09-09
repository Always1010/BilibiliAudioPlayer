import { DEFAULT_PLAYER, MESSAGE } from "../shared/constants.js";
import {
  getCacheDirectoryInfo,
  getCacheRecord,
  getCachedFile,
  getOrCreateDirectory,
  listCacheRecords,
  putCacheRecord,
  requireWritableDirectory,
  safeFilePart
} from "../services/file-store.js";
import { encodeAudioBufferToMp3, normalizeMp3Bitrate } from "../services/mp3.js";

const audio = document.getElementById("audio");
let state = { ...DEFAULT_PLAYER };
let lastReportedSecond = -1;
let currentObjectUrl = null;
const cacheQueue = [];
let cacheRunning = false;

async function sendToBackground(message) {
  const response = await chrome.runtime.sendMessage({ ...message, target: "background" });
  if (!response?.ok) throw new Error(response?.error || "后台请求失败");
  return response.data;
}

function publicPlayerState(patch = {}) {
  return {
    queue: state.queue,
    queueIndex: state.queueIndex,
    currentTrack: state.currentTrack,
    playing: !audio.paused && !audio.ended,
    currentTime: Number.isFinite(audio.currentTime) ? audio.currentTime : state.currentTime,
    duration: Number.isFinite(audio.duration) ? audio.duration : state.duration,
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

async function loadAndPlay(index, resumeAt = 0) {
  if (!state.queue.length) throw new Error("播放队列为空");
  const normalizedIndex = Math.max(0, Math.min(index, state.queue.length - 1));
  const track = state.queue[normalizedIndex];
  state.queueIndex = normalizedIndex;
  state.currentTrack = track;
  await report({ loading: true, currentTrack: track, queueIndex: normalizedIndex }, true);

  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }
  const cachedRecord = await getCacheRecord(track.id);
  const cachedFile = cachedRecord ? await getCachedFile(cachedRecord) : null;
  if (cachedFile) {
    currentObjectUrl = URL.createObjectURL(cachedFile);
    audio.src = currentObjectUrl;
  } else {
    const stream = await sendToBackground({ type: MESSAGE.resolveAudio, track });
    audio.src = stream.url;
  }
  audio.volume = state.volume ?? 0.8;
  audio.load();
  await new Promise((resolve, reject) => {
    const ready = () => {
      cleanup();
      if (resumeAt > 0 && Number.isFinite(audio.duration)) audio.currentTime = Math.min(resumeAt, audio.duration);
      resolve();
    };
    const failed = () => {
      cleanup();
      reject(new Error("音频流加载失败，可能已失效或受到访问限制"));
    };
    const cleanup = () => {
      audio.removeEventListener("canplay", ready);
      audio.removeEventListener("error", failed);
    };
    audio.addEventListener("canplay", ready, { once: true });
    audio.addEventListener("error", failed, { once: true });
  });
  updateMediaSession(track);
  await audio.play();
  await report({ loading: false });
}

async function reportCache(patch) {
  await chrome.runtime.sendMessage({
    type: MESSAGE.cacheEvent,
    cache: { running: cacheRunning, queued: cacheQueue.length, ...patch },
    target: "background"
  });
}

function extensionForStream(stream) {
  if (stream.mimeType?.includes("webm") || stream.codec?.includes("opus")) return "webm";
  return "m4a";
}

async function fetchAudio(stream, track, writable = null) {
  const response = await fetch(stream.url, {
    credentials: "include",
    referrer: "https://www.bilibili.com/"
  });
  if (!response.ok || !response.body) throw new Error(`音频下载失败（HTTP ${response.status}）`);

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

async function downloadTrack(task) {
  const existing = await getCacheRecord(task.track.id);
  const existingFormat = existing?.format ?? "original";
  const sameEncoding = existingFormat === task.format
    && (task.format !== "mp3" || Number(existing.bitrate) === task.bitrate);
  if (existing && sameEncoding && await getCachedFile(existing)) {
    await reportCache({ track: task.track, status: "skipped", message: "文件已经缓存" });
    return existing;
  }

  const root = await requireWritableDirectory();
  const stream = await sendToBackground({ type: MESSAGE.resolveAudio, track: task.track });
  const extension = task.format === "mp3" ? "mp3" : extensionForStream(stream);
  const creator = task.track.creator ?? {};
  const creatorFolder = `${safeFilePart(creator.name || "未知UP主")}_${safeFilePart(creator.id || "unknown")}`;
  const typeFolder = task.section?.type === "season" ? "合集" : task.section?.type === "series" ? "系列" : "全部作品";
  const parts = task.section?.type === "all"
    ? [creatorFolder, typeFolder]
    : [creatorFolder, typeFolder, safeFilePart(task.section?.title || task.track.sectionTitle)];
  const directory = await getOrCreateDirectory(root, parts);
  const prefix = Number.isFinite(task.position) ? `${String(task.position + 1).padStart(3, "0")} - ` : "";
  const identity = task.track.bvid ? ` [${safeFilePart(task.track.bvid)}]` : "";
  const filename = `${prefix}${safeFilePart(task.track.title)}${identity}.${extension}`;
  const fileHandle = await directory.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();

  let output;
  try {
    if (task.format === "mp3") {
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

  const record = {
    trackId: String(task.track.id),
    bvid: task.track.bvid,
    title: task.track.title,
    creator,
    section: task.section,
    path: [...parts, filename],
    format: task.format,
    bitrate: task.format === "mp3" ? task.bitrate : null,
    mimeType: task.format === "mp3" ? "audio/mpeg" : stream.mimeType,
    codec: task.format === "mp3" ? "mp3" : stream.codec,
    size: output.size,
    cachedAt: Date.now()
  };
  await putCacheRecord(record);
  await reportCache({ track: task.track, status: "completed", record });
  return record;
}

async function processCacheQueue() {
  if (cacheRunning) return;
  cacheRunning = true;
  await reportCache({ status: "started" });
  while (cacheQueue.length) {
    const task = cacheQueue.shift();
    try {
      await downloadTrack(task);
    } catch (error) {
      await reportCache({ track: task.track, status: "failed", message: error.message });
    }
  }
  cacheRunning = false;
  await reportCache({ status: "idle" });
}

async function handleCacheCommand(command, payload = {}) {
  if (command === "status") {
    const [directory, records] = await Promise.all([getCacheDirectoryInfo(), listCacheRecords()]);
    return { directory, records, running: cacheRunning, queued: cacheQueue.length };
  }
  if (command === "cacheTracks") {
    const format = payload.format === "mp3" ? "mp3" : "original";
    const bitrate = normalizeMp3Bitrate(payload.bitrate);
    const known = new Set(cacheQueue.map(item =>
      `${item.track.id}:${item.format}:${item.format === "mp3" ? item.bitrate : "source"}`
    ));
    (payload.tracks ?? []).forEach((track, position) => {
      const key = `${track.id}:${format}:${format === "mp3" ? bitrate : "source"}`;
      if (!known.has(key)) {
        cacheQueue.push({ track, section: payload.section, position, format, bitrate });
        known.add(key);
      }
    });
    processCacheQueue().catch(error => reportCache({ status: "failed", message: error.message }));
    return { accepted: true, queued: cacheQueue.length, running: true };
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
  switch (command) {
    case "hydrate":
      state = { ...state, ...payload.player };
      audio.volume = state.volume;
      return state;
    case "playQueue":
      state.queue = payload.queue ?? [];
      state.mode = payload.mode ?? state.mode;
      await loadAndPlay(payload.index ?? 0, payload.resumeAt ?? 0);
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
  await report();
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
audio.addEventListener("error", () => report({ error: "音频播放失败" }).catch(console.error));

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

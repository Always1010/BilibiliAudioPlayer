import assert from "node:assert/strict";
import {
  cachedPlaybackSource,
  onlinePlaybackSource,
  playbackSourceLabel
} from "../services/playback-source.js";

assert.deepEqual(onlinePlaybackSource(), { kind: "online" });
assert.deepEqual(cachedPlaybackSource({ format: "original", bitrate: 320 }), {
  kind: "cache",
  format: "original",
  bitrate: null
});
assert.deepEqual(cachedPlaybackSource({ format: "mp3", bitrate: 192 }), {
  kind: "cache",
  format: "mp3",
  bitrate: 192
});
assert.equal(playbackSourceLabel(null, true), "正在加载");
assert.equal(playbackSourceLabel({ kind: "online" }), "在线");
assert.equal(playbackSourceLabel({ kind: "cache", format: "original" }), "本地缓存 · 原始格式");
assert.equal(playbackSourceLabel({ kind: "cache", format: "mp3", bitrate: 192 }), "本地缓存 · MP3 192 kbps");
assert.equal(playbackSourceLabel(null), "");

console.log("播放来源：在线、本地原始格式、MP3 与加载状态通过");

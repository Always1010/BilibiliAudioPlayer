import assert from "node:assert/strict";
import {
  PLAYBACK_VOLUME_MAX,
  PLAYBACK_VOLUME_MIN,
  normalizePlaybackVolume,
  playbackVolumePercent
} from "../services/playback-volume.js";

assert.equal(PLAYBACK_VOLUME_MIN, 0);
assert.equal(PLAYBACK_VOLUME_MAX, 2);
assert.equal(normalizePlaybackVolume(-0.2), 0);
assert.equal(normalizePlaybackVolume(0.8), 0.8);
assert.equal(normalizePlaybackVolume(3), 2);
assert.equal(normalizePlaybackVolume("bad", 1.4), 1.4);
assert.equal(playbackVolumePercent(1.25), 125);

console.log("播放音量：范围限制、放大和百分比显示通过");

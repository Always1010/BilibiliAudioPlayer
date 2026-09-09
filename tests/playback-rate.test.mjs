import assert from "node:assert/strict";
import {
  PLAYBACK_RATE_MAX,
  PLAYBACK_RATE_MIN,
  PLAYBACK_RATE_PRESETS,
  PLAYBACK_RATE_STEP,
  normalizePlaybackRate,
  playbackRateLabel
} from "../services/playback-rate.js";

assert.equal(PLAYBACK_RATE_MIN, 0.5);
assert.equal(PLAYBACK_RATE_MAX, 4);
assert.equal(PLAYBACK_RATE_STEP, 0.1);
assert.deepEqual(PLAYBACK_RATE_PRESETS, [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4]);
assert.equal(normalizePlaybackRate(1.26), 1.3);
assert.equal(normalizePlaybackRate(0.1), 0.5);
assert.equal(normalizePlaybackRate(9), 4);
assert.equal(normalizePlaybackRate("bad", 1.5), 1.5);
assert.equal(playbackRateLabel(1), "1×");
assert.equal(playbackRateLabel(1.26), "1.3×");

console.log("播放倍速：范围、0.1 档位、预设和显示文案通过");

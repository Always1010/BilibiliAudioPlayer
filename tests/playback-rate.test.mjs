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
assert.equal(normalizePlaybackRate(0.75), 0.75);
assert.equal(normalizePlaybackRate(0.1), 0.5);
assert.equal(normalizePlaybackRate(9), 4);
assert.equal(normalizePlaybackRate("bad", 1.5), 1.5);
assert.equal(playbackRateLabel(1), "1×");
assert.equal(playbackRateLabel(1.26), "1.3×");

console.log("播放倍速：范围、0.1 档位、预设和显示文案通过");

const { createOffscreenHarness } = await import("./helpers/offscreen.mjs");
const { audio, pending, run, flush } = await createOffscreenHarness();
await run('handleCommand("hydrate", {player:{playbackRate:1.75}})');
assert.equal(audio.defaultPlaybackRate, 1.8);
const loading = run('handleCommand("playQueue", {queue:[{id:"A"},{id:"B"}]})');
await flush();
await run('handleCommand("rate", {rate:2.5})');
pending.get('A')({ ok: true, data: { url: 'https://cdn/A' } });
await loading;
assert.equal(audio.playbackRate, 2.5);
assert.equal(audio.defaultPlaybackRate, 2.5);
assert.equal(run('state.playbackRate'), 2.5);
const next = run('handleCommand("playIndex", {index:1})');
await flush();
pending.get('B')({ ok: true, data: { url: 'https://cdn/B' } });
await next;
assert.equal(audio.playbackRate, 2.5, 'media load reset must not overwrite the preferred rate');
console.log("播放倍速：恢复设置、加载期间修改和切歌后保持通过");

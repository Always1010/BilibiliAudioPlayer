import assert from "node:assert/strict";
import { playbackModeLabel } from "../services/playback-mode.js";

assert.equal(playbackModeLabel("list"), "列表循环");
assert.equal(playbackModeLabel("single"), "单曲循环");
assert.equal(playbackModeLabel("shuffle"), "随机播放");
assert.equal(playbackModeLabel("unknown"), "列表循环");
console.log("播放模式：列表循环、单曲循环、随机播放提示通过");

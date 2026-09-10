import assert from "node:assert/strict";
import {
  PLAYBACK_PROGRESS_PERSIST_INTERVAL,
  playbackProgressReportPolicy
} from "../services/playback-progress.js";

assert.equal(PLAYBACK_PROGRESS_PERSIST_INTERVAL, 5);
assert.deepEqual(playbackProgressReportPolicy(6.2, 5, 5), {
  second: 6,
  shouldReport: true,
  shouldPersist: false
});
assert.deepEqual(playbackProgressReportPolicy(6.8, 6, 5), {
  second: 6,
  shouldReport: false,
  shouldPersist: false
});
assert.deepEqual(playbackProgressReportPolicy(10.1, 9, 5), {
  second: 10,
  shouldReport: true,
  shouldPersist: true
});
assert.equal(playbackProgressReportPolicy(17, 16, 10).shouldPersist, true);
assert.equal(playbackProgressReportPolicy(2, 3, 10).shouldPersist, true);
assert.deepEqual(playbackProgressReportPolicy(Number.NaN, -1, -1), {
  second: 0,
  shouldReport: true,
  shouldPersist: true
});

console.log("播放进度上报：界面逐秒刷新、存储每五秒持久化通过");

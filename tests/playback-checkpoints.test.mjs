import assert from "node:assert/strict";
import {
  checkpointFromPlayer,
  normalizePlaybackCheckpoints,
  playbackScopeKey,
  removePlaybackCheckpoint,
  resolvePlaybackCheckpoint,
  updatePlaybackCheckpoints
} from "../services/playback-checkpoints.js";

const queue = [
  { id: "BV1", title: "第一首", duration: 100 },
  { id: "BV2", title: "第二首", duration: 200 },
  { id: "BV3", title: "第三首", duration: 300 }
];
const context = { kind: "series", creatorId: "42", id: "7", title: "示例系列", order: "asc" };

assert.equal(playbackScopeKey(context), "series:42:7");
assert.equal(playbackScopeKey({ kind: "season", creatorId: "42", id: "8" }), "season:42:8");
assert.equal(playbackScopeKey({ kind: "playlist", id: "p1" }), "playlist:p1");
assert.equal(playbackScopeKey({ kind: "search", id: "7" }), null);
assert.equal(playbackScopeKey({ kind: "series", id: "7" }), null);

const player = {
  queue,
  queueIndex: 1,
  queueContext: context,
  currentTrack: queue[1],
  currentTime: 78.5,
  duration: 200
};
const checkpoint = checkpointFromPlayer(player, 1234);
assert.deepEqual(checkpoint, {
  scopeKey: "series:42:7",
  kind: "series",
  id: "7",
  creatorId: "42",
  title: "示例系列",
  trackId: "BV2",
  trackTitle: "第二首",
  index: 1,
  total: 3,
  position: 78.5,
  duration: 200,
  order: "asc",
  completed: false,
  updatedAt: 1234
});

let checkpoints = updatePlaybackCheckpoints(null, player, 1234);
assert.deepEqual(checkpoints.scopes["series:42:7"], checkpoint);
assert.deepEqual(updatePlaybackCheckpoints(checkpoints, {
  ...player,
  queueContext: { kind: "manual", title: "手动队列" }
}, 1500), checkpoints);

assert.deepEqual(resolvePlaybackCheckpoint(checkpoint, queue), {
  index: 1,
  position: 78.5,
  completed: false,
  missingTrack: false,
  track: queue[1]
});

const reordered = [queue[2], queue[1], queue[0]];
assert.equal(resolvePlaybackCheckpoint(checkpoint, reordered).index, 1);
const missing = resolvePlaybackCheckpoint({ ...checkpoint, trackId: "BV404", index: 2 }, queue);
assert.equal(missing.index, 2);
assert.equal(missing.position, 0);
assert.equal(missing.missingTrack, true);

const nearEnd = resolvePlaybackCheckpoint({ ...checkpoint, position: 198 }, queue);
assert.equal(nearEnd.index, 2);
assert.equal(nearEnd.position, 0);
const completed = checkpointFromPlayer({ ...player, queueIndex: 2, currentTrack: queue[2], currentTime: 298, duration: 300 }, 2000);
assert.equal(completed.completed, true);
assert.equal(resolvePlaybackCheckpoint(completed, queue).completed, true);
assert.equal(resolvePlaybackCheckpoint(completed, queue).index, 0);

checkpoints = removePlaybackCheckpoint(checkpoints, "series:42:7");
assert.deepEqual(checkpoints, { scopes: {} });
assert.deepEqual(normalizePlaybackCheckpoints({ scopes: { broken: { kind: "search" } } }), { scopes: {} });

console.log("播放检查点：作用域、更新、重排定位、缺失兜底、近尾跳转和完成状态通过");

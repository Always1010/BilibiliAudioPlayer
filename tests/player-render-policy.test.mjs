import assert from "node:assert/strict";
import { playerStructureKey } from "../services/player-render-policy.js";

const player = {
  queue: [{ id: "BV1", title: "示例作品", duration: 180, creator: { name: "示例UP主" } }],
  queueIndex: 0,
  queueContext: { title: "示例列表" },
  currentTrack: { id: "BV1", title: "示例作品", duration: 180, creator: { name: "示例UP主" } },
  playing: true,
  currentTime: 10,
  duration: 180,
  loading: false,
  source: { kind: "online" },
  mode: "list",
  error: null
};

const initial = playerStructureKey(player, { queueOpen: true });
assert.equal(playerStructureKey({ ...player, currentTime: 12, duration: 181 }, { queueOpen: true }), initial);
assert.notEqual(playerStructureKey({ ...player, playing: false }, { queueOpen: true }), initial);
assert.notEqual(playerStructureKey({ ...player, mode: "single" }, { queueOpen: true }), initial);
assert.notEqual(playerStructureKey({ ...player, source: { kind: "cache", format: "mp3", bitrate: 192 } }, { queueOpen: true }), initial);
assert.notEqual(playerStructureKey({ ...player, queueIndex: -1 }, { queueOpen: true }), initial);
assert.notEqual(playerStructureKey(player, { queueOpen: false }), initial);

console.log("播放器渲染策略：时间更新局部刷新，结构变化触发重建通过");

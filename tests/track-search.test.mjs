import assert from "node:assert/strict";
import {
  filterTracksByKeyword,
  normalizeTrackSearchKeyword
} from "../services/track-search.js";

const tracks = [
  { title: "AI 芯片简史", bvid: "BV1ABC", description: "从 GPU 到 NPU" },
  { title: "旅行手记：上海", bvid: "BV2DEF", description: "城市漫步" },
  { title: "聊聊 GPU 架构", bvid: "BV3GHI", description: "芯片设计" }
];

assert.equal(normalizeTrackSearchKeyword("  ＧＰＵ  "), "gpu");
assert.deepEqual(filterTracksByKeyword(tracks, "GPU 芯片"), [tracks[0], tracks[2]]);
assert.deepEqual(filterTracksByKeyword(tracks, "bv2def"), [tracks[1]]);
assert.deepEqual(filterTracksByKeyword(tracks, "城市 漫步"), [tracks[1]]);
assert.equal(filterTracksByKeyword(tracks, "不存在").length, 0);
assert.strictEqual(filterTracksByKeyword(tracks, ""), tracks);

console.log("作品搜索：规范化、多关键词、BV 号和描述匹配通过");

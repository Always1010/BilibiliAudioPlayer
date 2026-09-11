import assert from "node:assert/strict";
import { bilibiliVideoUrl } from "../services/bilibili-links.js";

assert.equal(
  bilibiliVideoUrl({ id: "BV1AB411C7mD", bvid: "BV1AB411C7mD" }),
  "https://www.bilibili.com/video/BV1AB411C7mD"
);
assert.equal(bilibiliVideoUrl({ id: "BV1TEST9999" }), "https://www.bilibili.com/video/BV1TEST9999");
assert.equal(bilibiliVideoUrl({ id: "12345", aid: 12345 }), "https://www.bilibili.com/video/av12345");
assert.equal(bilibiliVideoUrl({ id: "av67890" }), "https://www.bilibili.com/video/av67890");
assert.equal(bilibiliVideoUrl({ id: "javascript:alert(1)" }), "");
assert.equal(bilibiliVideoUrl(null), "");

console.log("哔哩哔哩作品链接：BV 号、AV 号、字段兜底和非法值拒绝通过");

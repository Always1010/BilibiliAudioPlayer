import assert from "node:assert/strict";
import { mockIndexedDB } from "./helpers/indexeddb.mjs";
import { deleteCacheLocation, getCacheRecord, putCacheRecord } from "../services/file-store.js";

globalThis.indexedDB = mockIndexedDB();
function record(id) {
  return { trackId: "BVTEST", title: "事务作品", id, path: [`${id}.mp3`], format: "mp3", bitrate: 192 };
}
await Promise.all([putCacheRecord(record("A")), putCacheRecord(record("B"))]);
assert.deepEqual((await getCacheRecord("BVTEST")).locations.map(item => item.id).sort(), ["A", "B"],
  "跨调用新增两个位置必须都保留");
await Promise.all([deleteCacheLocation("BVTEST", "A"), putCacheRecord(record("C"))]);
assert.deepEqual((await getCacheRecord("BVTEST")).locations.map(item => item.id).sort(), ["B", "C"],
  "删除与新增同时发生不能丢新增或复活删除位置");
indexedDB.failNextCommit();
await assert.rejects(putCacheRecord(record("D")), /模拟磁盘事务失败/, "请求成功不能当作事务提交成功");
assert.deepEqual((await getCacheRecord("BVTEST")).locations.map(item => item.id).sort(), ["B", "C"]);
console.log("缓存索引事务：并发新增、删除交叉和提交失败回滚通过");

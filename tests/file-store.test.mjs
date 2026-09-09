import assert from "node:assert/strict";
import { createDirectoryHandleCache, needsCacheDirectoryReauthorization } from "../services/file-store.js";

let loads = 0;
const first = { name: "目录一" };
const second = { name: "目录二" };
const cache = createDirectoryHandleCache(async () => {
  loads += 1;
  return loads === 1 ? first : second;
});

const [parallelA, parallelB] = await Promise.all([cache.get(), cache.get()]);
assert.equal(parallelA, first);
assert.equal(parallelB, first);
assert.equal(loads, 1, "并发读取应复用同一个目录加载任务");
assert.equal(await cache.get(), first);
assert.equal(loads, 1, "后续作品应复用已授权目录句柄");

cache.clear();
assert.equal(await cache.get(), second);
assert.equal(loads, 2, "主动刷新后应重新读取目录句柄");

const selected = { name: "用户新选目录" };
cache.set(selected);
assert.equal(await cache.get(), selected);
assert.equal(loads, 2, "用户新选目录应立即替换缓存且无需再次加载");

assert.equal(needsCacheDirectoryReauthorization({ configured: true, permission: "prompt" }), true);
assert.equal(needsCacheDirectoryReauthorization({ configured: true, permission: "denied" }), true);
assert.equal(needsCacheDirectoryReauthorization({ configured: true, permission: "granted" }), false);
assert.equal(needsCacheDirectoryReauthorization({ configured: false, permission: "prompt" }), false);
console.log("缓存目录：批次复用、并发复用和主动刷新通过");

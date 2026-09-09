import assert from "node:assert/strict";
import {
  createDirectoryHandleCache,
  needsCacheDirectoryReauthorization,
  pruneEmptyCacheDirectories,
  removeCacheFileAtPath
} from "../services/file-store.js";

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

function directory(entries = {}) {
  return {
    entries,
    async getDirectoryHandle(name) {
      if (!this.entries[name] || this.entries[name].kind !== "directory") {
        throw Object.assign(new Error("不存在"), { name: "NotFoundError" });
      }
      return this.entries[name];
    },
    async removeEntry(name) {
      const entry = this.entries[name];
      if (!entry) throw Object.assign(new Error("不存在"), { name: "NotFoundError" });
      if (entry.kind === "directory" && Object.keys(entry.entries).length) throw new Error("目录非空");
      delete this.entries[name];
    }
  };
}

const album = { kind: "directory", ...directory({ "作品.m4a": { kind: "file" } }) };
const creator = { kind: "directory", ...directory({ 合集: album }) };
const root = directory({ 测试UP_7: creator });
assert.deepEqual(await removeCacheFileAtPath(root, ["测试UP_7", "合集", "作品.m4a"]), { removed: true, missing: false });
assert.equal(await pruneEmptyCacheDirectories(root, ["测试UP_7", "合集"]), 2, "只应逐层清理已经为空的目录");
assert.equal(root.entries["测试UP_7"], undefined);
assert.deepEqual(await removeCacheFileAtPath(root, ["不存在", "作品.m4a"]), { removed: false, missing: true });

const mixedAlbum = { kind: "directory", ...directory({
  "目标作品.m4a": { kind: "file" },
  "用户笔记.txt": { kind: "file" }
}) };
const mixedRoot = directory({ 合集: mixedAlbum });
await removeCacheFileAtPath(mixedRoot, ["合集", "目标作品.m4a"]);
assert.equal(await pruneEmptyCacheDirectories(mixedRoot, ["合集"]), 0, "目录含未知文件时不能递归删除");
assert.equal(mixedRoot.entries.合集.entries["用户笔记.txt"].kind, "file");
console.log("缓存目录：批次复用、并发复用和主动刷新通过");

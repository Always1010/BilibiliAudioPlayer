import assert from "node:assert/strict";
import { mockDirectory, mockIndexedDB, mockWebLocks } from "./helpers/indexeddb.mjs";
import {
  chooseCacheDirectory, deleteCacheFiles, getCacheDirectoryInfo, getCacheRecord,
  listCacheRecords, putCacheRecord, withCacheDirectoryOperation
} from "../services/file-store.js";
import { createOffscreenHarness } from "./helpers/offscreen.mjs";
import { summarizeCacheTask } from "../services/cache-queue-state.js";

globalThis.indexedDB = mockIndexedDB();
Object.defineProperty(globalThis.navigator, "locks", { value: mockWebLocks(), configurable: true });
const root = mockDirectory("生命周期互斥");
globalThis.showDirectoryPicker = async () => root;
const { rootId } = await chooseCacheDirectory();
const record = { trackId: "BVOPERATION", id: "all:1:original:source", path: ["音频.m4a"], format: "original", size: 7 };
root.files.set("音频.m4a", { size: 7 });
await putCacheRecord(record);
let releaseScan;
let scanned;
const ready = new Promise(resolve => { scanned = resolve; });
let removed = false;
const remove = root.removeEntry.bind(root);
root.removeEntry = async name => { removed = true; return remove(name); };
const scanning = withCacheDirectoryOperation(async () => {
  // A real scan has already read the file and must register it before deletion
  // can start; otherwise the stale scan write could resurrect its index.
  scanned();
  await new Promise(resolve => { releaseScan = resolve; });
  await putCacheRecord({ ...record, verifiedAt: Date.now() });
});
await ready;
const deletion = deleteCacheFiles([{ trackId: record.trackId, locationId: record.id, rootId }]);
await new Promise(resolve => setTimeout(resolve, 20));
assert.equal(removed, false, "扫描读文件到索引提交之间删除必须等待");
releaseScan();
await scanning;
assert.equal((await deletion).deleted, 1);
assert.equal(await getCacheRecord(record.trackId), null, "删除后不能残留迟到的扫描索引");

let retainedLease;
await withCacheDirectoryOperation(async (_root, _rootId, lease) => {
  retainedLease = lease;
  await deleteCacheFiles([{ trackId: record.trackId, locationId: record.id, rootId }], lease);
  // Deletion within an existing lease must not recursively acquire the same
  // exclusive lock; playlist manifest edits run under this lease as well.
  root.files.set("音频.m4a", { size: 11 });
  await putCacheRecord({ ...record, size: 11 });
});
assert.equal((await getCacheRecord(record.trackId)).size, 11);
await assert.rejects(deleteCacheFiles([], retainedLease), /操作已结束/, "操作结束后不能复用租约绕过互斥");

let releaseCache;
let caching;
const cacheReady = new Promise(resolve => { caching = resolve; });
const downloading = withCacheDirectoryOperation(async () => {
  caching();
  await new Promise(resolve => { releaseCache = resolve; });
  root.files.set("音频.m4a", { size: 20 });
  await putCacheRecord({ ...record, size: 20 });
});
await cacheReady;
removed = false;
const queuedDeletion = deleteCacheFiles([{ trackId: record.trackId, locationId: record.id, rootId }]);
await new Promise(resolve => setTimeout(resolve, 20));
assert.equal(removed, false, "下载物理写入与索引提交不能和删除交叉");
releaseCache();
await downloading;
assert.equal((await queuedDeletion).deleted, 1);
assert.equal(root.files.has("音频.m4a"), false);
assert.equal(await getCacheRecord(record.trackId), null);

// Exercise the actual offscreen command, which also updates playlist manifests
// inside the outer lease. Omitting lease forwarding would deadlock here.
root.files.set("音频.m4a", { size: 30 });
await putCacheRecord({ ...record, size: 30 });
const { run } = await createOffscreenHarness({
  withCacheDirectoryOperation, deleteCacheFiles, getCacheDirectoryInfo, listCacheRecords, summarizeCacheTask
});
const command = await run(`handleCacheCommand("deleteCacheLocations", {
  locations: [{trackId:"${record.trackId}", locationId:"${record.id}", rootId:"${rootId}"}]
})`);
assert.equal(command.deletion.deleted, 1, "离屏删除命令复用外层lease，能完成而非等待自身锁");
assert.equal(await getCacheRecord(record.trackId), null);
console.log("缓存文件生命周期：扫描/下载与删除互斥、嵌套删除租约及结束后拒绝复用通过");

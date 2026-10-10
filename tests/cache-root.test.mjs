import assert from "node:assert/strict";
import { mockDirectory, mockIndexedDB, mockWebLocks } from "./helpers/indexeddb.mjs";
import {
  chooseCacheDirectory, deleteCacheFiles, deleteCacheLocation, findCachedFiles, getCacheDirectoryInfo,
  getCacheRecord, listCacheRecords, putCacheRecord, withCacheDirectoryOperation
} from "../services/file-store.js";
import { flattenCacheLocations } from "../services/cache-library.js";

globalThis.indexedDB = mockIndexedDB();
Object.defineProperty(globalThis.navigator, "locks", { value: mockWebLocks(), configurable: true });
let selected = mockDirectory("A");
globalThis.showDirectoryPicker = async () => selected;
const a = await chooseCacheDirectory();
const record = { trackId: "BVROOT", id: "all:1:original:source", path: ["音频.m4a"], format: "original", size: 7 };
selected.files.set("音频.m4a", { size: 7 });
const inA = await putCacheRecord(record);
await putCacheRecord({ ...record, trackId: "BVDECODE" });
assert.equal(inA.rootId, a.rootId);
assert.equal((await findCachedFiles(inA)).length, 1);
const leafA = flattenCacheLocations([inA])[0];
assert.equal(leafA.rootId, a.rootId);

selected = mockDirectory("B");
selected.files.set("音频.m4a", { size: 99 });
const b = await chooseCacheDirectory();
assert.notEqual(a.rootId, b.rootId);
assert.deepEqual(await listCacheRecords(), []);
assert.equal(await getCacheRecord("BVROOT"), null);
assert.deepEqual(await findCachedFiles(inA), [], "旧A索引不能命中B的同路径文件");
const inB = await putCacheRecord({ ...record, size: 99 });
await putCacheRecord({ ...record, trackId: "BVDECODE", size: 99 });
await deleteCacheLocation("BVDECODE", record.id, a.rootId);
assert.equal((await getCacheRecord("BVDECODE")).size, 99, "旧根媒体解码迟到清理只影响其原根索引");
const rejected = await deleteCacheFiles([leafA]);
assert.equal(rejected.failed, 1);
assert.equal(selected.files.get("音频.m4a").size, 99, "过期A删除目标不能触碰B文件");
const deleted = await deleteCacheFiles(flattenCacheLocations([inB]));
assert.equal(deleted.deleted, 1);

selected = mockDirectory("A");
await chooseCacheDirectory();
assert.equal((await getCacheDirectoryInfo()).rootId, a.rootId, "重新授权同一实体根沿用身份");
assert.equal((await getCacheRecord("BVROOT")).size, 7, "切回根A保留独立索引");
let release;
let started;
const ready = new Promise(resolve => { started = resolve; });
const running = withCacheDirectoryOperation(async () => { started(); await new Promise(resolve => { release = resolve; }); });
await ready;
selected = mockDirectory("C");
await assert.rejects(chooseCacheDirectory(), /任务正在执行/);
assert.equal((await getCacheDirectoryInfo()).rootId, a.rootId);
release();
await running;
await chooseCacheDirectory();

// Upgrade preserves ambiguous legacy indexes without using them for deletion.
indexedDB.stores.get("records").data.set("BVLEGACY", { ...record, trackId: "BVLEGACY" });
assert.equal((await getCacheDirectoryInfo()).unassignedCount, 1);
assert.equal(await getCacheRecord("BVLEGACY"), null);
assert.equal((await deleteCacheFiles([{ trackId: "BVLEGACY", locationId: record.id }])).failed, 1);
assert.equal(indexedDB.stores.get("records").data.has("BVLEGACY"), true);
await putCacheRecord({ ...record, trackId: "BVLEGACY", verifiedAt: Date.now() });
assert.equal((await getCacheDirectoryInfo()).unassignedCount, 0, "扫描校准到当前根的实际路径后提示可消除，旧索引仍保留");
const legacyRoot = mockDirectory("旧版根");
indexedDB.stores.get("handles").data.set("cache-directory", legacyRoot);
const migrated = await getCacheDirectoryInfo();
assert.ok(migrated.rootId);
assert.equal((await getCacheDirectoryInfo()).rootId, migrated.rootId, "旧句柄根身份只创建一次");
assert.deepEqual(await listCacheRecords(), [], "为旧句柄建根身份不得顺带猜测旧索引归属");
console.log("缓存根目录：隔离、回切、过期目标拒绝、忙时门禁和旧索引保留通过");

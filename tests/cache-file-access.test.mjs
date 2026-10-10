import assert from "node:assert/strict";
import { mockDirectory, mockIndexedDB, mockWebLocks } from "./helpers/indexeddb.mjs";
import { chooseCacheDirectory, findCachedFiles, getCacheRecord, putCacheRecord } from "../services/file-store.js";

globalThis.indexedDB = mockIndexedDB();
Object.defineProperty(globalThis.navigator, "locks", { value: mockWebLocks(), configurable: true });
const root = mockDirectory("访问错误测试");
globalThis.showDirectoryPicker = async () => root;
await chooseCacheDirectory();
root.files.set("good.m4a", { size: 12 });
root.files.set("empty.m4a", { size: 0 });
const originalGet = root.getFileHandle.bind(root);
root.getFileHandle = async name => {
  if (name === "denied.m4a") throw Object.assign(new Error("权限暂时撤回"), { name: "NotAllowedError" });
  if (name === "busy.m4a") return { async getFile() { throw Object.assign(new Error("设备暂时忙"), { name: "NotReadableError" }); } };
  return originalGet(name);
};
for (const id of ["good", "empty", "missing", "denied", "busy"]) {
  await putCacheRecord({ trackId: "BVACCESS", id, path: [`${id}.m4a`], format: "original", size: 12 });
}
const results = await findCachedFiles(await getCacheRecord("BVACCESS"));
assert.deepEqual(results.map(item => item.location.id), ["good"], "一个错误不能阻止其余有效副本");
assert.deepEqual(results.accessErrors.map(error => error.name).sort(), ["NotAllowedError", "NotReadableError"]);
assert.equal(results.accessErrors.every(error => error.recoverable && error.rootId), true);
assert.deepEqual((await getCacheRecord("BVACCESS")).locations.map(item => item.id).sort(), ["busy", "denied", "good"],
  "只有确认不存在与确认空文件允许清索引");
root.queryPermission = async () => "denied";
const denied = await findCachedFiles(await getCacheRecord("BVACCESS"));
assert.equal(denied.length, 0);
assert.equal(denied.accessErrors[0].name, "NotAllowedError");
assert.equal((await getCacheRecord("BVACCESS")).locations.length, 3);
root.queryPermission = async () => "granted";
root.files.set("denied.m4a", { size: 20 });
root.files.set("busy.m4a", { size: 24 });
root.getFileHandle = originalGet;
const recovered = await findCachedFiles(await getCacheRecord("BVACCESS"));
assert.equal(recovered.length, 3, "恢复权限与设备后无需扫描即可重新使用保留索引");
assert.deepEqual(recovered.accessErrors, []);
console.log("缓存读取：权限与暂时I/O错误保留索引、其余副本回退、恢复后复用通过");

import assert from "node:assert/strict";
import { createOffscreenHarness } from "./helpers/offscreen.mjs";
import { archiveScope } from "../services/cache-records.js";
import { addCacheHistory, attachAutoCacheRequest, summarizeCacheTask } from "../services/cache-queue-state.js";
import { normalizeMp3Bitrate } from "../services/mp3.js";

const events = [];
let finish;
let permissionFailure = false;
const { run, flush } = await createOffscreenHarness({
  archiveScope, addCacheHistory, attachAutoCacheRequest, summarizeCacheTask, normalizeMp3Bitrate,
  getCacheDirectoryInfo: async () => ({ rootId: "root-a" }),
  getCacheRecord: async () => ({ trackId: "BV1TEST" }),
  findCachedFile: async () => new Promise(resolve => { finish = () => resolve({ file: new Blob(["audio"]), location: {} }); }),
  withCacheDirectoryOperation: async operation => {
    if (permissionFailure) throw new Error("权限已失效");
    return operation({}, "root-a");
  },
  chrome: { runtime: {
    onMessage: { addListener() {} },
    async sendMessage(message) { events.push(message.cache); return { ok: true }; }
  } }
});
const base = { tracks: [{ id: "BV1TEST", creator: { id: "7" } }], section: { type: "season", id: "s1" } };
const command = payload => run(`handleCacheCommand("cacheTracks", ${JSON.stringify(payload)})`);
await command(base);
await flush();
await command({ ...base, autoCache: { key: "job-1", attemptId: "old" } });
await command({ ...base, autoCache: { key: "job-1", attemptId: "new" } });
await command({ ...base, autoCache: { key: "job-2", attemptId: "second" } });
assert.equal(run("cacheQueue.length"), 0, "同根同目标复用当前手动任务");
assert.equal(run("cacheSnapshot().current.autoCacheRequests.length"), 2);
finish();
await flush();
const skipped = events.find(event => event?.status === "skipped");
assert.deepEqual(skipped.autoCacheRequests, [{ key: "job-1", attemptId: "new" }, { key: "job-2", attemptId: "second" }]);
assert.equal(skipped.rootId, "root-a");
assert.ok(skipped.outcomeId);
assert.equal(skipped.recent[0].outcomeId, skipped.outcomeId, "活动与历史共用一次终态身份");
await command({ ...base, rootId: "root-b", autoCache: { key: "job-old-root", attemptId: "attempt" } });
await flush();
const wrongRoot = events.find(event => event?.status === "failed" && event.autoCacheKeys.includes("job-old-root"));
assert.ok(wrongRoot, "入队与执行期间切根必须失败");
permissionFailure = true;
await command({ ...base, autoCache: { key: "job-no-permission", attemptId: "attempt" } });
await flush();
const denied = events.find(event => event?.status === "failed" && event.autoCacheKeys.includes("job-no-permission"));
assert.ok(denied, "获取目录失败仍回报对应自动任务");
assert.equal(denied.recent[0].outcomeId, denied.outcomeId);
console.log("自动缓存事件：合并订阅尝试、终态身份、根目录过期和权限失败关联通过");

import assert from "node:assert/strict";
import { backgroundHarness, deferred } from "./helpers/background-harness.mjs";
import { mergeSubscriptionCheckResults } from "../services/subscriptions.js";

const subscription = { creatorId: "42", enabled: true, revision: "initial", mode: "download", section: { type: "all", id: "all" }, lastSeenIds: ["old"] };
const listing = deferred();
let reads = 0;
const app = await backgroundHarness({
  creators: [{ id: "42", name: "UP" }], creatorContent: {}, settings: {},
  subscriptions: { sub: structuredClone(subscription) }, updateState: {}
}, { listCreatorVideos: () => { reads += 1; return listing.promise; } });
const checking = app.run("checkAllCreators()");
const checkingAgain = app.run("checkAllCreators()");
await Promise.resolve();
app.values.subscriptions = { added: { ...subscription, revision: "new" } };
listing.resolve({ items: [{ id: "old" }], total: 1 });
await Promise.all([checking, checkingAgain]);
assert.equal(reads, 1, "同时触发的追更检查复用一次工作");
assert.equal(app.values.subscriptions.sub, undefined, "不能复活期间关闭的订阅");
assert.equal(app.values.subscriptions.added.revision, "new", "不能抹掉期间新增的订阅");

const updated = mergeSubscriptionCheckResults({ sub: { ...subscription, revision: "changed", lastSeenIds: ["latest"] } }, {
  sub: { subscription, patch: { lastSeenIds: ["stale"] } }
});
assert.deepEqual(updated.sub.lastSeenIds, ["latest"], "变更配置后拒绝旧检查结果");

const late = deferred();
let queued = 0;
const disabled = await backgroundHarness({
  creators: [{ id: "42", name: "UP" }], creatorContent: {}, settings: {},
  subscriptions: { sub: structuredClone(subscription) }, updateState: {}
}, { listCreatorVideos: () => late.promise });
disabled.context.chrome.runtime.sendMessage = async message => {
  if (message.command === "cacheTracks") queued += 1;
  return { ok: true, data: { directory: { permission: "granted" } } };
};
const pending = disabled.run("checkAllCreators()");
await Promise.resolve();
disabled.values.subscriptions = {};
late.resolve({ items: [{ id: "new" }], total: 1 });
await pending;
assert.equal(queued, 0, "关闭订阅后旧网络响应不能继续加入自动任务");
console.log("订阅并发：关闭/新增/改配置、入队前重验和重复检查合并通过");

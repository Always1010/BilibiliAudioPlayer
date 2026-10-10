import assert from "node:assert/strict";
import { backgroundHarness, deferred } from "./helpers/background-harness.mjs";

const subscription = { creatorId: "42", section: { type: "all", id: "all", key: "all", title: "全部" }, enabled: true, revision: "r1", mode: "download", baselineVersion: 2, lastSeenIds: ["old"] };
const values = () => ({ creators: [{ id: "42", name: "UP" }], creatorContent: {}, settings: { defaultFormat: "mp3", mp3Bitrate: 192 }, subscriptions: { sub: structuredClone(subscription) }, updateState: {}, autoCacheJobs: {} });
const app = await backgroundHarness(values(), { listCreatorVideos: async () => ({ items: [{ id: "new", bvid: "new" }, { id: "old" }], total: 2 }) });
let sent = [];
let active = [];
let recent = [];
let response = { ok: false, error: "队列拒绝任务" };
app.context.chrome.runtime.sendMessage = async message => {
  if (message.command === "status") return { ok: true, data: { directory: { permission: "granted", rootId: "root-a" }, pending: active, recent } };
  sent.push(message.payload);
  assert.equal(Object.keys(app.values.autoCacheJobs).length, 1, "发送前任务已持久保存");
  return response;
};
await app.run("checkAllCreators()");
let key = Object.keys(app.values.autoCacheJobs)[0];
assert.equal(app.values.autoCacheJobs[key].status, "failed", "ok:false不能误报成功");
assert.match(app.values.subscriptions.sub.lastError, /队列拒绝/);
assert.equal(sent.length, 1);
await app.run("checkAllCreators()");
assert.equal(sent.length, 1, "退避期不重复发送");
assert.match(app.values.subscriptions.sub.lastError, /队列拒绝/, "普通检查不得清掉未解决缓存错误");
app.values.autoCacheJobs[key].nextRetryAt = 0;
response = { ok: true, data: { accepted: true } };
await app.run("dispatchAutoCacheJobs()");
assert.equal(app.values.autoCacheJobs[key].status, "queued", "接收入队仍是待完成任务");
active = [{ autoCacheKeys: [key] }];
await app.run("dispatchAutoCacheJobs()");
assert.equal(sent.length, 2, "活动队列中的任务不重发");

const attempt = sent.at(-1).autoCache;
const wrong = { status: "completed", rootId: "root-b", autoCacheKeys: [key], autoCacheRequests: [attempt] };
app.context.outcome = wrong;
await app.run("applyAutoCacheOutcome(outcome)");
assert.ok(app.values.autoCacheJobs[key], "其他根结果不能确认当前任务");
app.context.outcome = { ...wrong, rootId: "root-a", autoCacheRequests: [{ key, attemptId: "old-attempt" }] };
await app.run("applyAutoCacheOutcome(outcome)");
assert.ok(app.values.autoCacheJobs[key], "过期重试结果不能确认当前任务");
const failure = { status: "failed", rootId: "root-a", message: "设备离线", autoCacheKeys: [key], autoCacheRequests: [attempt], outcomeId: "failure1" };
app.context.outcome = failure;
await app.run("applyAutoCacheOutcome(outcome)");
const attempts = app.values.autoCacheJobs[key].attempts;
recent = [failure];
active = [];
await app.run("dispatchAutoCacheJobs()");
assert.equal(app.values.autoCacheJobs[key].attempts, attempts, "相同历史失败只处理一次，不推迟重试");

// A fresh background worker has only durable storage and the offscreen snapshot.
app.values.autoCacheJobs[key].status = "queued";
app.values.autoCacheJobs[key].nextRetryAt = 0;
const restarted = await backgroundHarness(app.values);
restarted.context.chrome.runtime.sendMessage = async message => {
  if (message.command === "status") return { ok: true, data: { directory: { permission: "granted", rootId: "root-a" }, pending: [], recent: [] } };
  sent.push(message.payload);
  return { ok: true, data: { accepted: true } };
};
await restarted.run("dispatchAutoCacheJobs()");
assert.equal(sent.length, 3, "后台队列消失后重启重新发送未完成任务");
const latestAttempt = sent.at(-1).autoCache;
restarted.context.outcome = { status: "skipped", rootId: "root-a", autoCacheKeys: [key], autoCacheRequests: [latestAttempt] };
await restarted.run("handleMessage({type:MESSAGE.cacheEvent,cache:outcome})");
assert.equal(Object.keys(app.values.autoCacheJobs).length, 0, "实际skipped/completed才删除待办");
assert.equal(app.values.subscriptions.sub.lastError, null);

const instant = await backgroundHarness(values(), { listCreatorVideos: async () => ({ items: [{ id: "new" }], total: 1 }) });
instant.context.chrome.runtime.sendMessage = async message => {
  if (message.command === "status") return { ok: true, data: { directory: { permission: "granted", rootId: "root-a" } } };
  instant.context.outcome = { status: "completed", rootId: "root-a", autoCacheKeys: [message.payload.autoCache.key], autoCacheRequests: [message.payload.autoCache] };
  await instant.run("applyAutoCacheOutcome(outcome)");
  return { ok: true, data: { accepted: true } };
};
await instant.run("checkAllCreators()");
assert.equal(Object.keys(instant.values.autoCacheJobs).length, 0, "完成事件先于接收响应不能复活任务");

const unavailable = await backgroundHarness(values(), { listCreatorVideos: async () => ({ items: [{ id: "new" }], total: 1 }) });
unavailable.context.chrome.runtime.sendMessage = async () => ({ ok: true, data: { directory: { permission: "denied", rootId: "root-a" } } });
await unavailable.run("checkAllCreators()");
assert.equal(Object.keys(unavailable.values.autoCacheJobs).length, 1, "无授权时新增任务仍持久保存");
unavailable.values.subscriptions = {};
await unavailable.run("dispatchAutoCacheJobs()");
assert.equal(Object.keys(unavailable.values.autoCacheJobs).length, 0, "取消订阅后清除过期待办且不重新发送");

const interleaved = await backgroundHarness(values());
const gate = deferred();
interleaved.context.gate = gate.promise;
interleaved.context.replacement = {};
const precedingWrite = interleaved.run("updateStorageValue(STORAGE_KEYS.autoCacheJobs,async()=>{await gate;return replacement})");
const dispatch = interleaved.run("dispatchAutoCacheJobs()");
await new Promise(resolve => setImmediate(resolve));
const revised = { ...subscription, revision: "r2", lastSeenIds: ["old", "new"] };
interleaved.values.subscriptions.sub = revised;
const revisedJobs = interleaved.context.createAutoCacheJobs("sub", revised, [{ id: "new" }], {});
interleaved.context.replacement[revisedJobs[0].key] = revisedJobs[0];
gate.resolve();
await precedingWrite;
await dispatch;
assert.equal(Object.keys(interleaved.values.autoCacheJobs).length, 1,
  "等待写锁期间新订阅任务不能被旧快照全表清理");
console.log("自动缓存：持久入队、拒绝与退避、活动去重、重启恢复、结果身份、历史去重、迟到确认及取消通过");

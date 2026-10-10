import assert from "node:assert/strict";
import { backgroundHarness, deferred } from "./helpers/background-harness.mjs";

const items = Array.from({ length: 125 }, (_, i) => ({ id: `v${i}`, bvid: `v${i}` }));
const values = () => ({ creators: [{ id: "42", name: "UP" }], creatorContent: {}, settings: {}, subscriptions: {}, updateState: {} });
const pages = [];
const app = await backgroundHarness(values(), {
  listCreatorVideos: async (id, page, size) => {
    pages.push([page, size]);
    return { items: items.slice((page - 1) * size, page * size), total: items.length, pageSize: size };
  }
});
await app.run('setSubscription({creatorId:"42",section:{type:"all",id:"all",key:"all"},enabled:true,lastSeenIds:["v0"]})');
assert.equal(app.values.subscriptions["42:all"].lastSeenIds.length, 125);
assert.deepEqual(pages, [[1, 50], [2, 50], [3, 50]], "初始基线必须分页读完整");
const queued = [];
app.context.chrome.runtime.sendMessage = async message => {
  if (message.command === "cacheTracks") queued.push(...message.payload.tracks);
  return { ok: true, data: { accepted: true, directory: { permission: "granted", rootId: "test-root" } } };
};
const added = Array.from({ length: 12 }, (_, i) => ({ id: `new${i}` }));
items.unshift(...added);
await app.run("checkAllCreators()");
assert.equal(queued.length, 12, "短时间发布超过10首不能漏检");
assert.equal(app.values.subscriptions["42:all"].lastSeenIds.length, 137);

const seasonItems = Array.from({ length: 105 }, (_, i) => ({ id: `s${i}` }));
const season = await backgroundHarness(values(), {
  listCreatorVideos: async () => { throw new Error("全部作品接口暂时失败"); },
  listContainerVideos: async (id, type, section, page, size) => ({ items: seasonItems.slice((page - 1) * size, page * size), total: seasonItems.length, pageSize: size })
});
await season.run('setSubscription({creatorId:"42",section:{type:"season",id:"7",key:"season:7"},enabled:true})');
assert.equal(season.values.subscriptions["42:season:7"].lastSeenIds.length, 105);
seasonItems.push({ id: "tail-new" });
season.context.chrome.runtime.sendMessage = async message => {
  if (message.command === "cacheTracks") queued.push(...message.payload.tracks);
  return { ok: true, data: { accepted: true, directory: { permission: "granted", rootId: "test-root" } } };
};
await season.run("checkAllCreators()");
assert.equal(queued.at(-1).id, "tail-new", "合集末页新增仍检测，且不依赖全部作品接口");

const late = deferred();
const concurrent = await backgroundHarness(values(), { listCreatorVideos: () => late.promise });
const baseline = concurrent.run('setSubscription({creatorId:"42",section:{type:"all",id:"all",key:"all"},enabled:true})');
await new Promise(resolve => setImmediate(resolve));
await concurrent.run('setSubscription({creatorId:"42",section:{type:"all",id:"all",key:"all"},enabled:false})');
late.resolve({ items: [], total: 0 });
await baseline;
assert.equal(concurrent.values.subscriptions["42:all"], undefined, "迟到基线不能复活已关闭订阅");

const incomplete = await backgroundHarness(values(), { listCreatorVideos: async () => ({ items: [{ id: "only" }], total: 120, pageSize: 50 }) });
await incomplete.run('setSubscription({creatorId:"42",section:{type:"all",id:"all",key:"all"},enabled:true})');
assert.equal(incomplete.values.subscriptions["42:all"].baselinePending, true);
assert.equal(incomplete.values.subscriptions["42:all"].lastSeenIds.length, 0, "残缺页不能提交为完整基线");
const legacy = await backgroundHarness(values(), { listCreatorVideos: async () => ({ items: [{ id: "old" }, { id: "older" }], total: 2 }) });
legacy.values.subscriptions.sub = { creatorId: "42", section: { type: "all" }, enabled: true, mode: "download", lastSeenIds: ["old"] };
let legacyQueued = 0;
legacy.context.chrome.runtime.sendMessage = async () => { legacyQueued += 1; return { ok: true }; };
await legacy.run("checkAllCreators()");
assert.equal(legacyQueued, 0, "升级旧局部基线不能批量误下载历史作品");
assert.equal(legacy.values.subscriptions.sub.baselineVersion, 2);
assert.equal(legacy.values.subscriptions.sub.lastSeenIds.length, 2);
console.log("追更完整分页：125首基线、12首突发更新、合集末页、关闭竞态、残缺基线重试与旧基线升级通过");

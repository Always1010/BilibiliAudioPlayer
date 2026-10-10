import assert from "node:assert/strict";
import { backgroundHarness, deferred } from "./helpers/background-harness.mjs";

const profile = deferred();
const values = {
  creators: [{ id: "A", name: "旧名称" }, { id: "B", name: "B" }],
  settings: { activeCreatorId: "A" }, creatorContent: {}, subscriptions: {}, updateState: {}
};
const app = await backgroundHarness(values, {
  getCreator: () => profile.promise,
  listAllCreatorContainers: async () => ({ seasons: [], series: [] }),
  getLoginStatus: async () => ({ isLoggedIn: false })
});
const loading = app.run('loadCreator("A", true)');
await Promise.resolve();
values.settings.activeCreatorId = "B";
profile.resolve({ id: "A", name: "新名称" });
await loading;
assert.equal(values.settings.activeCreatorId, "B", "读取资料不改变后来选择的 UP 主");
assert.equal(values.creators[0].name, "新名称", "资料仍可更新已关注对象");

const removed = deferred();
app.context.getCreator = () => removed.promise;
const late = app.run('loadCreator("A", true)');
await Promise.resolve();
values.creators = values.creators.filter(item => item.id !== "A");
removed.resolve({ id: "A", name: "迟到资料" });
await late;
assert.equal(values.creators.some(item => item.id === "A"), false, "迟到资料不得恢复已移除的关注");
console.log("后台读取资料：保持当前选择并避免复活已移除的 UP 主通过");

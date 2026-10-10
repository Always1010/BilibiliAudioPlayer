import assert from "node:assert/strict";
import { MESSAGE } from "../shared/constants.js";
import { appHarness } from "./helpers/app-harness.mjs";

const tracks = Array.from({ length: 120 }, (_, i) => ({ id: `BV${i}`, title: `作品${i}` }));
const pages = [];
const cached = [];
let incomplete = false;
const app = await appHarness(async message => {
  if (message.type === MESSAGE.loadSection) {
    pages.push([message.page, message.pageSize]);
    return { ok: true, data: { pageSize: 50, total: 120, items: incomplete && message.page > 1 ? [] : tracks.slice((message.page - 1) * 50, message.page * 50) } };
  }
  if (message.type === MESSAGE.cacheCommand) {
    cached.push(...message.payload.tracks);
    return { ok: true, data: {} };
  }
  throw new Error(`unexpected message ${message.type}`);
});
app.ui.app = { creators: [{ id: "42", name: "UP" }], settings: { activeCreatorId: "42", defaultFormat: "m4a" } };
await app.run('cacheWholeSection({ id: "all", type: "all", title: "全部作品" })');
assert.deepEqual(pages, [[1, 50], [2, 50], [3, 50]]);
assert.equal(cached.length, 120);
assert.equal(new Set(cached.map(track => track.id)).size, 120);
assert.match(app.ui.notice, /120 个作品已加入/);

// 不能以部分数据成功入队并显示全栏目完成。
incomplete = true;
cached.length = 0;
await assert.rejects(app.run('cacheWholeSection({ id: "all", type: "all", title: "全部作品" })'), /未完整返回/);
assert.equal(cached.length, 0);
console.log("真实 UI 全部作品缓存：120 条完整分页和不完整响应拒绝通过");

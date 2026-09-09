import assert from "node:assert/strict";
import { loadAllSectionPages } from "../services/section-pagination.js";

const calls = [];
const progress = [];
const listing = await loadAllSectionPages(async (page, pageSize) => {
  calls.push([page, pageSize]);
  return page === 1
    ? { total: 4, items: [{ id: "a" }, { id: "b" }] }
    : { total: 4, items: [{ id: "b" }, { id: "c" }, { id: "d" }] };
}, { pageSize: 2, onProgress: value => progress.push([value.page, value.items.length, value.total]) });

assert.deepEqual(calls, [[1, 2], [2, 2]]);
assert.deepEqual(listing.items.map(item => item.id), ["a", "b", "c", "d"]);
assert.deepEqual(progress, [[1, 2, 4], [2, 4, 4]]);

await assert.rejects(
  () => loadAllSectionPages(async () => ({ total: 3, items: [{ id: "a" }, { id: "b" }] }), { pageSize: 2 }),
  /未完整返回/
);

console.log("栏目分页：完整读取、去重、进度和异常中止通过");

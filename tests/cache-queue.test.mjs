import assert from "node:assert/strict";
import {
  CACHE_HISTORY_LIMIT,
  addCacheHistory,
  summarizeCacheTask
} from "../services/cache-queue-state.js";

const task = {
  track: {
    id: "BV1TEST",
    title: "测试作品",
    creator: { id: "1", name: "测试UP主" },
    description: "不应复制到队列快照的大字段"
  },
  section: { id: "10", type: "season", title: "测试合集", cover: "不应复制" },
  format: "mp3",
  bitrate: 192,
  position: 3
};

const summary = summarizeCacheTask(task);
assert.deepEqual(summary.track, {
  id: "BV1TEST",
  title: "测试作品",
  creator: { id: "1", name: "测试UP主" }
});
assert.deepEqual(summary.section, { id: "10", type: "season", title: "测试合集" });
assert.equal(summary.format, "mp3");
assert.equal(summary.bitrate, 192);

let history = [];
history = addCacheHistory(history, task, { status: "downloading" }, 1);
assert.equal(history.length, 0, "进行中状态不应进入最近任务");
for (let index = 0; index < CACHE_HISTORY_LIMIT + 5; index += 1) {
  history = addCacheHistory(history, task, {
    status: index % 2 ? "completed" : "failed",
    message: index % 2 ? "" : "测试失败",
    record: { size: index }
  }, index);
}
assert.equal(history.length, CACHE_HISTORY_LIMIT);
assert.equal(history[0].finishedAt, CACHE_HISTORY_LIMIT + 4);
assert.equal(history[0].status, "failed");
assert.equal(history[0].message, "测试失败");
console.log("缓存队列：任务摘要、终态历史和数量上限通过");

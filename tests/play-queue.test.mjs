import assert from "node:assert/strict";
import { insertQueueItems, removeQueueItem, reorderQueue } from "../services/play-queue.js";

const a = { id: "a" };
const b = { id: "b" };
const c = { id: "c" };

assert.deepEqual(reorderQueue([a, b, c], 2, 0, 1), {
  queue: [c, a, b],
  currentIndex: 2
});
assert.deepEqual(removeQueueItem([a, b, c], 0, 1), {
  queue: [b, c],
  currentIndex: 0,
  removedCurrent: false
});
assert.deepEqual(removeQueueItem([a, b, c], 1, 1), {
  queue: [a, c],
  currentIndex: 1,
  removedCurrent: true
});
assert.deepEqual(removeQueueItem([a], 0, 0), {
  queue: [],
  currentIndex: -1,
  removedCurrent: true
});
assert.deepEqual(insertQueueItems([a, b], [c], 0, true), [a, c, b]);
assert.deepEqual(insertQueueItems([a], [b, c], 0, false), [a, b, c]);

console.log("播放队列：重排、移除当前项和追加位置通过");

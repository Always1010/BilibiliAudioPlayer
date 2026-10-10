import assert from "node:assert/strict";
import { MESSAGE } from "../shared/constants.js";
import { appHarness } from "./helpers/app-harness.mjs";

const tracks = Array.from({ length: 120 }, (_, i) => ({ id: `BV${i}`, title: `作品${i}`, publishedAt: i + 1 }));
const messages = [];
const app = await appHarness(async message => {
  messages.push(message);
  if (message.type === MESSAGE.loadSection) {
    return { ok: true, data: { total: tracks.length, pageSize: 50, items: tracks.slice((message.page - 1) * 50, message.page * 50) } };
  }
  if (message.type === MESSAGE.playerCommand) return { ok: true, data: { queue: message.payload.queue } };
  throw new Error(`unexpected message ${message.type}`);
});
app.ui.app = {
  creators: [{ id: "42", name: "UP" }], settings: { activeCreatorId: "42", sectionSortDirection: "asc" },
  creatorContent: {}, player: {}
};
app.ui.activeContent = { all: { items: tracks.slice(0, 30), total: 120 }, containers: {} };
await app.click({ action: "play-track", sectionKey: "all", trackId: "BV15" });
let playback = messages.find(message => message.type === MESSAGE.playerCommand);
assert.equal(playback.command, "playQueue");
assert.equal(playback.payload.queue.length, 120);
assert.equal(playback.payload.queue[playback.payload.index].id, "BV15");
assert.equal(playback.payload.queueContext.creatorId, "42");
assert.equal(playback.payload.queueContext.kind, "all");
assert.deepEqual(messages.filter(message => message.type === MESSAGE.loadSection).map(message => message.page), [1, 2, 3]);

messages.length = 0;
app.ui.view = "detail";
app.ui.activeSection = { key: "all", id: "all", type: "all", title: "全部作品", total: 120, creator: { id: "42", name: "UP" } };
app.ui.detailData = { items: tracks.slice(0, 50), total: 120 };
app.ui.app.settings.sectionSortDirection = "desc";
await app.click({ action: "play-track", sectionKey: "all", trackId: "BV48" });
playback = messages.find(message => message.type === MESSAGE.playerCommand);
assert.equal(playback.payload.queue.length, 120);
assert.equal(playback.payload.queue[playback.payload.index].id, "BV48");
assert.equal(playback.payload.queue[0].id, "BV119");
assert.equal(playback.payload.queueContext.order, "desc");
assert.equal(app.ui.detailData.items.length, 120);
console.log("真实 UI 单首起播：全部作品主页/详情均补全120条队列、排序与所选起播项通过");

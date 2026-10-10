import assert from "node:assert/strict";
import { MESSAGE } from "../shared/constants.js";
import { appHarness } from "./helpers/app-harness.mjs";

const commands = [];
const originalQueue = [{ id: "BV1", title: "作品1" }, { id: "BV2", title: "作品2" }];
const app = await appHarness(async message => {
  assert.equal(message.type, MESSAGE.playerCommand, "暂停和恢复不能请求栏目或重建队列");
  commands.push(message);
  return { ok: true, data: { playing: message.command !== "pause" } };
});
app.ui.app = {
  creators: [{ id: "42", name: "UP" }], settings: { activeCreatorId: "42" },
  player: { currentTrack: originalQueue[0], playing: true, currentTime: 83, queue: originalQueue }
};
app.ui.activeContent = { all: { total: 2, items: originalQueue }, containers: {} };
await app.click({ action: "play-track", sectionKey: "all", trackId: "BV1" });
assert.equal(commands[0].command, "pause");
assert.equal(app.ui.app.player.playing, false);
assert.equal(app.ui.app.player.currentTime, 83);
assert.equal(app.ui.app.player.queue, originalQueue);
await app.click({ action: "play-track", sectionKey: "all", trackId: "BV1" });
assert.equal(commands[1].command, "resume");
assert.equal(app.ui.app.player.currentTime, 83);
assert.equal(app.ui.app.player.queue, originalQueue);
await app.click({ action: "play-track", sectionKey: "all", trackId: "BV2" });
assert.equal(commands[2].command, "playQueue");
assert.equal(commands[2].payload.queue[commands[2].payload.index].id, "BV2");
console.log("真实 UI 作品行按钮：当前作品暂停/恢复保留83秒位置和队列，其他作品正常切换通过");

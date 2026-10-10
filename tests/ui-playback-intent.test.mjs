import assert from "node:assert/strict";
import { MESSAGE } from "../shared/constants.js";
import { appHarness } from "./helpers/app-harness.mjs";

for (const control of ["pause", "resume", "next", "previous", "clear-play-queue", "remove-queue-item", "play-queue-index", "play-track"]) {
  const commands = [];
  let resolveListing;
  const app = await appHarness(message => {
    if (message.type === MESSAGE.loadSection) {
      assert.equal(message.page, 1, "过期播放意图不应继续读取下一页");
      return new Promise(resolve => { resolveListing = resolve; });
    }
    assert.equal(message.type, MESSAGE.playerCommand);
    commands.push(message.command);
    return Promise.resolve({ ok: true, data: { playing: message.command !== "pause" } });
  });
  app.ui.app = {
    creators: [{ id: "42", name: "UP" }], settings: { activeCreatorId: "42" }, creatorContent: {},
    player: { currentTrack: { id: "BV1" }, playing: true, currentTime: 83, queueIndex: 0 }
  };
  app.ui.activeContent = { all: { total: 120, items: [{ id: "BV2", title: "B" }] }, containers: {} };
  const waiting = app.click({ action: "play-track", trackId: "BV2", sectionKey: "all" });
  await app.click({ action: control, index: "0", trackId: "BV1", sectionKey: "all" });
  resolveListing({ ok: true, data: { total: 120, pageSize: 50, items: Array.from({ length: 50 }, (_, i) => ({ id: `BV${i + 1}` })) } });
  await waiting;
  assert.equal(commands.length, 1, `${control} 之后旧队列不得再发送播放命令`);
  assert.notEqual(commands[0], "playQueue");
  assert.equal(app.ui.error, "");
  assert.equal(app.ui.loadingSectionKey, null);
}

// 一个同步起播的新播放列表，也能取代还在分页的旧栏目播放意图。
let resolveListing;
const commands = [];
const app = await appHarness(message => {
  if (message.type === MESSAGE.loadSection) return new Promise(resolve => { resolveListing = resolve; });
  commands.push(message);
  return Promise.resolve({ ok: true, data: {} });
});
app.ui.app = {
  creators: [{ id: "42", name: "UP" }], settings: { activeCreatorId: "42" }, creatorContent: {},
  player: {}, playlists: [{ id: "p1", name: "列表", items: [{ bvid: "BV9", title: "新意图" }] }]
};
app.ui.activeContent = { all: { total: 2, items: [{ id: "BV1", title: "A" }] }, containers: {} };
const waiting = app.click({ action: "play-section", key: "all" });
await app.click({ action: "play-playlist", id: "p1", index: "0" });
resolveListing({ ok: true, data: { total: 2, pageSize: 50, items: [{ id: "BV1" }, { id: "BV2" }] } });
await waiting;
assert.equal(commands.length, 1);
assert.equal(commands[0].payload.queue[0].id, "BV9");

// 普通浏览分页不属于播放意图，暂停播放器不能把栏目浏览结果丢掉。
const browsing = app.run('openSectionDetail({ key: "all", id: "all", type: "all", title: "全部作品" })');
await app.click({ action: "pause" });
resolveListing({ ok: true, data: { total: 2, pageSize: 50, items: [{ id: "BV1" }, { id: "BV2" }] } });
await browsing;
assert.equal(app.ui.detailData.items.length, 2);
assert.equal(app.ui.loading, false);

// 清空先返回，旧暂停/设置快照和旧错误都不能把已清空的播放器复活。
for (const staleCommand of ["pause", "rate", "volume", "failed-next"]) {
  const pending = [];
  const player = await appHarness(message => new Promise(resolve => pending.push({ message, resolve })));
  player.ui.app = { settings: {}, player: { queue: [{ id: "BV1" }], currentTrack: { id: "BV1" }, playing: true, currentTime: 83 } };
  const old = staleCommand === "failed-next"
    ? player.click({ action: "next" })
    : player.run(`playerCommand(${JSON.stringify(staleCommand)}, {})`);
  const cleared = player.click({ action: "clear-play-queue" });
  pending[1].resolve({ ok: true, data: { queue: [], currentTrack: null, playing: false, currentTime: 0, loading: false, error: "" } });
  await cleared;
  pending[0].resolve(staleCommand === "failed-next"
    ? { ok: false, error: "旧切歌失败" }
    : { ok: true, data: { queue: [{ id: "BV1" }], currentTrack: { id: "BV1" }, playing: false, currentTime: 83 } });
  await old;
  assert.equal(player.ui.app.player.currentTrack, null, `${staleCommand} 旧响应不得恢复当前作品`);
  assert.equal(player.ui.app.player.queue.length, 0);
  assert.equal(player.ui.app.player.currentTime, 0);
  assert.equal(player.ui.app.player.error, "");
}
console.log("真实 UI 播放意图：补完整队列期间控制/新播放取代旧请求，不发送迟到playQueue通过");

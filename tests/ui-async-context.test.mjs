import assert from "node:assert/strict";
import { MESSAGE } from "../shared/constants.js";
import { appHarness } from "./helpers/app-harness.mjs";

const pending = [];
const cachePayloads = [];
const playerCommands = [];
const app = await appHarness(message => {
  if (message.type === MESSAGE.cacheCommand) {
    cachePayloads.push(message.payload);
    return Promise.resolve({ ok: true, data: {} });
  }
  if (message.type === MESSAGE.playerCommand) {
    playerCommands.push(message);
    return Promise.resolve({ ok: true, data: {} });
  }
  return new Promise(resolve => pending.push({ message, resolve }));
});
app.ui.app = {
  creators: [{ id: "a", name: "A" }, { id: "b", name: "B" }],
  settings: { activeCreatorId: "a", sectionSortDirection: "asc", defaultFormat: "m4a", mp3Bitrate: 192 },
  creatorContent: {}, player: {}
};
const complete = (request, data) => request.resolve({ ok: true, data });

const creatorA = app.run("loadActiveCreator()");
app.ui.app.settings.activeCreatorId = "b";
const creatorB = app.run("loadActiveCreator()");
complete(pending[1], { name: "B content" });
await creatorB;
complete(pending[0], { name: "A content" });
await creatorA;
assert.equal(app.ui.activeContent.name, "B content");
assert.equal(app.ui.loading, false);

const searchA = app.run('search("A")');
const searchB = app.run('search("B")');
complete(pending[3], [{ id: "b" }]);
await searchB;
pending[2].resolve({ ok: false, error: "旧搜索失败" });
await searchA;
assert.equal(app.ui.searchResults[0].id, "b");
assert.equal(app.ui.error, "");
assert.equal(app.ui.notice, "");

app.ui.app.settings.activeCreatorId = "a";
const sectionA = app.run('openSectionDetail({ key: "all", id: "all", type: "all", title: "A全部", total: 2 })');
app.ui.app.settings.activeCreatorId = "b";
const sectionB = app.run('openSectionDetail({ key: "all", id: "all", type: "all", title: "B全部", total: 2 })');
complete(pending[5], { total: 2, page: 1, pageSize: 50, items: [{ id: "B1" }] });
await sectionB;
complete(pending[4], { total: 2, page: 1, pageSize: 50, items: [{ id: "A1" }] });
await sectionA;
assert.equal(app.ui.detailData.items[0].id, "B1");
assert.equal(app.ui.activeSection.creator.id, "b");

const moreB = app.run("loadMoreDetail()");
await app.click({ action: "show-playlists" });
pending[6].resolve({ ok: false, error: "旧分页失败" });
await moreB;
assert.equal(app.ui.view, "playlists");
assert.equal(app.ui.error, "");
assert.equal(app.ui.loading, false);

// 缓存命令继续处理用户选定的 A，期间切 UP 和改变设置不改变文件归属/格式。
app.ui.app.settings.activeCreatorId = "a";
const caching = app.run('cacheWholeSection({ key: "all", id: "all", type: "all", title: "A全部" })');
app.ui.app.settings.activeCreatorId = "b";
app.ui.app.settings.defaultFormat = "mp3";
complete(pending[7], { total: 1, pageSize: 50, items: [{ id: "A1" }] });
await caching;
assert.equal(cachePayloads[0].tracks[0].creator.id, "a");
assert.equal(cachePayloads[0].format, "m4a");

// 等待完整播放队列期间离开页面，旧栏目不得开始播放或写回页面。
app.ui.view = "detail";
app.ui.activeSection = { key: "all", id: "all", type: "all", title: "B全部", creator: { id: "b", name: "B" } };
const playing = app.click({ action: "play-detail" });
await app.click({ action: "show-playlists" });
complete(pending[8], { total: 1, pageSize: 50, items: [{ id: "B1" }] });
await playing;
assert.equal(playerCommands.length, 0);
assert.equal(app.ui.view, "playlists");
assert.equal(app.ui.error, "");
assert.equal(app.ui.loadingSectionKey, null);
assert.equal(app.ui.notice, "", "导航后不保留旧栏目读取提示");

app.ui.view = "detail";
app.ui.detailData = { total: 2, items: [{ id: "B1" }] };
const trackSearchA = app.run('searchDetailTracks("first")');
const trackSearchB = app.run('searchDetailTracks("latest")');
complete(pending[10], { total: 2, pageSize: 50, items: [{ id: "B1" }, { id: "B2" }] });
await trackSearchB;
pending[9].resolve({ ok: false, error: "旧作品搜索失败" });
await trackSearchA;
assert.equal(app.ui.trackSearchKeyword, "latest");
assert.equal(app.ui.detailData.items.length, 2);
assert.equal(app.ui.error, "");
assert.equal(app.ui.loading, false);
console.log("真实 UI 异步上下文：UP/栏目/搜索反序响应、旧分页错误、缓存归属与离页取消播放通过");

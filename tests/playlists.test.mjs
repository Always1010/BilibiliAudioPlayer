import assert from "node:assert/strict";
import {
  addTracksToPlaylist,
  createPlaylist,
  deletePlaylist,
  normalizePlaylistItem,
  playlistItemToTrack,
  repairPlaylistDurations,
  removeTrackFromPlaylist,
  renamePlaylist,
  reorderPlaylistTrack
} from "../services/playlists.js";

const now = 1000;
let playlists = createPlaylist([], " 通勤 ", { id: "p1", now });
assert.deepEqual(playlists[0], { id: "p1", name: "通勤", createdAt: now, updatedAt: now, items: [] });

const sourceTrack = {
  id: "BV1TEST",
  bvid: "BV1TEST",
  aid: 123,
  cid: 456,
  title: "测试作品",
  cover: "https://example.com/cover.jpg",
  duration: 88,
  sectionTitle: "不应保存",
  creator: { id: "9", name: "测试UP主", avatar: "不应保存" }
};
const item = normalizePlaylistItem(sourceTrack, 1100);
assert.deepEqual(item, {
  bvid: "BV1TEST",
  title: "测试作品",
  duration: 88,
  creatorId: "9",
  creatorName: "测试UP主",
  addedAt: 1100
});
assert.equal("cover" in item, false);
assert.equal("aid" in item, false);
assert.equal("cid" in item, false);

playlists = addTracksToPlaylist(playlists, "p1", [sourceTrack, sourceTrack, { bvid: "BV2", title: "第二首" }], 1200);
assert.deepEqual(playlists[0].items.map(value => value.bvid), ["BV1TEST", "BV2"]);
playlists = reorderPlaylistTrack(playlists, "p1", 1, 0, 1300);
assert.deepEqual(playlists[0].items.map(value => value.bvid), ["BV2", "BV1TEST"]);
playlists = removeTrackFromPlaylist(playlists, "p1", "BV2", 1400);
assert.deepEqual(playlists[0].items.map(value => value.bvid), ["BV1TEST"]);
playlists = renamePlaylist(playlists, "p1", "夜间", 1500);
assert.equal(playlists[0].name, "夜间");
assert.deepEqual(playlistItemToTrack(playlists[0].items[0]), {
  id: "BV1TEST",
  bvid: "BV1TEST",
  title: "测试作品",
  duration: 88,
  creator: { id: "9", name: "测试UP主" }
});
const stalePlaylists = createPlaylist([], "历史", { id: "p2", now: 1 });
stalePlaylists[0].items = [{ bvid: "BVZERO", title: "待补全", duration: 0, addedAt: 1 }];
const repaired = await repairPlaylistDurations(stalePlaylists, async item => ({ duration: item.bvid === "BVZERO" ? 123 : 0 }), 2000);
assert.equal(repaired[0].items[0].duration, 123);
assert.equal(repaired[0].updatedAt, 2000);
assert.deepEqual(deletePlaylist(playlists, "p1"), []);

console.log("播放列表：最小快照、去重、排序、删除和队列转换通过");

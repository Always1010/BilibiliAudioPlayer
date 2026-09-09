import assert from "node:assert/strict";
import {
  buildCacheLibrary,
  cacheLibraryLocationMap,
  cacheSelectionState,
  cacheSelectionSummary,
  cacheTaskLocationKey,
  flattenCacheLocations
} from "../services/cache-library.js";

const records = [{
  trackId: "BV1TREE001",
  bvid: "BV1TREE001",
  title: "目录树作品",
  creator: { id: "42", name: "测试UP" },
  locations: [{
    id: "all:42:original:source",
    scope: { key: "all:42", type: "all", id: "42", title: "全部作品" },
    path: ["测试UP_42", "全部作品", "001 - 目录树作品 [BV1TREE001].m4a"],
    format: "original",
    size: 100
  }, {
    id: "season:7:mp3:192",
    scope: { key: "season:7", type: "season", id: "7", title: "测试合集" },
    path: ["测试UP_42", "合集", "测试合集", "001 - 目录树作品 [BV1TREE001].mp3"],
    format: "mp3",
    bitrate: 192,
    size: 200
  }, {
    id: "playlist:p1:mp3:192",
    scope: { key: "playlist:p1", type: "playlist", id: "p1", title: "通勤列表" },
    path: ["我的播放列表", "通勤列表 [p1]", "001 - 目录树作品 [BV1TREE001].mp3"],
    format: "mp3",
    bitrate: 192,
    size: 200
  }]
}, {
  trackId: "BV2TREE002",
  bvid: "BV2TREE002",
  title: "扫描恢复作品",
  locations: [{
    id: "recovered:旧目录/扫描恢复作品.m4a",
    scope: { key: "recovered:旧目录", type: "recovered", id: "", title: "旧目录" },
    path: ["旧目录", "扫描恢复作品 [BV2TREE002].m4a"],
    format: "original",
    size: 50
  }]
}];

const locations = flattenCacheLocations(records);
assert.equal(locations.length, 4, "同一作品的多个实体副本必须分别保留");
assert.equal(new Set(locations.map(item => item.key)).size, 4, "每个实体副本必须有独立选择键");
assert.equal(cacheLibraryLocationMap(records).get(locations[0].key).trackId, "BV1TREE001");
const selected = new Set([locations[0].key, locations[1].key]);
assert.equal(cacheSelectionState(locations.slice(0, 2).map(item => item.key), selected), "all");
assert.equal(cacheSelectionState(locations.slice(1, 3).map(item => item.key), selected), "some");
assert.deepEqual(cacheSelectionSummary(records, selected), { count: 2, size: 300 });
assert.equal(cacheTaskLocationKey({
  track: { id: "BV1TREE001", creator: { id: "42", name: "测试UP" } },
  section: { type: "season", id: "7", title: "测试合集" },
  format: "mp3",
  bitrate: 192
}), locations[1].key);

const tree = buildCacheLibrary(records);
assert.deepEqual(tree.map(node => node.label), ["测试UP", "我的播放列表", "恢复或未分类归档"]);

const creator = tree[0];
assert.equal(creator.subtitle, "UID 42");
assert.equal(creator.count, 2);
assert.equal(creator.size, 300);
assert.deepEqual(creator.children.map(node => node.label), ["全部作品", "合集"]);
assert.equal(creator.children[1].children[0].label, "测试合集");
assert.equal(creator.children[1].children[0].children[0].title, "目录树作品");

const playlists = tree[1];
assert.equal(playlists.count, 1);
assert.equal(playlists.children[0].label, "通勤列表");
assert.equal(playlists.children[0].children[0].format, "mp3");

const recovered = tree[2];
assert.equal(recovered.children[0].label, "旧目录");
assert.equal(recovered.children[0].children[0].bvid, "BV2TREE002");

console.log("缓存目录树：UP 主、栏目、播放列表、恢复归档和实体副本统计通过");

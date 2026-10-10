import assert from "node:assert/strict";
import {
  archiveScope,
  cacheCoverageForTracks,
  cacheRecordBytes,
  locationMatches,
  mergeCacheLocation,
  normalizeCacheRecord,
  orderedCacheLocations,
  removeCacheLocation,
  scopeKeyFromContext
} from "../services/cache-records.js";

const legacy = normalizeCacheRecord({
  trackId: "BV1CACHE999",
  bvid: "BV1CACHE999",
  title: "旧缓存",
  creator: { id: "7", name: "测试UP" },
  section: { id: "10", type: "season", title: "原合集" },
  path: ["测试UP_7", "合集", "原合集", "作品.m4a"],
  format: "original",
  size: 100,
  cachedAt: 10
});
assert.equal(legacy.locations.length, 1);
assert.equal(legacy.locations[0].scope.key, "season:10");

const playlistScope = archiveScope({ id: "p1", type: "playlist", title: "工作音乐" });
assert.equal(playlistScope.key, "playlist:p1");
assert.equal(scopeKeyFromContext({ kind: "all", creatorId: "7" }), "all:7");

const withPlaylist = mergeCacheLocation(legacy, {
  trackId: "BV1CACHE999",
  bvid: "BV1CACHE999",
  title: "旧缓存",
  creator: { id: "7", name: "测试UP" },
  locations: [{
    id: "playlist:p1:mp3:192",
    scope: playlistScope,
    path: ["我的播放列表", "工作音乐", "作品.mp3"],
    format: "mp3",
    bitrate: 192,
    size: 200,
    cachedAt: 20,
    verifiedAt: 30
  }]
});
assert.equal(withPlaylist.locations.length, 2);
assert.equal(orderedCacheLocations(withPlaylist, "season:10")[0].scope.key, "season:10");
assert.equal(orderedCacheLocations(withPlaylist, "playlist:p1")[0].scope.key, "playlist:p1");
assert.equal(locationMatches(withPlaylist.locations[0], { scopeKey: "playlist:p1", format: "mp3", bitrate: 192 }), true);
assert.equal(cacheRecordBytes(withPlaylist), 300);
assert.deepEqual(cacheCoverageForTracks(
  [{ bvid: "BV1CACHE999" }, { bvid: "BV3MISSING00" }],
  [withPlaylist],
  { scopeKey: "playlist:p1", format: "mp3", bitrate: 192 }
), { total: 2, availableCount: 1, archivedCount: 1 });
assert.equal(removeCacheLocation(withPlaylist, "playlist:p1:mp3:192").locations.length, 1);
assert.equal(removeCacheLocation(legacy, legacy.locations[0].id), null);

const sharedPath = ["测试UP_7", "合集", "原合集", "作品.mp3"];
const overwritten = normalizeCacheRecord({ trackId: "BVOVERWRITTEN", rootId: "root-a", locations: [
  { id: "season:10:mp3:192", path: sharedPath, format: "mp3", bitrate: 192, size: 100, cachedAt: 40,
    scope: { key: "season:10", type: "season", id: "10", title: "原合集" } },
  { id: "season:10:mp3:320", path: sharedPath, format: "mp3", bitrate: 320, size: 200, cachedAt: 20,
    scope: { key: "season:10", type: "season", id: "10", title: "原合集" } },
  { id: "recovered:作品.mp3", path: sharedPath, format: "mp3", size: 200, cachedAt: 30, verifiedAt: 40,
    scope: { key: "recovered:目录", type: "recovered", id: "", title: "恢复目录" } }
] });
assert.equal(overwritten.locations.length, 1, "一条物理路径不能计作三个实体副本");
assert.equal(cacheRecordBytes(overwritten), 200);
assert.equal(overwritten.locations[0].bitrate, null, "旧覆盖留下矛盾码率记录必须标未知");
assert.match(overwritten.locations[0].id, /^physical:/, "未知质量实体应使用物理ID保留旧路径");
assert.equal(overwritten.locations[0].scope.key, "season:10", "扫描副本不得取代已知归档作用域");
assert.equal(locationMatches(overwritten.locations[0], { format: "mp3", bitrate: 192 }), false);
assert.equal(locationMatches(overwritten.locations[0], { format: "mp3", bitrate: 320 }), false);
assert.equal(normalizeCacheRecord(overwritten).locations[0].bitrate, null, "校正可重复读取");
const independent = mergeCacheLocation(overwritten, { trackId: "BVOVERWRITTEN", rootId: "root-a",
  id: "season:10:mp3:192", path: ["合集", "作品 [192kbps].mp3"], format: "mp3", bitrate: 192, size: 110,
  scope: { key: "season:10", type: "season", id: "10", title: "原合集" } });
assert.equal(independent.locations.length, 2, "新码率路径应与旧未知副本独立");
assert.equal(cacheRecordBytes(independent), 310);
assert.equal(locationMatches(independent.locations[0], { format: "mp3", bitrate: 192 }), true);

console.log("多位置缓存：旧数据迁移、栏目优先、匹配、容量和失效移除通过");

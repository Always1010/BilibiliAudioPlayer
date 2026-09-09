import assert from "node:assert/strict";
import {
  archiveScope,
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
assert.equal(removeCacheLocation(withPlaylist, "playlist:p1:mp3:192").locations.length, 1);
assert.equal(removeCacheLocation(legacy, legacy.locations[0].id), null);

console.log("多位置缓存：旧数据迁移、栏目优先、匹配、容量和失效移除通过");

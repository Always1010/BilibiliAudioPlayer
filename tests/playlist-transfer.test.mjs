import assert from "node:assert/strict";
import {
  createPlaylistExport,
  mergeImportedPlaylists,
  parsePlaylistExport,
  serializePlaylistExport
} from "../services/playlist-transfer.js";

const source = [{
  id: "p1",
  name: "通勤",
  createdAt: 100,
  updatedAt: 200,
  items: [{ bvid: "BV1TEST9999", title: "第一首", duration: 60, creatorId: "8", creatorName: "UP", addedAt: 150, cover: "不应导出" }]
}];

const exported = createPlaylistExport(source, { appVersion: "0.5.0", now: 1000 });
assert.equal(exported.schemaVersion, 1);
assert.equal(exported.appVersion, "0.5.0");
assert.equal("cover" in exported.playlists[0].items[0], false);

const parsed = parsePlaylistExport(serializePlaylistExport(source, { now: 1000 }));
assert.equal(parsed.playlistCount, 1);
assert.equal(parsed.itemCount, 1);
assert.deepEqual(parsed.playlists, exported.playlists);

const merged = mergeImportedPlaylists(source, parsed.playlists, { idFactory: () => "p2" });
assert.deepEqual(merged.map(playlist => [playlist.id, playlist.name]), [["p1", "通勤"], ["p2", "通勤（导入）"]]);
assert.deepEqual(mergeImportedPlaylists([], parsed.playlists, { mode: "replace" }), parsed.playlists);
assert.throws(() => parsePlaylistExport("{"), /无法解析/);
assert.throws(() => parsePlaylistExport(JSON.stringify({ schema: "other", schemaVersion: 1, playlists: [] })), /不是哔哩音频/);
assert.throws(() => parsePlaylistExport(JSON.stringify({ ...exported, schemaVersion: 2 })), /暂不支持/);
assert.throws(() => parsePlaylistExport(JSON.stringify({ ...exported, playlists: [{ ...source[0], items: [{ bvid: "av123" }] }] })), /无效 BV 号/);

console.log("播放列表迁移：最小导出、校验、合并冲突与替换通过");

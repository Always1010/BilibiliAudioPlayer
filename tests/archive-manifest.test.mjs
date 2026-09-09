import assert from "node:assert/strict";
import {
  ARCHIVE_MANIFEST_FILENAME,
  buildArchiveManifest,
  parseArchiveAudioFilename,
  parseArchiveManifest,
  recoveredArchiveScope,
  removeArchiveManifestFiles
} from "../services/archive-manifest.js";

const scope = { key: "playlist:p1", type: "playlist", id: "p1", title: "工作音乐" };
const tracks = [
  { bvid: "BV1ARCHIVE1", title: "第一首", duration: 60, creator: { id: "1", name: "UP甲" } },
  { bvid: "BV2ARCHIVE2", title: "第二首", duration: 80, creator: { id: "2", name: "UP乙" } }
];
const first = buildArchiveManifest(scope, tracks, null, {
  bvid: "BV1ARCHIVE1",
  filename: "001 - 第一首 [BV1ARCHIVE1].mp3",
  format: "mp3",
  bitrate: 192,
  size: 100
}, 1000);
assert.equal(ARCHIVE_MANIFEST_FILENAME, "哔哩音频清单.json");
assert.equal(first.items.length, 2);
assert.equal(first.items[0].filename, "001 - 第一首 [BV1ARCHIVE1].mp3");
assert.equal(first.items[1].filename, "");

const second = buildArchiveManifest(scope, tracks, first, {
  bvid: "BV2ARCHIVE2",
  filename: "002 - 第二首 [BV2ARCHIVE2].m4a",
  format: "original",
  size: 200
}, 2000);
assert.equal(second.items[0].filename, first.items[0].filename);
assert.equal(second.items[1].format, "original");
assert.deepEqual(parseArchiveManifest(JSON.stringify(second)), second);
assert.equal(parseArchiveManifest("not json"), null);
assert.deepEqual(parseArchiveAudioFilename("001 - 第一首 [BV1ARCHIVE1].mp3"), {
  title: "第一首",
  bvid: "BV1ARCHIVE1",
  extension: "mp3",
  format: "mp3"
});
assert.equal(parseArchiveAudioFilename("没有BV号.mp3"), null);
assert.deepEqual(recoveredArchiveScope(["我的播放列表", "工作音乐 [abcd]"]), {
  key: "recovered:我的播放列表/工作音乐 [abcd]",
  type: "playlist",
  id: "",
  title: "工作音乐 [abcd]"
});
assert.equal(recoveredArchiveScope(["测试UP_7", "全部作品"]).key, "all:7");

const removed = removeArchiveManifestFiles(second, [{
  bvid: "BV1ARCHIVE1",
  filename: "001 - 第一首 [BV1ARCHIVE1].mp3"
}], Date.UTC(2026, 0, 3));
assert.equal(removed.items[0].filename, "");
assert.equal(removed.items[0].format, "");
assert.equal(removed.items[0].bitrate, null);
assert.equal(removed.items[0].size, 0);
assert.equal(removed.items[1].title, "第二首", "删除一个文件不能改变同列表的其他作品");

console.log("归档清单：最小元数据、分步完成合并和异常解析通过");

import assert from "node:assert/strict";
import { createOffscreenHarness } from "./helpers/offscreen.mjs";
import { cacheRecordBytes, mergeCacheLocation, normalizeCacheRecord } from "../services/cache-records.js";
import {
  ARCHIVE_MANIFEST_FILENAME, parseArchiveAudioFilename, parseArchiveManifest, recoveredArchiveScope
} from "../services/archive-manifest.js";

const filename = "001 - 原标题 [BV1ARCHIVE1].mp3";
const path = ["测试UP_7", "合集", "原合集"];
const known = normalizeCacheRecord({
  trackId: "BV1ARCHIVE1", title: "完整原标题", creator: { id: "7", name: "测试UP" },
  rootId: "root-a", locations: [{
    id: "season:10:mp3:192", rootId: "root-a", scope: { key: "season:10", type: "season", id: "10", title: "原合集" },
    path: [...path, filename], format: "mp3", bitrate: 192, size: 100, cachedAt: 10, verifiedAt: 20
  }]
});
const records = new Map([[known.trackId, known]]);
const audioFile = new Blob(["new-audio"]);
function directory(entries, brokenManifest = false) {
  return {
    kind: "directory",
    async *entries() { yield* entries; },
    async getFileHandle() {
      if (brokenManifest) return { async getFile() { return new Blob([JSON.stringify({ schema: "bilibili-audio-archive", schemaVersion: 1, items: [null] })]); } };
      throw new DOMException("missing", "NotFoundError");
    }
  };
}
const leaf = directory([[filename, { kind: "file", getFile: async () => audioFile }]], true);
const unknown = directory([["新作品 [BV2ARCHIVE2].m4a", { kind: "file", getFile: async () => new Blob(["another"]) }]]);
const root = directory([["测试UP_7", directory([["合集", directory([["原合集", leaf]])]])], ["其他目录", unknown]]);
const { run } = await createOffscreenHarness({
  ARCHIVE_MANIFEST_FILENAME, parseArchiveAudioFilename, parseArchiveManifest, recoveredArchiveScope,
  getCacheRecord: async id => records.get(id),
  putCacheRecord: async record => {
    const merged = mergeCacheLocation(records.get(record.trackId), record);
    records.set(record.trackId, merged);
    return merged;
  },
  testDirectory: root, testSummary: { manifests: 0, files: 0, errors: 0 }
});
await run("scanArchiveDirectory(testDirectory, [], testSummary)");
await run("scanArchiveDirectory(testDirectory, [], testSummary)");
const refreshed = records.get(known.trackId);
assert.equal(refreshed.locations.length, 1);
assert.equal(refreshed.locations[0].id, known.locations[0].id);
assert.equal(refreshed.locations[0].scope.key, "season:10");
assert.equal(refreshed.locations[0].bitrate, 192);
assert.equal(refreshed.title, "完整原标题");
assert.equal(cacheRecordBytes(refreshed), audioFile.size, "重复扫描按实体计量并刷新文件实际大小");
assert.equal(records.get("BV2ARCHIVE2").locations.length, 1, "损坏清单不影响后续目录恢复");
assert.equal(run("testSummary.errors"), 0);
records.set(known.trackId, normalizeCacheRecord({ ...refreshed, locations: [{ ...refreshed.locations[0], bitrate: null, id: "physical:old" }] }));
await run("scanArchiveDirectory(testDirectory, [], testSummary)");
assert.equal(records.get(known.trackId).locations[0].bitrate, null, "无码率文件名不能替旧冲突索引猜测码率");
console.log("归档扫描：实体去重、作用域码率保留、容量刷新和坏清单隔离通过");

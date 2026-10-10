import assert from "node:assert/strict";
import { MESSAGE } from "../shared/constants.js";
import { cacheLibraryLocationMap } from "../services/cache-library.js";
import { appHarness } from "./helpers/app-harness.mjs";

const requests = [];
const app = await appHarness(async message => {
  requests.push(message);
  return { ok: true, data: { records: [], deletion: { deleted: 1, bytes: 10 } } };
});
app.ui.app = { settings: {}, player: {} };
app.ui.cacheInfo = {
  directory: { configured: true, rootId: "root-a", name: "A", permission: "granted", unassignedCount: 1 },
  records: [{ trackId: "BV1", rootId: "root-a", title: "作品", locations: [
    { id: "file", rootId: "root-a", path: ["A", "1.m4a"], format: "m4a", size: 10 }
  ] }]
};
assert.match(app.run("downloadsPage()"), /旧缓存索引待校准，请扫描本地归档；已有文件会保留/);
const key = [...cacheLibraryLocationMap(app.ui.cacheInfo.records).keys()][0];
// 即使页面里的目录信息迟到或被其他窗口更改，命令携带目标文件原来的根身份。
app.ui.cacheInfo.directory.rootId = "root-b";
await app.run(`deleteCacheNodes(${JSON.stringify([key])}, "作品")`);
assert.equal(requests[0].type, MESSAGE.cacheCommand);
assert.equal(requests[0].command, "deleteCacheLocations");
assert.equal(requests[0].payload.locations[0].rootId, "root-a");
assert.equal(requests[0].payload.locations[0].trackId, "BV1");
const unknown = app.run('cacheLibraryNodeMarkup({ kind: "file", key: "old", title: "旧文件", trackId: "BV1", format: "mp3", bitrate: null })');
assert.match(unknown, /MP3 码率未知/);
assert.doesNotMatch(unknown, /null kbps|0 kbps/);
const known = app.run('cacheLibraryNodeMarkup({ kind: "file", key: "new", title: "新文件", trackId: "BV1", format: "mp3", bitrate: 192 })');
assert.match(known, /MP3 192 kbps/);
console.log("真实 UI 缓存根：旧索引校准提示与删除目标携带原根身份通过");

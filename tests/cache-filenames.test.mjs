import assert from "node:assert/strict";
import { createOffscreenHarness } from "./helpers/offscreen.mjs";
import { archiveScope } from "../services/cache-records.js";
import { addCacheHistory, summarizeCacheTask } from "../services/cache-queue-state.js";

const written = new Map();
const saved = [];
const directory = {
  async getFileHandle(name) {
    return { async createWritable() {
      return { async write(blob) { written.set(name, blob); }, async close() {}, async abort() {} };
    } };
  }
};
const { run } = await createOffscreenHarness({
  archiveScope, addCacheHistory, summarizeCacheTask,
  safeFilePart: value => String(value),
  getCacheRecord: async () => ({ trackId: "BV1ARCHIVE1" }),
  findCachedFile: async (record, options) => options.onlyPreferred ? null : {
    file: new Blob([`audio-${options.bitrate}`]),
    location: { format: "mp3", bitrate: options.bitrate, scope: { title: "另一个栏目" } }
  },
  getOrCreateDirectory: async () => directory,
  putCacheRecord: async record => { saved.push(record); return record; }
});
for (const bitrate of [192, 320]) {
  await run(`downloadTrack({track:{id:"BV1ARCHIVE1",bvid:"BV1ARCHIVE1",title:"第一首",creator:{id:"7",name:"UP"}},section:{type:"season",id:"s1",title:"合集"},format:"mp3",bitrate:${bitrate},position:0}, async()=>({}))`);
}
assert.equal(written.size, 2, "同一作品不同码率必须写入独立实体文件");
assert.equal(await written.get("001 - 第一首 [BV1ARCHIVE1] [192kbps].mp3").text(), "audio-192");
assert.equal(await written.get("001 - 第一首 [BV1ARCHIVE1] [320kbps].mp3").text(), "audio-320");
assert.notEqual(saved[0].locations[0].path.at(-1), saved[1].locations[0].path.at(-1));
console.log("MP3缓存：192/320码率实体文件和索引路径独立通过");

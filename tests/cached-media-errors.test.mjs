import assert from "node:assert/strict";
import { createOffscreenHarness } from "./helpers/offscreen.mjs";

for (const scenario of [
  { code: 1, removed: false },
  { code: 2, removed: false },
  { code: 3, removed: true },
  { code: 4, removed: true },
  { timeout: true, removed: false }
]) {
  const deleted = [];
  const { audio, run, flush } = await createOffscreenHarness({
    getCacheRecord: async () => ({ trackId: "BV1TEST" }),
    findCachedFiles: async () => [{ file: new Blob(["valid-file"]), location: { id: "location" } }],
    deleteCacheLocation: async (trackId, locationId) => deleted.push({ trackId, locationId }),
    waitForPlaybackEvent: async (target, event, signal, failure) => {
      throw scenario.timeout ? new Error("等待音频媒体事件超时") : failure();
    }
  });
  audio.error = scenario.code ? { code: scenario.code } : null;
  const loading = run('handleCommand("playQueue", {queue:[{id:"BV1TEST"}]})');
  await flush();
  await flush();
  assert.equal(deleted.length, scenario.removed ? 1 : 0,
    `${scenario.timeout ? "就绪超时" : `媒体错误 ${scenario.code}`} 的缓存索引处理`);
  await run('handleCommand("clearQueue")');
  await loading;
}
console.log("本地媒体失败：仅解码或格式错误清索引，中止、网络和超时保留通过");

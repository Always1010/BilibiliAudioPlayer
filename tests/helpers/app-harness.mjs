import fs from "node:fs/promises";
import vm from "node:vm";
import { MESSAGE } from "../../shared/constants.js";
import { loadAllSectionPages } from "../../services/section-pagination.js";
import { normalizeTrackSortDirection, sortTracksByPublishedAt } from "../../services/track-order.js";
import * as cacheLibrary from "../../services/cache-library.js";
import * as cacheRecords from "../../services/cache-records.js";
import * as utils from "../../shared/utils.js";
import { playlistItemToTrack } from "../../services/playlists.js";

// 执行真实 UI 函数和事件处理器，只替换浏览器消息、DOM 渲染和启动入口。
export async function appHarness(sendMessage) {
  const listeners = {};
  const root = { addEventListener: (type, callback) => { listeners[type] = callback; }, querySelector: () => null };
  const document = { getElementById: () => root, documentElement: { dataset: {} }, addEventListener() {} };
  const context = vm.createContext({
    document, window: { confirm: () => true }, console, setTimeout, clearTimeout, MESSAGE, loadAllSectionPages,
    ...cacheLibrary, ...cacheRecords, ...utils,
    playlistItemToTrack,
    normalizeTrackSortDirection, sortTracksByPublishedAt,
    toErrorMessage: error => error.message,
    chrome: { runtime: { sendMessage, onMessage: { addListener() {} } } }
  });
  const source = (await fs.readFile(new URL("../../ui/app.js", import.meta.url), "utf8"))
    .replace(/^import[\s\S]*?;\r?\n/gm, "")
    .replace(/start\(\);\s*$/, "");
  vm.runInContext(source, context);
  vm.runInContext("render = () => {}; renderCacheState = () => {}; renderPlayer = () => {}; showCacheToast = () => {}; refreshCacheInfo = async () => {};", context);
  return {
    ui: vm.runInContext("ui", context),
    run: expression => vm.runInContext(expression, context),
    click: dataset => listeners.click({ target: { closest: selector => selector === "[data-action]" ? { dataset } : null } })
  };
}

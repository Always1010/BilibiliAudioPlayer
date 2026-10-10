import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import { MESSAGE, STORAGE_KEYS, UPDATE_ALARM } from "../../shared/constants.js";
import { loadSubscriptionVideos, mergeSubscriptionCheckResults, subscriptionIsCurrent } from "../../services/subscriptions.js";
import { autoCacheJobIsCurrent, cacheOutcomeKeys, createAutoCacheJobs, failedAutoCacheJob } from "../../services/auto-cache-jobs.js";

export async function backgroundHarness(values, overrides = {}) {
  const noopListener = { addListener() {} };
  const writes = new Map();
  const context = vm.createContext({
    console, crypto: webcrypto, setTimeout, clearTimeout,
    MESSAGE, STORAGE_KEYS, UPDATE_ALARM,
    loadSubscriptionVideos, mergeSubscriptionCheckResults, subscriptionIsCurrent,
    autoCacheJobIsCurrent, cacheOutcomeKeys, createAutoCacheJobs, failedAutoCacheJob,
    getAppState: async () => structuredClone(values),
    toErrorMessage: error => error.message,
    updateStorageValue(key, updater) {
      const task = (writes.get(key) ?? Promise.resolve()).then(async () => {
        const next = await updater(structuredClone(values[key]));
        values[key] = structuredClone(next);
        return next;
      });
      writes.set(key, task.catch(() => {}));
      return task;
    },
    listCreatorVideos: async () => ({ items: [], total: 0 }),
    listContainerVideos: async () => ({ items: [], total: 0 }),
    chrome: {
      runtime: {
        onInstalled: noopListener, onStartup: noopListener, onMessage: noopListener,
        getURL: path => path,
        getContexts: async () => [{}],
        sendMessage: async () => ({ ok: true, data: { accepted: true, directory: { permission: "granted", rootId: "test-root" } } })
      },
      action: { onClicked: noopListener }, alarms: { onAlarm: noopListener },
      storage: { local: {
        get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, structuredClone(values[key])])),
        set: async patch => Object.assign(values, structuredClone(patch))
      } }
    },
    ...overrides
  });
  const source = (await readFile(new URL("../../background/service-worker.js", import.meta.url), "utf8"))
    .replace(/^import[\s\S]*?;\r?\n/gm, "");
  vm.runInContext(source, context);
  return { values, run: expression => vm.runInContext(expression, context), context };
}

export function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

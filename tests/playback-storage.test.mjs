import assert from "node:assert/strict";

const values = {};
const writes = [];

function selected(keys) {
  if (keys == null) return { ...values };
  const names = Array.isArray(keys) ? keys : [keys];
  return Object.fromEntries(names.filter(key => Object.hasOwn(values, key)).map(key => [key, values[key]]));
}

globalThis.chrome = {
  storage: {
    local: {
      async get(keys) { return selected(keys); },
      async set(changes) {
        writes.push(structuredClone(changes));
        Object.assign(values, structuredClone(changes));
      }
    }
  }
};

const {
  clearPlaybackHistory,
  getAppState,
  initializeStorage,
  savePlayerState,
  saveSettings,
  updateStorageValue,
  deletePlaybackCheckpoint
} = await import("../shared/storage.js");

await initializeStorage();
assert.deepEqual(values.playbackProgress, { currentTime: 0, duration: 0, updatedAt: 0 });
assert.deepEqual(values.playbackCheckpoints, { scopes: {} });

// Concurrent UI commands must not read the same old value and lose an edit.
values.concurrent = [];
await Promise.all([
  updateStorageValue("concurrent", async current => { await Promise.resolve(); return [...current, "A"]; }),
  updateStorageValue("concurrent", current => [...current, "B"])
]);
assert.deepEqual(values.concurrent, ["A", "B"]);
await assert.rejects(updateStorageValue("concurrent", () => { throw new Error("取消修改"); }));
await updateStorageValue("concurrent", current => [...current, "C"]);
assert.deepEqual(values.concurrent, ["A", "B", "C"], "一次失败不能阻断后续修改");

const queue = [
  { id: "BV1", title: "第一首", duration: 100 },
  { id: "BV2", title: "第二首", duration: 200 }
];
const player = {
  queue,
  queueIndex: 1,
  queueContext: { kind: "playlist", id: "p1", title: "我的播放列表 · 通勤", order: "fixed" },
  currentTrack: queue[1],
  currentTime: 62,
  duration: 200,
  playing: true
};
values.playlists = [{ id: "p1", name: "通勤", items: [] }];
await savePlayerState(player);
assert.equal("currentTime" in values.player, false);
assert.equal(values.player.queue.length, 2);
assert.equal(values.playbackProgress.currentTime, 62);
assert.equal(values.playbackCheckpoints.scopes["playlist:p1"].trackId, "BV2");

writes.length = 0;
await savePlayerState({ ...player, currentTime: 67 });
assert.equal("player" in writes.at(-1), false);
assert.equal(writes.at(-1).playbackProgress.currentTime, 67);
assert.equal(writes.at(-1).playbackCheckpoints.scopes["playlist:p1"].position, 67);

values.playlists = [];
await savePlayerState({ ...player, currentTime: 68 });
assert.equal(values.playbackCheckpoints.scopes["playlist:p1"], undefined);
values.playlists = [{ id: "p1", name: "通勤", items: [] }];

const appState = await getAppState();
assert.equal(appState.player.currentTime, 68);
assert.equal(appState.player.queue[1].id, "BV2");

await saveSettings({ rememberProgress: false });
await savePlayerState({ ...player, currentTime: 70 });
assert.deepEqual(values.player.queue, []);
assert.equal(values.player.currentTrack, null);
assert.deepEqual(values.playbackProgress, { currentTime: 0, duration: 0, updatedAt: 0 });
assert.deepEqual(values.playbackCheckpoints, { scopes: {} });

await saveSettings({ rememberProgress: true });
await savePlayerState(player);
await clearPlaybackHistory();
assert.deepEqual(values.player.queue, []);
assert.deepEqual(values.playbackCheckpoints, { scopes: {} });

await Promise.all([savePlayerState(player), clearPlaybackHistory()]);
assert.deepEqual(values.player.queue, [], "保存与清空按调用顺序协调");
await Promise.all([savePlayerState(player), deletePlaybackCheckpoint("playlist:p1")]);
assert.equal(values.playbackCheckpoints.scopes["playlist:p1"], undefined, "旧保存不能覆盖检查点删除");

console.log("播放状态存储：迁移、轻量进度写入、集合检查点和关闭记忆清理通过");

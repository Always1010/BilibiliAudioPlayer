import assert from "node:assert/strict";
import { updateTrackPlayback } from "../ui/track-playback.js";

function trackRow(trackId, trackNumber) {
  const classes = new Set();
  const index = { textContent: trackNumber };
  const icon = { textContent: "▶" };
  return {
    dataset: { trackId, trackNumber },
    classList: { toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name) },
    querySelector: selector => selector === ".track-index" ? index : icon,
    snapshot: () => [classes.has("playing"), index.textContent, icon.textContent]
  };
}

// 同一作品可能同时出现在主页的多个栏目预览中。
const rows = [trackRow("BV10", "10"), trackRow("BV15", "15"), trackRow("BV10", "02")];
const scope = {
  querySelectorAll(selector) {
    assert.equal(selector, ".track-row[data-track-id]");
    return rows;
  }
};
const snapshots = () => rows.map(row => row.snapshot());

updateTrackPlayback(scope, { currentTrack: { id: "BV15" }, playing: true });
assert.deepEqual(snapshots(), [[false, "10", "▶"], [true, "♫", "Ⅱ"], [false, "02", "▶"]]);

// 第 15 首切换为第 10 首：旧行恢复序号，新行同步高亮和图标。
updateTrackPlayback(scope, { currentTrack: { id: "BV10" }, playing: true });
assert.deepEqual(snapshots(), [[true, "♫", "Ⅱ"], [false, "15", "▶"], [true, "♫", "Ⅱ"]]);

updateTrackPlayback(scope, { currentTrack: { id: "BV10" }, playing: false });
assert.deepEqual(snapshots(), [[true, "10", "▶"], [false, "15", "▶"], [true, "02", "▶"]]);
updateTrackPlayback(scope, { currentTrack: { id: "BV10" }, playing: true });
assert.deepEqual(snapshots(), [[true, "♫", "Ⅱ"], [false, "15", "▶"], [true, "♫", "Ⅱ"]]);

// 切换到筛选结果或其他栏目之外的作品时，移除旧标记。
updateTrackPlayback(scope, { currentTrack: { id: "BV-other" }, playing: true });
assert.deepEqual(snapshots(), [[false, "10", "▶"], [false, "15", "▶"], [false, "02", "▶"]]);
updateTrackPlayback(scope, { currentTrack: { id: "BV15" }, playing: true });
updateTrackPlayback(scope, { currentTrack: null, playing: false });
assert.deepEqual(snapshots(), [[false, "10", "▶"], [false, "15", "▶"], [false, "02", "▶"]]);

console.log("作品列表播放标记：切歌、暂停、恢复、多栏目同步及清空通过");

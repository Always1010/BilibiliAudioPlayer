const MODE_LABELS = Object.freeze({
  list: "列表循环",
  single: "单曲循环",
  shuffle: "随机播放"
});

export function playbackModeLabel(mode) {
  return MODE_LABELS[mode] ?? MODE_LABELS.list;
}

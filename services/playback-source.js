export function onlinePlaybackSource() {
  return { kind: "online" };
}

export function cachedPlaybackSource(record = {}) {
  const format = record.format === "mp3" ? "mp3" : "original";
  return {
    kind: "cache",
    format,
    bitrate: format === "mp3" ? Number(record.bitrate) || null : null,
    archiveTitle: record.scope?.title || ""
  };
}

export function playbackSourceLabel(source, loading = false) {
  if (loading) return "正在加载";
  if (source?.kind === "online") return "在线";
  if (source?.kind !== "cache") return "";
  if (source.format === "mp3") {
    const format = source.bitrate ? `MP3 ${source.bitrate} kbps` : "MP3";
    return `本地缓存 · ${format}${source.archiveTitle ? ` · ${source.archiveTitle}` : ""}`;
  }
  return `本地缓存 · 原始格式${source.archiveTitle ? ` · ${source.archiveTitle}` : ""}`;
}

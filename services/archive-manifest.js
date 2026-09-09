export const ARCHIVE_MANIFEST_FILENAME = "哔哩音频清单.json";
export const ARCHIVE_MANIFEST_SCHEMA = "bilibili-audio-archive";
export const ARCHIVE_MANIFEST_VERSION = 1;

function text(value, fallback = "") {
  return String(value ?? fallback).trim();
}

export function buildArchiveManifest(scope, tracks, existing = null, completed = null, now = Date.now()) {
  const previous = new Map((Array.isArray(existing?.items) ? existing.items : []).map(item => [text(item.bvid), item]));
  if (completed?.bvid) previous.set(text(completed.bvid), { ...previous.get(text(completed.bvid)), ...completed });
  return {
    schema: ARCHIVE_MANIFEST_SCHEMA,
    schemaVersion: ARCHIVE_MANIFEST_VERSION,
    scope: {
      key: text(scope?.key),
      type: text(scope?.type),
      id: text(scope?.id),
      title: text(scope?.title)
    },
    updatedAt: new Date(now).toISOString(),
    items: (tracks ?? []).flatMap((track, position) => {
      const bvid = text(track?.bvid ?? track?.id);
      if (!bvid) return [];
      const saved = previous.get(bvid) ?? {};
      return [{
        position,
        bvid,
        title: text(track.title, bvid),
        duration: Math.max(0, Number(track.duration) || 0),
        creatorId: text(track.creator?.id ?? track.creatorId),
        creatorName: text(track.creator?.name ?? track.creatorName),
        filename: text(saved.filename),
        format: saved.format === "mp3" ? "mp3" : saved.format === "original" ? "original" : "",
        bitrate: saved.format === "mp3" ? Number(saved.bitrate) || null : null,
        size: Math.max(0, Number(saved.size) || 0)
      }];
    })
  };
}

export function parseArchiveManifest(source) {
  try {
    const value = JSON.parse(String(source));
    if (value?.schema !== ARCHIVE_MANIFEST_SCHEMA || value.schemaVersion !== ARCHIVE_MANIFEST_VERSION) return null;
    return value;
  } catch {
    return null;
  }
}

export function parseArchiveAudioFilename(filename) {
  const match = String(filename).match(/^(?:\d+\s*-\s*)?(.*?)\s*\[(BV[0-9A-Za-z]{6,30})\]\.(mp3|m4a|webm)$/i);
  if (!match) return null;
  return {
    title: match[1].trim() || match[2],
    bvid: match[2],
    extension: match[3].toLowerCase(),
    format: match[3].toLowerCase() === "mp3" ? "mp3" : "original"
  };
}

export function recoveredArchiveScope(directoryPath) {
  const parts = (directoryPath ?? []).map(String);
  if (parts[0] === "我的播放列表") {
    return {
      key: `recovered:${parts.join("/")}`,
      type: "playlist",
      id: "",
      title: parts[1] || "恢复的播放列表归档"
    };
  }
  const typeName = parts[1];
  const type = typeName === "合集" ? "season" : typeName === "系列" ? "series" : typeName === "全部作品" ? "all" : "recovered";
  const creatorId = String(parts[0] || "").split("_").at(-1);
  return {
    key: type === "all" && creatorId ? `all:${creatorId}` : `recovered:${parts.join("/")}`,
    type,
    id: type === "all" ? creatorId : "",
    title: parts[2] || typeName || parts.at(-1) || "恢复的归档"
  };
}

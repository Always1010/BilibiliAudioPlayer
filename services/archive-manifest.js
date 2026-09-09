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

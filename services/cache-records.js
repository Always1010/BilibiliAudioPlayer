function text(value, fallback = "") {
  return String(value ?? fallback).trim();
}

export function archiveScope(section = {}, creator = {}) {
  const type = ["season", "series", "playlist", "all"].includes(section.type) ? section.type : "all";
  const id = text(section.id, type === "all" ? creator.id : "unknown");
  const creatorId = text(creator.id);
  const key = type === "all" ? `all:${creatorId || id}` : `${type}:${id}`;
  return { key, type, id, title: text(section.title, type === "playlist" ? "未命名播放列表" : "全部作品") };
}

export function scopeKeyFromContext(context = {}) {
  if (context.archiveKey) return text(context.archiveKey);
  const type = text(context.kind ?? context.type);
  if (type === "all") return `all:${text(context.creatorId ?? context.id)}`;
  if (["season", "series", "playlist"].includes(type) && context.id != null) return `${type}:${text(context.id)}`;
  return "";
}

function normalizeLocation(value, fallback = {}) {
  const path = Array.isArray(value?.path) ? value.path.map(part => text(part)).filter(Boolean) : [];
  if (!path.length) return null;
  const scope = value.scope?.key
    ? {
        key: text(value.scope.key),
        type: text(value.scope.type),
        id: text(value.scope.id),
        title: text(value.scope.title)
      }
    : archiveScope(value.section ?? fallback.section, value.creator ?? fallback.creator);
  const format = value.format === "mp3" ? "mp3" : "original";
  const bitrate = format === "mp3" ? Number(value.bitrate) || null : null;
  const id = text(value.id, `${scope.key}:${format}:${bitrate ?? "source"}:${path.join("/")}`);
  return {
    id,
    scope,
    path,
    format,
    bitrate,
    mimeType: text(value.mimeType),
    codec: text(value.codec),
    size: Math.max(0, Number(value.size) || 0),
    cachedAt: Math.max(0, Number(value.cachedAt) || Date.now()),
    verifiedAt: Math.max(0, Number(value.verifiedAt) || 0)
  };
}

export function normalizeCacheRecord(value) {
  if (!value) return null;
  const trackId = text(value.trackId ?? value.bvid);
  if (!trackId) return null;
  const sourceLocations = Array.isArray(value.locations) ? value.locations : [value];
  const locations = [];
  const ids = new Set();
  for (const source of sourceLocations) {
    const location = normalizeLocation(source, value);
    if (!location || ids.has(location.id)) continue;
    ids.add(location.id);
    locations.push(location);
  }
  const primary = locations[0] ?? {};
  return {
    trackId,
    bvid: text(value.bvid, trackId.startsWith("BV") ? trackId : ""),
    title: text(value.title, value.bvid ?? trackId),
    creator: value.creator && typeof value.creator === "object"
      ? { id: text(value.creator.id), name: text(value.creator.name) }
      : null,
    locations,
    ...primary
  };
}

export function locationMatches(location, { scopeKey = "", format = "", bitrate = null } = {}) {
  if (scopeKey && location.scope?.key !== scopeKey) return false;
  if (format && location.format !== format) return false;
  if (format === "mp3" && bitrate != null && Number(location.bitrate) !== Number(bitrate)) return false;
  return true;
}

export function orderedCacheLocations(record, preferredScopeKey = "") {
  const locations = normalizeCacheRecord(record)?.locations ?? [];
  return locations.slice().sort((left, right) => {
    const leftPreferred = preferredScopeKey && left.scope.key === preferredScopeKey ? 1 : 0;
    const rightPreferred = preferredScopeKey && right.scope.key === preferredScopeKey ? 1 : 0;
    return rightPreferred - leftPreferred || Number(right.verifiedAt) - Number(left.verifiedAt) || Number(right.cachedAt) - Number(left.cachedAt);
  });
}

export function mergeCacheLocation(record, locationRecord) {
  const incoming = normalizeCacheRecord(locationRecord);
  if (!incoming?.locations.length) throw new Error("缓存位置记录无效");
  const current = normalizeCacheRecord(record) ?? {
    trackId: incoming.trackId,
    bvid: incoming.bvid,
    title: incoming.title,
    creator: incoming.creator,
    locations: []
  };
  const addition = incoming.locations[0];
  const locations = current.locations.filter(location => location.id !== addition.id);
  return normalizeCacheRecord({
    ...current,
    bvid: incoming.bvid || current.bvid,
    title: incoming.title || current.title,
    creator: incoming.creator || current.creator,
    locations: [addition, ...locations]
  });
}

export function removeCacheLocation(record, locationId) {
  const current = normalizeCacheRecord(record);
  if (!current) return null;
  const locations = current.locations.filter(location => location.id !== locationId);
  return locations.length ? normalizeCacheRecord({ ...current, locations }) : null;
}

export function cacheRecordBytes(record) {
  return (normalizeCacheRecord(record)?.locations ?? []).reduce((sum, location) => sum + location.size, 0);
}

export function cacheCoverageForTracks(tracks, records, { scopeKey = "", format = "", bitrate = null } = {}) {
  const byTrack = new Map((records ?? []).map(record => {
    const normalized = normalizeCacheRecord(record);
    return [normalized?.trackId, normalized];
  }).filter(([trackId]) => trackId));
  let availableCount = 0;
  let archivedCount = 0;
  for (const track of tracks ?? []) {
    const trackId = String(track?.id ?? track?.bvid ?? "");
    const locations = byTrack.get(trackId)?.locations ?? [];
    if (locations.length) availableCount += 1;
    if (locations.some(location => locationMatches(location, { scopeKey, format, bitrate }))) archivedCount += 1;
  }
  return { total: tracks?.length ?? 0, availableCount, archivedCount };
}

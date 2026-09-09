function text(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function timestamp(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

export function normalizePlaylistItem(track, now = Date.now()) {
  const bvid = text(track?.bvid || (String(track?.id || "").startsWith("BV") ? track.id : ""));
  if (!bvid) return null;
  return {
    bvid,
    title: text(track?.title, bvid),
    duration: Math.max(0, Number(track?.duration) || 0),
    creatorId: text(track?.creatorId ?? track?.creator?.id),
    creatorName: text(track?.creatorName ?? track?.creator?.name),
    addedAt: timestamp(track?.addedAt, now)
  };
}

export function playlistItemToTrack(item) {
  return {
    id: item.bvid,
    bvid: item.bvid,
    title: item.title || item.bvid,
    duration: Number(item.duration) || 0,
    creator: item.creatorId || item.creatorName
      ? { id: item.creatorId || "", name: item.creatorName || "" }
      : null
  };
}

export async function repairPlaylistDurations(playlists, resolveVideo, now = Date.now()) {
  const normalized = normalizePlaylists(playlists);
  const next = [];
  for (const playlist of normalized) {
    let changed = false;
    const items = [];
    for (const item of playlist.items) {
      if (item.duration > 0) {
        items.push(item);
        continue;
      }
      try {
        const video = await resolveVideo(item);
        const duration = Math.max(0, Number(video?.duration) || 0);
        if (duration > 0) {
          items.push({ ...item, duration });
          changed = true;
        } else {
          items.push(item);
        }
      } catch {
        items.push(item);
      }
    }
    next.push(changed ? { ...playlist, items, updatedAt: now } : { ...playlist, items });
  }
  return next;
}

export function normalizePlaylists(value) {
  if (!Array.isArray(value)) return [];
  const ids = new Set();
  return value.flatMap((playlist, index) => {
    const id = text(playlist?.id);
    const name = text(playlist?.name);
    if (!id || !name || ids.has(id)) return [];
    ids.add(id);
    const fallbackTime = Date.now() + index;
    const seen = new Set();
    const items = (Array.isArray(playlist.items) ? playlist.items : []).flatMap(item => {
      const normalized = normalizePlaylistItem(item, fallbackTime);
      if (!normalized || seen.has(normalized.bvid)) return [];
      seen.add(normalized.bvid);
      return [normalized];
    });
    return [{
      id,
      name,
      createdAt: timestamp(playlist.createdAt, fallbackTime),
      updatedAt: timestamp(playlist.updatedAt, fallbackTime),
      items
    }];
  });
}

export function createPlaylist(playlists, name, { id = crypto.randomUUID(), now = Date.now() } = {}) {
  const normalizedName = text(name);
  if (!normalizedName) throw new Error("播放列表名称不能为空");
  if (normalizedName.length > 80) throw new Error("播放列表名称不能超过 80 个字符");
  return [...normalizePlaylists(playlists), {
    id,
    name: normalizedName,
    createdAt: now,
    updatedAt: now,
    items: []
  }];
}

export function renamePlaylist(playlists, playlistId, name, now = Date.now()) {
  const normalizedName = text(name);
  if (!normalizedName) throw new Error("播放列表名称不能为空");
  if (normalizedName.length > 80) throw new Error("播放列表名称不能超过 80 个字符");
  let found = false;
  const next = normalizePlaylists(playlists).map(playlist => {
    if (playlist.id !== playlistId) return playlist;
    found = true;
    return { ...playlist, name: normalizedName, updatedAt: now };
  });
  if (!found) throw new Error("播放列表不存在");
  return next;
}

export function deletePlaylist(playlists, playlistId) {
  const current = normalizePlaylists(playlists);
  if (!current.some(playlist => playlist.id === playlistId)) throw new Error("播放列表不存在");
  return current.filter(playlist => playlist.id !== playlistId);
}

export function addTracksToPlaylist(playlists, playlistId, tracks, now = Date.now()) {
  let found = false;
  const next = normalizePlaylists(playlists).map(playlist => {
    if (playlist.id !== playlistId) return playlist;
    found = true;
    const seen = new Set(playlist.items.map(item => item.bvid));
    const additions = (tracks ?? []).flatMap(track => {
      const item = normalizePlaylistItem(track, now);
      if (!item || seen.has(item.bvid)) return [];
      seen.add(item.bvid);
      return [item];
    });
    return additions.length ? { ...playlist, items: [...playlist.items, ...additions], updatedAt: now } : playlist;
  });
  if (!found) throw new Error("播放列表不存在");
  return next;
}

export function removeTrackFromPlaylist(playlists, playlistId, bvid, now = Date.now()) {
  let found = false;
  const next = normalizePlaylists(playlists).map(playlist => {
    if (playlist.id !== playlistId) return playlist;
    found = true;
    const items = playlist.items.filter(item => item.bvid !== bvid);
    return items.length === playlist.items.length ? playlist : { ...playlist, items, updatedAt: now };
  });
  if (!found) throw new Error("播放列表不存在");
  return next;
}

export function reorderPlaylistTrack(playlists, playlistId, fromIndex, toIndex, now = Date.now()) {
  let found = false;
  const next = normalizePlaylists(playlists).map(playlist => {
    if (playlist.id !== playlistId) return playlist;
    found = true;
    const from = Number(fromIndex);
    const to = Number(toIndex);
    if (!Number.isInteger(from) || !Number.isInteger(to)
      || from < 0 || to < 0 || from >= playlist.items.length || to >= playlist.items.length || from === to) {
      return playlist;
    }
    const items = [...playlist.items];
    const [moved] = items.splice(from, 1);
    items.splice(to, 0, moved);
    return { ...playlist, items, updatedAt: now };
  });
  if (!found) throw new Error("播放列表不存在");
  return next;
}

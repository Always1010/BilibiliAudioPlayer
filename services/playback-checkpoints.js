export const PLAYBACK_RESUME_END_THRESHOLD = 5;

const SCOPED_KINDS = new Set(["season", "series", "playlist"]);

function text(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function trackId(track) {
  return text(track?.id ?? track?.bvid);
}

export function playbackScopeKey(context) {
  const kind = text(context?.kind);
  const id = text(context?.id);
  if (!SCOPED_KINDS.has(kind) || !id) return null;
  if (kind === "playlist") return `playlist:${id}`;
  const creatorId = text(context?.creatorId);
  return creatorId ? `${kind}:${creatorId}:${id}` : null;
}

export function normalizePlaybackCheckpoint(value, fallbackKey = "") {
  const scopeKey = text(value?.scopeKey, fallbackKey);
  const kind = text(value?.kind);
  const id = text(value?.id);
  const track = text(value?.trackId);
  if (!scopeKey || !SCOPED_KINDS.has(kind) || !id || !track) return null;
  return {
    scopeKey,
    kind,
    id,
    creatorId: text(value?.creatorId),
    title: text(value?.title),
    trackId: track,
    trackTitle: text(value?.trackTitle, track),
    index: Math.max(0, Math.trunc(finiteNumber(value?.index))),
    total: Math.max(0, Math.trunc(finiteNumber(value?.total))),
    position: Math.max(0, finiteNumber(value?.position)),
    duration: Math.max(0, finiteNumber(value?.duration)),
    order: text(value?.order, kind === "playlist" ? "fixed" : "asc"),
    completed: Boolean(value?.completed),
    updatedAt: Math.max(0, finiteNumber(value?.updatedAt))
  };
}
export function normalizePlaybackCheckpoints(value) {
  const source = value?.scopes && typeof value.scopes === "object" ? value.scopes : {};
  const scopes = {};
  for (const [key, checkpoint] of Object.entries(source)) {
    const normalized = normalizePlaybackCheckpoint(checkpoint, key);
    if (normalized && normalized.scopeKey === key) scopes[key] = normalized;
  }
  return { scopes };
}

export function checkpointFromPlayer(player, now = Date.now()) {
  const context = player?.queueContext;
  const scopeKey = playbackScopeKey(context);
  const queue = Array.isArray(player?.queue) ? player.queue : [];
  const index = Math.trunc(finiteNumber(player?.queueIndex, -1));
  const currentTrack = player?.currentTrack ?? queue[index];
  const currentTrackId = trackId(currentTrack);
  if (!scopeKey || !currentTrackId || index < 0 || index >= queue.length) return null;

  const duration = Math.max(0, finiteNumber(player?.duration, finiteNumber(currentTrack?.duration)));
  const position = Math.max(0, Math.min(finiteNumber(player?.currentTime), duration || Number.MAX_SAFE_INTEGER));
  const completed = Boolean(player?.checkpointCompleted)
    || (duration > 0
      && duration - position <= PLAYBACK_RESUME_END_THRESHOLD
      && index === queue.length - 1);

  return normalizePlaybackCheckpoint({
    scopeKey,
    kind: context.kind,
    id: context.id,
    creatorId: context.creatorId,
    title: context.title,
    trackId: currentTrackId,
    trackTitle: currentTrack?.title,
    index,
    total: queue.length,
    position,
    duration,
    order: context.order,
    completed,
    updatedAt: now
  });
}

export function updatePlaybackCheckpoints(value, player, now = Date.now()) {
  const current = normalizePlaybackCheckpoints(value);
  const checkpoint = checkpointFromPlayer(player, now);
  if (!checkpoint) return current;
  return {
    scopes: {
      ...current.scopes,
      [checkpoint.scopeKey]: checkpoint
    }
  };
}

export function removePlaybackCheckpoint(value, scopeKey) {
  const current = normalizePlaybackCheckpoints(value);
  const scopes = { ...current.scopes };
  delete scopes[String(scopeKey)];
  return { scopes };
}

export function resolvePlaybackCheckpoint(checkpointLike, tracks) {
  const checkpoint = normalizePlaybackCheckpoint(checkpointLike);
  const queue = Array.isArray(tracks) ? tracks : [];
  if (!checkpoint || !queue.length) return null;

  const exactIndex = queue.findIndex(track => trackId(track) === checkpoint.trackId);
  let index = exactIndex >= 0
    ? exactIndex
    : Math.max(0, Math.min(checkpoint.index, queue.length - 1));
  let position = exactIndex >= 0 ? checkpoint.position : 0;
  let completed = checkpoint.completed;
  const duration = Math.max(0, finiteNumber(queue[index]?.duration, checkpoint.duration));

  if (!completed && duration > 0 && duration - position <= PLAYBACK_RESUME_END_THRESHOLD) {
    if (index < queue.length - 1) {
      index += 1;
      position = 0;
    } else {
      completed = true;
    }
  }

  return {
    index: completed ? 0 : index,
    position: completed ? 0 : Math.max(0, Math.min(position, duration || position)),
    completed,
    missingTrack: exactIndex < 0,
    track: queue[completed ? 0 : index]
  };
}

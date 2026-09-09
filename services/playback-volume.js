export const PLAYBACK_VOLUME_MIN = 0;
export const PLAYBACK_VOLUME_MAX = 2;

export function normalizePlaybackVolume(value, fallback = 0.8) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return normalizePlaybackVolume(fallback, 0.8);
  return Math.max(PLAYBACK_VOLUME_MIN, Math.min(PLAYBACK_VOLUME_MAX, numeric));
}

export function playbackVolumePercent(value) {
  return Math.round(normalizePlaybackVolume(value) * 100);
}

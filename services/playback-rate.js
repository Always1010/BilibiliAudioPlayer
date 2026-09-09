export const PLAYBACK_RATE_MIN = 0.5;
export const PLAYBACK_RATE_MAX = 4;
export const PLAYBACK_RATE_STEP = 0.1;
export const PLAYBACK_RATE_PRESETS = Object.freeze([0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4]);

export function normalizePlaybackRate(value, fallback = 1) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return normalizePlaybackRate(fallback, 1);
  const clamped = Math.max(PLAYBACK_RATE_MIN, Math.min(PLAYBACK_RATE_MAX, numeric));
  const preset = PLAYBACK_RATE_PRESETS.find(rate => Math.abs(rate - clamped) < Number.EPSILON);
  if (preset != null) return preset;
  return Math.round(clamped / PLAYBACK_RATE_STEP) * PLAYBACK_RATE_STEP;
}

export function playbackRateLabel(value) {
  return `${normalizePlaybackRate(value).toFixed(1).replace(/\.0$/, "")}×`;
}

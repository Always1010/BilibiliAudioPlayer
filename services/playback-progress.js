export const PLAYBACK_PROGRESS_PERSIST_INTERVAL = 5;

function progressSecond(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
}

export function playbackProgressReportPolicy(currentTime, lastReportedSecond, lastPersistedSecond) {
  const second = progressSecond(currentTime);
  const shouldReport = second !== lastReportedSecond;
  const persistedSecond = Number.isFinite(lastPersistedSecond) ? lastPersistedSecond : -1;
  return {
    second,
    shouldReport,
    shouldPersist: shouldReport
      && (persistedSecond < 0 || Math.abs(second - persistedSecond) >= PLAYBACK_PROGRESS_PERSIST_INTERVAL)
  };
}

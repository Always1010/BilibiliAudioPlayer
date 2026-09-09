export const CACHE_HISTORY_LIMIT = 30;
const TERMINAL_STATUSES = new Set(["completed", "failed", "skipped"]);

export function summarizeCacheTask(task) {
  if (!task) return null;
  return {
    track: {
      id: String(task.track?.id ?? ""),
      title: task.track?.title ?? "未命名作品",
      creator: task.track?.creator ?? null
    },
    section: task.section ? {
      id: String(task.section.id ?? ""),
      type: task.section.type,
      title: task.section.title
    } : null,
    format: task.format,
    bitrate: task.bitrate,
    position: task.position
  };
}

export function addCacheHistory(history, task, patch, finishedAt = Date.now()) {
  if (!task || !TERMINAL_STATUSES.has(patch.status)) return history;
  return [{
    ...summarizeCacheTask(task),
    status: patch.status,
    message: patch.message ?? "",
    size: Number(patch.record?.size ?? 0),
    finishedAt
  }, ...history].slice(0, CACHE_HISTORY_LIMIT);
}

export function stripHtml(value = "") {
  return String(value).replace(/<[^>]*>/g, "").replaceAll("&amp;", "&").trim();
}

export function formatDuration(totalSeconds) {
  const value = Math.max(0, Number(totalSeconds) || 0);
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const seconds = Math.floor(value % 60);
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function formatDate(timestamp) {
  if (!timestamp) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(Number(timestamp) * 1000));
}

export function normalizeImageUrl(url = "") {
  return url.startsWith("//") ? `https:${url}` : url.replace(/^http:/, "https:");
}

export function toErrorMessage(error) {
  if (error instanceof Error) return error.message;
  return String(error || "未知错误");
}

export function audioStreamCandidates(stream) {
  return [...new Set([stream?.url, ...(stream?.backupUrls ?? [])].filter(Boolean))];
}

export function mediaSourceType(stream) {
  const mimeType = String(stream?.mimeType || "").toLowerCase();
  if (!new Set(["audio/mp4", "audio/webm", "audio/mpeg", "audio/aac"]).has(mimeType)) return "";
  const codec = String(stream?.codec || "").replace(/["\\]/g, "").trim();
  return codec ? `${mimeType}; codecs="${codec}"` : mimeType;
}

export function mediaErrorText(error) {
  const messages = {
    1: "加载被中止",
    2: "媒体网络请求失败",
    3: "浏览器无法解码该音频",
    4: "浏览器不支持该音频格式"
  };
  return messages[Number(error?.code)] ?? "未知媒体错误";
}

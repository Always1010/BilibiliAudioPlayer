import { normalizePlaylists } from "./playlists.js";

export const PLAYLIST_EXPORT_SCHEMA = "bilibili-audio-playlists";
export const PLAYLIST_EXPORT_VERSION = 1;

const MAX_PLAYLISTS = 500;
const MAX_ITEMS = 10000;

function importedName(name) {
  const suffix = "（导入）";
  return `${String(name).slice(0, 80 - suffix.length)}${suffix}`;
}

function assertImportShape(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("导入文件不是有效的播放列表数据");
  if (value.schema !== PLAYLIST_EXPORT_SCHEMA) throw new Error("导入文件不是哔哩音频播放列表备份");
  if (value.schemaVersion !== PLAYLIST_EXPORT_VERSION) throw new Error(`暂不支持播放列表备份版本 ${value.schemaVersion ?? "未知"}`);
  if (!Array.isArray(value.playlists)) throw new Error("导入文件缺少播放列表数组");
  if (value.playlists.length > MAX_PLAYLISTS) throw new Error(`单次最多导入 ${MAX_PLAYLISTS} 个播放列表`);

  const ids = new Set();
  let itemCount = 0;
  for (const playlist of value.playlists) {
    if (!playlist || typeof playlist !== "object" || Array.isArray(playlist)) throw new Error("播放列表结构无效");
    const id = String(playlist.id ?? "").trim();
    const name = String(playlist.name ?? "").trim();
    if (!id || id.length > 200 || ids.has(id)) throw new Error("播放列表 ID 为空、重复或过长");
    if (!name || name.length > 80) throw new Error("播放列表名称为空或超过 80 个字符");
    ids.add(id);
    if (!Array.isArray(playlist.items)) throw new Error(`播放列表“${name}”缺少作品数组`);
    itemCount += playlist.items.length;
    if (itemCount > MAX_ITEMS) throw new Error(`单次最多导入 ${MAX_ITEMS} 个作品`);
    for (const item of playlist.items) {
      const bvid = String(item?.bvid ?? "").trim();
      if (!/^BV[0-9A-Za-z]{6,30}$/.test(bvid)) throw new Error(`播放列表“${name}”包含无效 BV 号`);
      if (String(item?.title ?? "").length > 500) throw new Error(`播放列表“${name}”包含过长标题`);
      if (String(item?.creatorId ?? "").length > 100 || String(item?.creatorName ?? "").length > 200) {
        throw new Error(`播放列表“${name}”包含过长的 UP 主信息`);
      }
    }
  }
}

export function createPlaylistExport(playlists, { appVersion = "", now = Date.now() } = {}) {
  return {
    schema: PLAYLIST_EXPORT_SCHEMA,
    schemaVersion: PLAYLIST_EXPORT_VERSION,
    exportedAt: new Date(now).toISOString(),
    appVersion: String(appVersion),
    playlists: normalizePlaylists(playlists)
  };
}

export function serializePlaylistExport(playlists, options) {
  return `${JSON.stringify(createPlaylistExport(playlists, options), null, 2)}\n`;
}

export function parsePlaylistExport(source) {
  let value;
  try {
    value = JSON.parse(String(source));
  } catch {
    throw new Error("无法解析导入文件，请确认它是完整的 JSON 文件");
  }
  assertImportShape(value);
  const playlists = normalizePlaylists(value.playlists);
  return {
    schemaVersion: value.schemaVersion,
    exportedAt: value.exportedAt ? String(value.exportedAt) : "",
    appVersion: value.appVersion ? String(value.appVersion) : "",
    playlists,
    playlistCount: playlists.length,
    itemCount: playlists.reduce((sum, playlist) => sum + playlist.items.length, 0)
  };
}

export function mergeImportedPlaylists(current, imported, { mode = "merge", idFactory = () => crypto.randomUUID() } = {}) {
  const incoming = normalizePlaylists(imported);
  if (mode === "replace") return incoming;
  if (mode !== "merge") throw new Error("未知的播放列表导入方式");

  const result = normalizePlaylists(current);
  const ids = new Set(result.map(playlist => playlist.id));
  for (const playlist of incoming) {
    let id = playlist.id;
    let name = playlist.name;
    if (ids.has(id)) {
      do id = String(idFactory()); while (!id || ids.has(id));
      name = importedName(name);
    }
    ids.add(id);
    result.push({ ...playlist, id, name });
  }
  return result;
}

import { normalizeCacheRecord } from "./cache-records.js";

const CREATOR_SCOPE_ORDER = new Map([
  ["all", 0],
  ["season", 1],
  ["series", 2]
]);

function text(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function group(id, label, options = {}) {
  return {
    kind: "group",
    id,
    label,
    subtitle: options.subtitle ?? "",
    groupType: options.groupType ?? "folder",
    order: options.order ?? 0,
    children: [],
    count: 0,
    size: 0,
    locationKeys: []
  };
}

function locationKey(trackId, locationId) {
  return `${encodeURIComponent(String(trackId))}::${encodeURIComponent(String(locationId))}`;
}

function childGroup(parent, id, label, options = {}) {
  let child = parent.children.find(item => item.kind === "group" && item.id === id);
  if (!child) {
    child = group(id, label, options);
    parent.children.push(child);
  }
  return child;
}

function creatorFolderLabel(record, path) {
  return text(record.creator?.name, path[0] || "未知 UP 主");
}

function creatorFolderId(record, path) {
  return text(record.creator?.id, path[0] || "unknown");
}

function creatorScopeLabel(type) {
  if (type === "season") return "合集";
  if (type === "series") return "系列";
  return "全部作品";
}

function appendDirectoryPath(parent, parts, prefix) {
  let current = parent;
  parts.forEach((part, index) => {
    const pathKey = parts.slice(0, index + 1).join("/");
    current = childGroup(current, `${prefix}:${pathKey}`, part, { groupType: "folder", order: index });
  });
  return current;
}

function targetGroup(roots, record, location) {
  const path = location.path ?? [];
  const scopeType = text(location.scope?.type);
  if (scopeType === "playlist" || path[0] === "我的播放列表") {
    const title = text(location.scope?.title, path[1] || "未命名播放列表");
    const id = text(location.scope?.key, `path:${path.slice(0, -1).join("/")}`);
    return childGroup(roots.playlists, `playlist:${id}`, title, { groupType: "playlist", order: 0 });
  }

  if (CREATOR_SCOPE_ORDER.has(scopeType)) {
    const creatorId = creatorFolderId(record, path);
    const creator = childGroup(roots.creators, `creator:${creatorId}`, creatorFolderLabel(record, path), {
      subtitle: record.creator?.id ? `UID ${record.creator.id}` : "",
      groupType: "creator"
    });
    const categoryLabel = creatorScopeLabel(scopeType);
    const category = childGroup(creator, `creator:${creatorId}:${scopeType}`, categoryLabel, {
      groupType: "category",
      order: CREATOR_SCOPE_ORDER.get(scopeType)
    });
    if (scopeType === "all") return category;
    const scopeId = text(location.scope?.key, `path:${path.slice(0, -1).join("/")}`);
    return childGroup(category, `scope:${scopeId}`, text(location.scope?.title, path.at(-2) || "未命名归档"), {
      groupType: "scope"
    });
  }

  return appendDirectoryPath(roots.recovered, path.slice(0, -1), "recovered");
}

function compareNodes(left, right) {
  if (left.kind !== right.kind) return left.kind === "group" ? -1 : 1;
  if (left.kind === "group" && left.order !== right.order) return left.order - right.order;
  const leftName = left.kind === "group" ? left.label : left.title;
  const rightName = right.kind === "group" ? right.label : right.title;
  return leftName.localeCompare(rightName, "zh-CN", { numeric: true });
}

function summarize(node) {
  node.children.sort(compareNodes);
  node.count = 0;
  node.size = 0;
  node.locationKeys = [];
  for (const child of node.children) {
    if (child.kind === "group") summarize(child);
    node.count += child.kind === "group" ? child.count : 1;
    node.size += Number(child.size) || 0;
    node.locationKeys.push(...(child.kind === "group" ? child.locationKeys : [child.key]));
  }
  return node;
}

export function flattenCacheLocations(records) {
  const leaves = [];
  for (const value of records ?? []) {
    const record = normalizeCacheRecord(value);
    if (!record) continue;
    for (const location of record.locations) {
      leaves.push({
        kind: "file",
        key: locationKey(record.trackId, location.id),
        trackId: record.trackId,
        locationId: location.id,
        bvid: record.bvid,
        title: record.title,
        creator: record.creator,
        scope: location.scope,
        path: location.path,
        format: location.format,
        bitrate: location.bitrate,
        size: location.size,
        cachedAt: location.cachedAt
      });
    }
  }
  return leaves;
}

export function buildCacheLibrary(records) {
  const roots = {
    creators: group("root:creators", "UP 主归档", { groupType: "root", order: 0 }),
    playlists: group("root:playlists", "我的播放列表", { groupType: "root", order: 1 }),
    recovered: group("root:recovered", "恢复或未分类归档", { groupType: "root", order: 2 })
  };

  for (const leaf of flattenCacheLocations(records)) {
    targetGroup(roots, leaf, leaf).children.push(leaf);
  }

  const result = [roots.creators, roots.playlists, roots.recovered]
    .map(summarize)
    .filter(node => node.count > 0);
  return result.flatMap(node => node.id === "root:creators" ? node.children : [node]);
}

export function cacheLibraryLocationMap(records) {
  return new Map(flattenCacheLocations(records).map(location => [location.key, location]));
}

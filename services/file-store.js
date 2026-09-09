import {
  locationMatches,
  mergeCacheLocation,
  normalizeCacheRecord,
  orderedCacheLocations,
  removeCacheLocation
} from "./cache-records.js";

const DATABASE_NAME = "bili-audio-files";
const DATABASE_VERSION = 1;
const HANDLE_STORE = "handles";
const RECORD_STORE = "records";
const DIRECTORY_KEY = "cache-directory";

export function createDirectoryHandleCache(loader) {
  let cached = null;
  let loading = null;
  return {
    async get() {
      if (cached) return cached;
      if (!loading) {
        loading = Promise.resolve(loader())
          .then(handle => {
            cached = handle ?? null;
            return cached;
          })
          .finally(() => {
            loading = null;
          });
      }
      return loading;
    },
    set(handle) {
      cached = handle ?? null;
      loading = null;
    },
    clear() {
      cached = null;
      loading = null;
    }
  };
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(HANDLE_STORE)) database.createObjectStore(HANDLE_STORE);
      if (!database.objectStoreNames.contains(RECORD_STORE)) database.createObjectStore(RECORD_STORE, { keyPath: "trackId" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function useStore(name, mode, operation) {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(name, mode);
      const store = transaction.objectStore(name);
      const request = operation(store);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

const directoryHandleCache = createDirectoryHandleCache(() =>
  useStore(HANDLE_STORE, "readonly", store => store.get(DIRECTORY_KEY))
);

export async function chooseCacheDirectory() {
  if (!("showDirectoryPicker" in globalThis)) {
    throw new Error("当前浏览器不支持目录授权，请升级 Edge 或 Chrome");
  }
  const handle = await globalThis.showDirectoryPicker({ id: "bili-audio-cache", mode: "readwrite" });
  await useStore(HANDLE_STORE, "readwrite", store => store.put(handle, DIRECTORY_KEY));
  directoryHandleCache.set(handle);
  return { name: handle.name, permission: "granted" };
}

export function needsCacheDirectoryReauthorization(directory) {
  return Boolean(directory?.configured && directory.permission !== "granted");
}

export async function reauthorizeCacheDirectory() {
  const handle = await getCacheDirectoryHandle();
  if (!handle) return chooseCacheDirectory();
  const permission = await handle.requestPermission({ mode: "readwrite" });
  if (permission !== "granted") throw new Error("未获得缓存目录读写权限，请允许目录访问后重试");
  directoryHandleCache.set(handle);
  return { name: handle.name, permission };
}

export function getCacheDirectoryHandle() {
  return directoryHandleCache.get();
}

export function clearCacheDirectoryHandle() {
  directoryHandleCache.clear();
}

export async function getCacheDirectoryInfo() {
  const handle = await getCacheDirectoryHandle();
  if (!handle) return { configured: false, name: "", permission: "prompt" };
  const permission = await handle.queryPermission({ mode: "readwrite" });
  return { configured: true, name: handle.name, permission };
}

function isNotFoundError(error) {
  return error?.name === "NotFoundError";
}

export async function requireWritableDirectory() {
  const handle = await getCacheDirectoryHandle();
  if (!handle) throw new Error("请先在缓存管理中选择本地目录");
  const permission = await handle.queryPermission({ mode: "readwrite" });
  if (permission !== "granted") throw new Error("缓存目录权限已失效，请在提示中或缓存管理中重新授权");
  return handle;
}

export async function putCacheRecord(record) {
  const current = await useStore(RECORD_STORE, "readonly", store => store.get(String(record.trackId)));
  const next = mergeCacheLocation(current, record);
  await useStore(RECORD_STORE, "readwrite", store => store.put(next));
  return next;
}

export async function getCacheRecord(trackId) {
  return normalizeCacheRecord(await useStore(RECORD_STORE, "readonly", store => store.get(String(trackId))));
}

export async function listCacheRecords() {
  const values = await useStore(RECORD_STORE, "readonly", store => store.getAll());
  return values.map(normalizeCacheRecord).filter(Boolean);
}

export function deleteCacheRecord(trackId) {
  return useStore(RECORD_STORE, "readwrite", store => store.delete(String(trackId)));
}

export async function deleteCacheLocation(trackId, locationId) {
  const current = await getCacheRecord(trackId);
  const next = removeCacheLocation(current, locationId);
  if (!next) {
    await deleteCacheRecord(trackId);
    return null;
  }
  await useStore(RECORD_STORE, "readwrite", store => store.put(next));
  return next;
}

export async function removeCacheFileAtPath(root, path) {
  if (!root || !Array.isArray(path) || path.length < 1) throw new Error("缓存文件路径无效");
  let directory = root;
  try {
    for (const part of path.slice(0, -1)) directory = await directory.getDirectoryHandle(part);
    await directory.removeEntry(path.at(-1));
    return { removed: true, missing: false };
  } catch (error) {
    if (isNotFoundError(error)) return { removed: false, missing: true };
    throw error;
  }
}

export async function pruneEmptyCacheDirectories(root, path) {
  const parts = Array.isArray(path) ? path.filter(Boolean) : [];
  let removed = 0;
  for (let index = parts.length; index > 0; index -= 1) {
    let parent = root;
    try {
      for (const part of parts.slice(0, index - 1)) parent = await parent.getDirectoryHandle(part);
      await parent.removeEntry(parts[index - 1]);
      removed += 1;
    } catch {
      break;
    }
  }
  return removed;
}

export async function deleteCacheFiles(targets) {
  const root = await requireWritableDirectory();
  const unique = new Map((targets ?? []).map(target => [`${target.trackId}\u0000${target.locationId}`, target]));
  const results = [];
  for (const target of unique.values()) {
    const record = await getCacheRecord(target.trackId);
    const location = record?.locations.find(item => item.id === target.locationId);
    if (!record || !location) {
      results.push({ ...target, status: "missing-index", size: 0 });
      continue;
    }
    try {
      const physical = await removeCacheFileAtPath(root, location.path);
      await deleteCacheLocation(record.trackId, location.id);
      if (location.scope?.type !== "playlist") {
        await pruneEmptyCacheDirectories(root, location.path.slice(0, -1));
      }
      results.push({
        trackId: record.trackId,
        bvid: record.bvid,
        title: record.title,
        location,
        status: physical.missing ? "missing-file" : "deleted",
        size: location.size
      });
    } catch (error) {
      results.push({
        trackId: record.trackId,
        bvid: record.bvid,
        title: record.title,
        location,
        status: "failed",
        size: location.size,
        error: error?.message || "删除失败"
      });
    }
  }
  return {
    results,
    deleted: results.filter(item => item.status === "deleted").length,
    cleaned: results.filter(item => item.status === "missing-file" || item.status === "missing-index").length,
    failed: results.filter(item => item.status === "failed").length,
    bytes: results.filter(item => item.status === "deleted").reduce((sum, item) => sum + (Number(item.size) || 0), 0),
    root
  };
}

export function safeFilePart(value, fallback = "未命名") {
  const normalized = String(value || fallback)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/[. ]+$/g, "")
    .trim();
  return (normalized || fallback).slice(0, 100);
}

export async function getOrCreateDirectory(root, parts) {
  let current = root;
  for (const part of parts.filter(Boolean)) {
    current = await current.getDirectoryHandle(safeFilePart(part), { create: true });
  }
  return current;
}

async function fileAtPath(root, path) {
  let directory = root;
  for (const part of path.slice(0, -1)) {
    directory = await directory.getDirectoryHandle(part);
  }
  const fileHandle = await directory.getFileHandle(path.at(-1));
  return fileHandle.getFile();
}

export async function findCachedFiles(record, options = {}) {
  const root = await getCacheDirectoryHandle();
  if (!root || await root.queryPermission({ mode: "read" }) !== "granted") return [];
  const normalized = normalizeCacheRecord(record);
  if (!normalized) return [];
  const preferredScopeKey = String(options.preferredScopeKey ?? "");
  const locations = orderedCacheLocations(normalized, preferredScopeKey).filter(location =>
    locationMatches(location, {
      scopeKey: options.onlyPreferred ? preferredScopeKey : "",
      format: options.format,
      bitrate: options.bitrate
    })
  );
  const found = [];
  for (const location of locations) {
    try {
      const file = await fileAtPath(root, location.path);
      if (file.size) found.push({ file, location });
      else await deleteCacheLocation(normalized.trackId, location.id);
    } catch {
      await deleteCacheLocation(normalized.trackId, location.id);
    }
  }
  return found;
}

export async function findCachedFile(record, options = {}) {
  return (await findCachedFiles(record, options))[0] ?? null;
}

export async function getCachedFile(record, options = {}) {
  return (await findCachedFile(record, options))?.file ?? null;
}

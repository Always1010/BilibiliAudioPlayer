import {
  locationMatches,
  mergeCacheLocation,
  normalizeCacheRecord,
  orderedCacheLocations,
  removeCacheLocation
} from "./cache-records.js";

const DATABASE_NAME = "bili-audio-files";
const DATABASE_VERSION = 2;
const HANDLE_STORE = "handles";
const RECORD_STORE = "records";
const ROOT_RECORD_STORE = "root-records";
const DIRECTORY_KEY = "cache-directory";
const ROOTS_KEY = "cache-roots";
const DIRECTORY_LOCK = "bili-audio-cache-directory";

export function createDirectoryHandleCache(loader) {
  let cached = null;
  let loading = null;
  let generation = 0;
  const cache = {
    async get() {
      if (cached) return cached;
      if (!loading) {
        const currentGeneration = generation;
        const task = Promise.resolve().then(loader)
          .then(handle => {
            if (currentGeneration !== generation) return cache.get();
            cached = handle ?? null;
            return cached;
          })
          .finally(() => {
            if (loading === task) loading = null;
          });
        loading = task;
      }
      return loading;
    },
    set(handle) {
      generation += 1;
      cached = handle ?? null;
      loading = null;
    },
    clear() {
      generation += 1;
      cached = null;
      loading = null;
    }
  };
  return cache;
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(HANDLE_STORE)) database.createObjectStore(HANDLE_STORE);
      if (!database.objectStoreNames.contains(RECORD_STORE)) database.createObjectStore(RECORD_STORE, { keyPath: "trackId" });
      if (!database.objectStoreNames.contains(ROOT_RECORD_STORE)) database.createObjectStore(ROOT_RECORD_STORE, { keyPath: "recordKey" });
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
      let result;
      request.onsuccess = () => { result = request.result; };
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new Error("缓存索引事务已取消"));
    });
  } finally {
    database.close();
  }
}

function recordKey(rootId, trackId) {
  return `${rootId}\u0000${String(trackId)}`;
}

async function updateCacheRecord(rootId, trackId, updater) {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(ROOT_RECORD_STORE, "readwrite");
      const store = transaction.objectStore(ROOT_RECORD_STORE);
      let next;
      const key = recordKey(rootId, trackId);
      const request = store.get(key);
      request.onsuccess = () => {
        try {
          next = updater(request.result);
          if (next) store.put({ ...next, rootId, recordKey: key });
          else store.delete(key);
        } catch (error) {
          transaction.abort();
          reject(error);
        }
      };
      transaction.oncomplete = () => resolve(next);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new Error("缓存索引事务已取消"));
    });
  } finally {
    database.close();
  }
}

function withDirectoryLock(mode, operation, ifAvailable = false) {
  if (!globalThis.navigator?.locks) throw new Error("当前浏览器不支持安全的缓存目录协调，请升级 Edge 或 Chrome");
  return navigator.locks.request(DIRECTORY_LOCK, { mode, ifAvailable }, lock => {
    if (!lock) throw new Error("缓存、扫描或删除任务正在执行，请等待任务结束后切换目录");
    return operation();
  });
}

async function saveDirectoryState(selected, roots) {
  await useStore(HANDLE_STORE, "readwrite", store => {
    store.put(roots, ROOTS_KEY);
    return store.put(selected, DIRECTORY_KEY);
  });
}

async function loadDirectoryState() {
  const selected = await useStore(HANDLE_STORE, "readonly", store => store.get(DIRECTORY_KEY));
  if (!selected || selected.rootId) return selected ?? null;
  // Keep legacy file indexes unassigned: their relative paths are insufficient
  // evidence that they belong to the directory currently selected.
  return navigator.locks.request(`${DIRECTORY_LOCK}-identity`, async () => {
    const latest = await useStore(HANDLE_STORE, "readonly", store => store.get(DIRECTORY_KEY));
    if (!latest || latest.rootId) return latest ?? null;
    const migrated = { rootId: crypto.randomUUID(), handle: latest };
    const roots = await useStore(HANDLE_STORE, "readonly", store => store.get(ROOTS_KEY)) ?? [];
    await saveDirectoryState(migrated, [...roots, migrated]);
    return migrated;
  });
}

const directoryHandleCache = createDirectoryHandleCache(async () => (await loadDirectoryState())?.handle);

export function withCacheDirectoryOperation(operation) {
  return withDirectoryLock("shared", async () => {
    const selected = await loadDirectoryState();
    const root = await requireWritableDirectory();
    return operation(root, selected.rootId);
  });
}

export async function chooseCacheDirectory() {
  if (!("showDirectoryPicker" in globalThis)) {
    throw new Error("当前浏览器不支持目录授权，请升级 Edge 或 Chrome");
  }
  const handle = await globalThis.showDirectoryPicker({ id: "bili-audio-cache", mode: "readwrite" });
  return withDirectoryLock("exclusive", async () => {
    await loadDirectoryState();
    const roots = await useStore(HANDLE_STORE, "readonly", store => store.get(ROOTS_KEY)) ?? [];
    let same = null;
    for (const candidate of roots) {
      try { if (await handle.isSameEntry(candidate.handle)) { same = candidate; break; } } catch {}
    }
    const selected = { rootId: same?.rootId ?? crypto.randomUUID(), handle };
    await saveDirectoryState(selected, [...roots.filter(root => root.rootId !== selected.rootId), selected]);
    directoryHandleCache.set(handle);
    return { rootId: selected.rootId, name: handle.name, permission: "granted" };
  }, true);
}

export function needsCacheDirectoryReauthorization(directory) {
  return Boolean(directory?.configured && directory.permission !== "granted");
}

export async function reauthorizeCacheDirectory() {
  if (!(await loadDirectoryState())?.handle) return chooseCacheDirectory();
  return withDirectoryLock("shared", async () => {
    const selected = await loadDirectoryState();
    const permission = await selected.handle.requestPermission({ mode: "readwrite" });
    if (permission !== "granted") throw new Error("未获得缓存目录读写权限，请允许目录访问后重试");
    directoryHandleCache.set(selected.handle);
    return { rootId: selected.rootId, name: selected.handle.name, permission };
  });
}

export async function getCacheDirectoryHandle() {
  // Re-read persisted selection so UI and offscreen contexts cannot retain a
  // previously selected root after another context switches directories.
  directoryHandleCache.set((await loadDirectoryState())?.handle ?? null);
  return directoryHandleCache.get();
}

export function clearCacheDirectoryHandle() {
  directoryHandleCache.clear();
}

export async function getCacheDirectoryInfo() {
  const selected = await loadDirectoryState();
  const handle = selected?.handle;
  if (!handle) return { configured: false, name: "", permission: "prompt" };
  const permission = await handle.queryPermission({ mode: "readwrite" });
  const [legacy, current] = await Promise.all([
    useStore(RECORD_STORE, "readonly", store => store.getAll()),
    useStore(ROOT_RECORD_STORE, "readonly", store => store.getAll())
  ]);
  const verified = new Set(current.filter(record => record.rootId === selected.rootId)
    .flatMap(record => normalizeCacheRecord(record)?.locations.map(location => `${record.trackId}\u0000${JSON.stringify(location.path)}`) ?? []));
  const unassignedCount = legacy.filter(record => normalizeCacheRecord(record)?.locations
    .some(location => !verified.has(`${record.trackId}\u0000${JSON.stringify(location.path)}`))).length;
  return { configured: true, rootId: selected.rootId, name: handle.name, permission, unassignedCount };
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
  return withDirectoryLock("shared", async () => {
    const rootId = (await loadDirectoryState())?.rootId;
    if (!rootId) throw new Error("请先选择缓存目录");
    if (record.rootId && record.rootId !== rootId) throw new Error("缓存目录已改变，请重新执行缓存任务");
    const incoming = { ...record, rootId };
    if (Array.isArray(record.locations)) incoming.locations = record.locations.map(location => ({ ...location, rootId }));
    return updateCacheRecord(rootId, record.trackId, current => mergeCacheLocation(current, incoming));
  });
}

export async function getCacheRecord(trackId) {
  const rootId = (await loadDirectoryState())?.rootId;
  if (!rootId) return null;
  return normalizeCacheRecord(await useStore(ROOT_RECORD_STORE, "readonly", store => store.get(recordKey(rootId, trackId))));
}

export async function listCacheRecords() {
  const rootId = (await loadDirectoryState())?.rootId;
  if (!rootId) return [];
  const values = await useStore(ROOT_RECORD_STORE, "readonly", store => store.getAll());
  return values.filter(value => value.rootId === rootId).map(normalizeCacheRecord).filter(Boolean);
}

export async function deleteCacheRecord(trackId) {
  const rootId = (await loadDirectoryState())?.rootId;
  if (!rootId) return;
  return useStore(ROOT_RECORD_STORE, "readwrite", store => store.delete(recordKey(rootId, trackId)));
}

export async function deleteCacheLocation(trackId, locationId, rootId = null) {
  rootId ??= (await loadDirectoryState())?.rootId;
  if (!rootId) return null;
  return updateCacheRecord(rootId, trackId, current => removeCacheLocation(current, locationId));
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
  return withCacheDirectoryOperation((root, rootId) => deleteCacheFilesInDirectory(targets, root, rootId));
}

async function deleteCacheFilesInDirectory(targets, root, rootId) {
  const unique = new Map((targets ?? []).map(target => [`${target.trackId}\u0000${target.locationId}`, target]));
  const results = [];
  for (const target of unique.values()) {
    if (!target.rootId || target.rootId !== rootId) {
      results.push({ ...target, status: "failed", size: 0, error: "缓存目录已改变或目标未校准，请刷新后重新选择" });
      continue;
    }
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
  return withDirectoryLock("shared", async () => {
    const selected = await loadDirectoryState();
    return findCachedFilesInDirectory(record, options, selected);
  });
}

async function findCachedFilesInDirectory(record, options, selected) {
  const found = [];
  // Preserve the array API used by playback/download while offering callers
  // recoverable diagnostics. Failed access is not evidence of an invalid file.
  Object.defineProperty(found, "accessErrors", { value: [] });
  const root = selected?.handle;
  if (!root) return found;
  const normalized = normalizeCacheRecord(record);
  if (!normalized || !normalized.rootId || normalized.rootId !== selected.rootId) return found;
  const accessError = (error, location = null) => found.accessErrors.push({
    trackId: normalized.trackId, rootId: selected.rootId, location,
    name: error?.name || "Error", message: error?.message || "暂时无法读取缓存文件", recoverable: true
  });
  try {
    if (await root.queryPermission({ mode: "read" }) !== "granted") {
      accessError({ name: "NotAllowedError", message: "缓存目录读取权限已失效，请重新授权" });
      return found;
    }
  } catch (error) {
    accessError(error);
    return found;
  }
  const preferredScopeKey = String(options.preferredScopeKey ?? "");
  const locations = orderedCacheLocations(normalized, preferredScopeKey).filter(location =>
    location.rootId === selected.rootId && locationMatches(location, {
      scopeKey: options.onlyPreferred ? preferredScopeKey : "",
      format: options.format,
      bitrate: options.bitrate
    })
  );
  for (const location of locations) {
    let file;
    try {
      file = await fileAtPath(root, location.path);
    } catch (error) {
      if (isNotFoundError(error)) await deleteCacheLocation(normalized.trackId, location.id, selected.rootId);
      else accessError(error, location);
      continue;
    }
    if (file.size > 0) found.push({ file, location });
    else if (file.size === 0) await deleteCacheLocation(normalized.trackId, location.id, selected.rootId);
    else accessError({ name: "NotReadableError", message: "缓存文件大小暂时不可读" }, location);
  }
  return found;
}

export async function findCachedFile(record, options = {}) {
  return (await findCachedFiles(record, options))[0] ?? null;
}

export async function getCachedFile(record, options = {}) {
  return (await findCachedFile(record, options))?.file ?? null;
}

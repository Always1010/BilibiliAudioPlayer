const DATABASE_NAME = "bili-audio-files";
const DATABASE_VERSION = 1;
const HANDLE_STORE = "handles";
const RECORD_STORE = "records";
const DIRECTORY_KEY = "cache-directory";

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

export async function chooseCacheDirectory() {
  if (!("showDirectoryPicker" in globalThis)) {
    throw new Error("当前浏览器不支持目录授权，请升级 Edge 或 Chrome");
  }
  const handle = await globalThis.showDirectoryPicker({ id: "bili-audio-cache", mode: "readwrite" });
  await useStore(HANDLE_STORE, "readwrite", store => store.put(handle, DIRECTORY_KEY));
  return { name: handle.name, permission: "granted" };
}

export function getCacheDirectoryHandle() {
  return useStore(HANDLE_STORE, "readonly", store => store.get(DIRECTORY_KEY));
}

export async function getCacheDirectoryInfo() {
  const handle = await getCacheDirectoryHandle();
  if (!handle) return { configured: false, name: "", permission: "prompt" };
  const permission = await handle.queryPermission({ mode: "readwrite" });
  return { configured: true, name: handle.name, permission };
}

export async function requireWritableDirectory() {
  const handle = await getCacheDirectoryHandle();
  if (!handle) throw new Error("请先在缓存管理中选择本地目录");
  const permission = await handle.queryPermission({ mode: "readwrite" });
  if (permission !== "granted") throw new Error("缓存目录权限已失效，请在缓存管理中重新授权");
  return handle;
}

export function putCacheRecord(record) {
  return useStore(RECORD_STORE, "readwrite", store => store.put(record));
}

export function getCacheRecord(trackId) {
  return useStore(RECORD_STORE, "readonly", store => store.get(String(trackId)));
}

export function listCacheRecords() {
  return useStore(RECORD_STORE, "readonly", store => store.getAll());
}

export function deleteCacheRecord(trackId) {
  return useStore(RECORD_STORE, "readwrite", store => store.delete(String(trackId)));
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

export async function getCachedFile(record) {
  const root = await getCacheDirectoryHandle();
  if (!root || await root.queryPermission({ mode: "read" }) !== "granted") return null;
  try {
    let directory = root;
    for (const part of record.path.slice(0, -1)) {
      directory = await directory.getDirectoryHandle(part);
    }
    const fileHandle = await directory.getFileHandle(record.path.at(-1));
    return await fileHandle.getFile();
  } catch {
    return null;
  }
}

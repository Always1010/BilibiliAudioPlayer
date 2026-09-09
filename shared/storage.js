import {
  DEFAULT_PLAYER,
  DEFAULT_SETTINGS,
  STORAGE_KEYS,
  cloneDefaultPlayer,
  cloneDefaultSettings
} from "./constants.js";

export async function initializeStorage() {
  const stored = await chrome.storage.local.get(Object.values(STORAGE_KEYS));
  const changes = {};

  if (!Array.isArray(stored[STORAGE_KEYS.creators])) {
    changes[STORAGE_KEYS.creators] = [];
  }
  if (!stored[STORAGE_KEYS.creatorContent]) {
    changes[STORAGE_KEYS.creatorContent] = {};
  }
  if (!stored[STORAGE_KEYS.player]) {
    changes[STORAGE_KEYS.player] = cloneDefaultPlayer();
  }
  if (!stored[STORAGE_KEYS.settings]) {
    changes[STORAGE_KEYS.settings] = cloneDefaultSettings();
  }
  if (!stored[STORAGE_KEYS.updateState]) {
    changes[STORAGE_KEYS.updateState] = {};
  }
  if (!stored[STORAGE_KEYS.subscriptions]) {
    changes[STORAGE_KEYS.subscriptions] = {};
  }
  if (!Array.isArray(stored[STORAGE_KEYS.playlists])) {
    changes[STORAGE_KEYS.playlists] = [];
  }

  if (Object.keys(changes).length) {
    await chrome.storage.local.set(changes);
  }
}

export async function getAppState() {
  const stored = await chrome.storage.local.get(Object.values(STORAGE_KEYS));
  return {
    creators: stored[STORAGE_KEYS.creators] ?? [],
    creatorContent: stored[STORAGE_KEYS.creatorContent] ?? {},
    player: { ...DEFAULT_PLAYER, ...(stored[STORAGE_KEYS.player] ?? {}) },
    settings: { ...DEFAULT_SETTINGS, ...(stored[STORAGE_KEYS.settings] ?? {}) },
    updateState: stored[STORAGE_KEYS.updateState] ?? {},
    subscriptions: stored[STORAGE_KEYS.subscriptions] ?? {},
    playlists: stored[STORAGE_KEYS.playlists] ?? []
  };
}

export async function updateStorageValue(key, updater) {
  const stored = await chrome.storage.local.get(key);
  const current = stored[key];
  const next = await updater(current);
  await chrome.storage.local.set({ [key]: next });
  return next;
}

export async function savePlayerState(patch) {
  return updateStorageValue(STORAGE_KEYS.player, current => ({
    ...DEFAULT_PLAYER,
    ...(current ?? {}),
    ...patch
  }));
}

export async function saveSettings(patch) {
  return updateStorageValue(STORAGE_KEYS.settings, current => ({
    ...DEFAULT_SETTINGS,
    ...(current ?? {}),
    ...patch
  }));
}

import {
  DEFAULT_PLAYER,
  DEFAULT_PLAYER_PROGRESS,
  DEFAULT_SETTINGS,
  STORAGE_KEYS,
  cloneDefaultPlayer,
  cloneDefaultSettings
} from "./constants.js";
import { normalizeFavoriteSections } from "../services/favorite-sections.js";
import {
  normalizePlaybackCheckpoints,
  playbackScopeKey,
  removePlaybackCheckpoint,
  updatePlaybackCheckpoints
} from "../services/playback-checkpoints.js";

function playerSessionState(player) {
  const session = { ...player };
  delete session.currentTime;
  delete session.duration;
  delete session.updatedAt;
  delete session.checkpointCompleted;
  return session;
}

function dormantPlayerPreferences(player) {
  return {
    ...cloneDefaultPlayer(),
    volume: player.volume,
    playbackRate: player.playbackRate,
    mode: player.mode
  };
}

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
  if (!stored[STORAGE_KEYS.playbackProgress]) {
    const previous = stored[STORAGE_KEYS.player] ?? DEFAULT_PLAYER;
    changes[STORAGE_KEYS.playbackProgress] = {
      currentTime: Math.max(0, Number(previous.currentTime) || 0),
      duration: Math.max(0, Number(previous.duration) || 0),
      updatedAt: 0
    };
  }
  const checkpoints = normalizePlaybackCheckpoints(stored[STORAGE_KEYS.playbackCheckpoints]);
  if (JSON.stringify(stored[STORAGE_KEYS.playbackCheckpoints] ?? null) !== JSON.stringify(checkpoints)) {
    changes[STORAGE_KEYS.playbackCheckpoints] = checkpoints;
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
  const favorites = normalizeFavoriteSections(stored[STORAGE_KEYS.favoriteSections]);
  if (!Array.isArray(stored[STORAGE_KEYS.favoriteSections])
    || JSON.stringify(stored[STORAGE_KEYS.favoriteSections]) !== JSON.stringify(favorites)) {
    changes[STORAGE_KEYS.favoriteSections] = favorites;
  }

  if (Object.keys(changes).length) {
    await chrome.storage.local.set(changes);
  }
}

export async function getAppState() {
  const stored = await chrome.storage.local.get(Object.values(STORAGE_KEYS));
  const playerProgress = { ...DEFAULT_PLAYER_PROGRESS, ...(stored[STORAGE_KEYS.playbackProgress] ?? {}) };
  return {
    creators: stored[STORAGE_KEYS.creators] ?? [],
    creatorContent: stored[STORAGE_KEYS.creatorContent] ?? {},
    player: { ...DEFAULT_PLAYER, ...(stored[STORAGE_KEYS.player] ?? {}), ...playerProgress },
    settings: { ...DEFAULT_SETTINGS, ...(stored[STORAGE_KEYS.settings] ?? {}) },
    updateState: stored[STORAGE_KEYS.updateState] ?? {},
    subscriptions: stored[STORAGE_KEYS.subscriptions] ?? {},
    playlists: stored[STORAGE_KEYS.playlists] ?? [],
    favoriteSections: normalizeFavoriteSections(stored[STORAGE_KEYS.favoriteSections]),
    playbackCheckpoints: normalizePlaybackCheckpoints(stored[STORAGE_KEYS.playbackCheckpoints])
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
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.player,
    STORAGE_KEYS.playbackProgress,
    STORAGE_KEYS.playbackCheckpoints,
    STORAGE_KEYS.settings,
    STORAGE_KEYS.playlists
  ]);
  const current = {
    ...DEFAULT_PLAYER,
    ...(stored[STORAGE_KEYS.player] ?? {}),
    ...DEFAULT_PLAYER_PROGRESS,
    ...(stored[STORAGE_KEYS.playbackProgress] ?? {})
  };
  const livePlayer = { ...current, ...patch };
  const rememberProgress = stored[STORAGE_KEYS.settings]?.rememberProgress !== false;
  const player = rememberProgress
    ? playerSessionState(livePlayer)
    : playerSessionState(dormantPlayerPreferences(livePlayer));
  const progress = rememberProgress
    ? {
      currentTime: Math.max(0, Number(livePlayer.currentTime) || 0),
      duration: Math.max(0, Number(livePlayer.duration) || 0),
      updatedAt: Date.now()
    }
    : { ...DEFAULT_PLAYER_PROGRESS };
  let playbackCheckpoints = rememberProgress
    ? updatePlaybackCheckpoints(stored[STORAGE_KEYS.playbackCheckpoints], livePlayer, progress.updatedAt)
    : normalizePlaybackCheckpoints(null);
  const scopeKey = playbackScopeKey(livePlayer.queueContext);
  if (rememberProgress && livePlayer.queueContext?.kind === "playlist" && scopeKey) {
    const playlistExists = (stored[STORAGE_KEYS.playlists] ?? [])
      .some(playlist => String(playlist.id) === String(livePlayer.queueContext.id));
    if (!playlistExists) playbackCheckpoints = removePlaybackCheckpoint(playbackCheckpoints, scopeKey);
  }
  const changes = {};
  if (JSON.stringify(stored[STORAGE_KEYS.player] ?? null) !== JSON.stringify(player)) changes[STORAGE_KEYS.player] = player;
  if (JSON.stringify(stored[STORAGE_KEYS.playbackProgress] ?? null) !== JSON.stringify(progress)) changes[STORAGE_KEYS.playbackProgress] = progress;
  if (JSON.stringify(stored[STORAGE_KEYS.playbackCheckpoints] ?? null) !== JSON.stringify(playbackCheckpoints)) {
    changes[STORAGE_KEYS.playbackCheckpoints] = playbackCheckpoints;
  }
  if (Object.keys(changes).length) await chrome.storage.local.set(changes);
  return { player: { ...livePlayer, updatedAt: progress.updatedAt }, playbackCheckpoints };
}

export async function clearPlaybackHistory() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.player);
  const player = dormantPlayerPreferences({ ...DEFAULT_PLAYER, ...(stored[STORAGE_KEYS.player] ?? {}) });
  await chrome.storage.local.set({
    [STORAGE_KEYS.player]: playerSessionState(player),
    [STORAGE_KEYS.playbackProgress]: { ...DEFAULT_PLAYER_PROGRESS },
    [STORAGE_KEYS.playbackCheckpoints]: normalizePlaybackCheckpoints(null)
  });
}

export async function deletePlaybackCheckpoint(scopeKey) {
  return updateStorageValue(STORAGE_KEYS.playbackCheckpoints, current => removePlaybackCheckpoint(current, scopeKey));
}

export async function saveSettings(patch) {
  return updateStorageValue(STORAGE_KEYS.settings, current => ({
    ...DEFAULT_SETTINGS,
    ...(current ?? {}),
    ...patch
  }));
}

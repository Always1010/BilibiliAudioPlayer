export const STORAGE_KEYS = Object.freeze({
  creators: "creators",
  creatorContent: "creatorContent",
  player: "player",
  settings: "settings",
  updateState: "updateState",
  subscriptions: "subscriptions",
  playlists: "playlists",
  favoriteSections: "favoriteSections"
});

export const DEFAULT_PLAYER = Object.freeze({
  queue: [],
  queueIndex: -1,
  queueContext: null,
  currentTrack: null,
  playing: false,
  currentTime: 0,
  duration: 0,
  loading: false,
  source: null,
  volume: 0.8,
  playbackRate: 1,
  mode: "list"
});

export const DEFAULT_SETTINGS = Object.freeze({
  activeCreatorId: null,
  updateIntervalMinutes: 180,
  defaultSort: "pubdate",
  sectionSortDirection: "asc",
  defaultFormat: "original",
  mp3Bitrate: 192,
  rememberProgress: true,
  checkUpdatesOnStartup: true
});

export const MESSAGE = Object.freeze({
  getAppState: "GET_APP_STATE",
  searchCreators: "SEARCH_CREATORS",
  addCreator: "ADD_CREATOR",
  removeCreator: "REMOVE_CREATOR",
  selectCreator: "SELECT_CREATOR",
  loadCreator: "LOAD_CREATOR",
  loadSection: "LOAD_SECTION",
  openPlayer: "OPEN_PLAYER",
  playerCommand: "PLAYER_COMMAND",
  playerEvent: "PLAYER_EVENT",
  resolveAudio: "RESOLVE_AUDIO",
  cacheCommand: "CACHE_COMMAND",
  cacheEvent: "CACHE_EVENT",
  saveSettings: "SAVE_SETTINGS",
  checkUpdates: "CHECK_UPDATES",
  setSubscription: "SET_SUBSCRIPTION",
  playlistCommand: "PLAYLIST_COMMAND",
  favoriteSectionCommand: "FAVORITE_SECTION_COMMAND"
});

export const UPDATE_ALARM = "bili-audio-update-check";

export function cloneDefaultPlayer() {
  return structuredClone(DEFAULT_PLAYER);
}

export function cloneDefaultSettings() {
  return structuredClone(DEFAULT_SETTINGS);
}

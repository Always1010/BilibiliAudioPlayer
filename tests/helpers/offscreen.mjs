import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { abortablePlayback, throwIfPlaybackAborted, waitForPlaybackEvent } from "../../services/playback-loading.js";
import { normalizePlaybackRate } from "../../services/playback-rate.js";
import { playbackScopeKey } from "../../services/playback-checkpoints.js";
import { MESSAGE, DEFAULT_PLAYER } from "../../shared/constants.js";

export async function createOffscreenHarness(overrides = {}) {
  const pending = new Map();
  class Audio extends EventTarget {
    constructor() { super(); this.paused = true; this.src = ''; this.currentTime = 0; this.duration = 120; this.playbackRate = 1; this.loads = []; }
    pause() { this.paused = true; }
    play() { this.paused = false; return Promise.resolve(); }
    removeAttribute() { this.src = ''; }
    load() { this.playbackRate = 1; this.dispatchEvent(new Event("ratechange")); if (this.src) { this.loads.push(this.src); queueMicrotask(() => this.dispatchEvent(new Event('canplay'))); } }
  }
  const audio = new Audio();
  const urls = [];
  const context = vm.createContext({
    console, AbortController, DOMException, Blob, Event, setTimeout, clearTimeout,
    document: { getElementById: () => audio }, navigator: {},
    AudioContext: class { state = 'running'; destination = {}; createGain() { return { gain: {}, connect() {} }; } createMediaElementSource() { return { connect: () => ({ connect() {} }) }; } },
    URL: { createObjectURL(blob) { const url = `blob:${urls.length}`; urls.push(blob); return url; }, revokeObjectURL() {} },
    fetch: async () => ({ ok: true, body: {}, blob: async () => new Blob(['audio']) }),
    chrome: { runtime: { onMessage: { addListener() {} }, async sendMessage(message) {
      if (message.type === MESSAGE.resolveAudio) return new Promise(resolve => pending.set(message.track.id, resolve));
      return { ok: true };
    } } },
    MESSAGE, DEFAULT_PLAYER, abortablePlayback, throwIfPlaybackAborted, waitForPlaybackEvent,
    normalizePlaybackVolume: v => v, normalizePlaybackRate,
    getCacheRecord: async () => null, scopeKeyFromContext: () => '',
    audioStreamCandidates: stream => [stream.url], mediaErrorText: () => 'error', mediaSourceType: () => '',
    onlinePlaybackSource: () => ({ kind: 'online' }),
    playbackProgressReportPolicy: () => ({ shouldReport: false }),
    insertQueueItems: () => [], removeQueueItem(queue, index, current) { return { queue: queue.filter((_, i) => i !== index), currentIndex: 0, removedCurrent: index === current }; }, reorderQueue: () => ({}),
    PLAYBACK_RESUME_END_THRESHOLD: 5, playbackScopeKey,
    ...overrides,
  });
  let source = await readFile(new URL('../../offscreen/offscreen.js', import.meta.url), 'utf8');
  source = source.replace(/^import\s[\s\S]*?;\r?\n/gm, '');
  vm.runInContext(source, context);
  const run = code => vm.runInContext(code, context);
  const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
  return { audio, pending, run, flush };
}

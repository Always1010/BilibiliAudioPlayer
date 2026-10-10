import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { abortablePlayback, throwIfPlaybackAborted, waitForPlaybackEvent } from '../services/playback-loading.js';
import { MESSAGE, DEFAULT_PLAYER } from '../shared/constants.js';
const pending = new Map();
class Audio extends EventTarget {
  constructor() { super(); this.paused = true; this.src = ''; this.currentTime = 0; this.duration = 120; this.playbackRate = 1; this.loads = []; }
  pause() { this.paused = true; }
  play() { this.paused = false; return Promise.resolve(); }
  removeAttribute() { this.src = ''; }
  load() { if (this.src) { this.loads.push(this.src); queueMicrotask(() => this.dispatchEvent(new Event('canplay'))); } }
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
  normalizePlaybackVolume: v => v, normalizePlaybackRate: v => v,
  getCacheRecord: async () => null, scopeKeyFromContext: () => '',
  audioStreamCandidates: stream => [stream.url], mediaErrorText: () => 'error', mediaSourceType: () => '',
  onlinePlaybackSource: () => ({ kind: 'online' }),
  playbackProgressReportPolicy: () => ({ shouldReport: false }),
  insertQueueItems: () => [], removeQueueItem(queue, index, current) { return { queue: queue.filter((_, i) => i !== index), currentIndex: 0, removedCurrent: index === current }; }, reorderQueue: () => ({}),
  PLAYBACK_RESUME_END_THRESHOLD: 5, playbackScopeKey: () => '',
});
let source = await readFile(new URL('../offscreen/offscreen.js', import.meta.url), 'utf8');
source = source.replace(/^import\s[\s\S]*?;\r?\n/gm, '');
vm.runInContext(source, context);
const run = code => vm.runInContext(code, context);
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const first = run('handleCommand("playQueue", {queue:[{id:"A"},{id:"B"}]})');
await flush();
const second = run('handleCommand("playIndex", {index:1})');
await flush();
pending.get('B')({ ok: true, data: { url: 'https://cdn/B' } });
await second;
pending.get('A')({ ok: true, data: { url: 'https://cdn/A' } });
await first;
assert.equal(run('state.currentTrack.id'), 'B');
assert.equal(audio.loads.length, 1);
assert.equal(audio.paused, false);
const pausedLoad = run('handleCommand("playIndex", {index:0})');
await flush();
await run('handleCommand("pause")');
pending.get('A')({ ok: true, data: { url: 'https://cdn/A' } });
await pausedLoad;
assert.equal(audio.paused, true, 'loading must respect the latest pause');
const clearedLoad = run('handleCommand("playIndex", {index:1})');
await flush();
await run('handleCommand("clearQueue")');
pending.get('B')({ ok: true, data: { url: 'https://cdn/B' } });
await clearedLoad;
assert.equal(audio.src, '');
assert.equal(run('state.currentTrack'), null);
const controller = new AbortController();
const target = new EventTarget();
const waiting = waitForPlaybackEvent(target, 'canplay', controller.signal, () => new Error('bad'));
controller.abort();
await assert.rejects(waiting, { name: 'AbortError' });
console.log('播放加载竞态：反序切歌、加载中暂停、清空和媒体等待取消通过');

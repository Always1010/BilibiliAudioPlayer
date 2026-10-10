export function playbackAbortError() {
  return new DOMException("音频加载已中止", "AbortError");
}

export function throwIfPlaybackAborted(signal) {
  if (signal.aborted) throw playbackAbortError();
}

export function abortablePlayback(promise, signal) {
  throwIfPlaybackAborted(signal);
  return new Promise((resolve, reject) => {
    const aborted = () => reject(playbackAbortError());
    signal.addEventListener("abort", aborted, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener("abort", aborted));
  });
}

export function waitForPlaybackEvent(target, event, signal, failure, timeoutMs = 20000) {
  throwIfPlaybackAborted(signal);
  return new Promise((resolve, reject) => {
    const finish = error => {
      clearTimeout(timer);
      target.removeEventListener(event, ready);
      target.removeEventListener("error", failed);
      signal.removeEventListener("abort", aborted);
      error ? reject(error) : resolve();
    };
    const ready = () => finish();
    const failed = () => finish(failure());
    const aborted = () => finish(playbackAbortError());
    const timer = setTimeout(() => finish(new Error("等待音频媒体事件超时")), timeoutMs);
    target.addEventListener(event, ready, { once: true });
    target.addEventListener("error", failed, { once: true });
    signal.addEventListener("abort", aborted, { once: true });
  });
}

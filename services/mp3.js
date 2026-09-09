const MP3_BITRATES = new Set([128, 192, 320]);
const FRAME_BLOCK_SIZE = 1152 * 16;

export function normalizeMp3Bitrate(value) {
  const bitrate = Number(value);
  return MP3_BITRATES.has(bitrate) ? bitrate : 192;
}

function workerRequest(worker, type, payload = {}, transfer = []) {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const cleanup = () => {
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
    };
    const onMessage = event => {
      if (event.data?.id !== id) return;
      cleanup();
      if (event.data.ok) resolve(event.data);
      else reject(new Error(event.data.error || "MP3 编码失败"));
    };
    const onError = event => {
      cleanup();
      reject(new Error(event.message || "MP3 后台编码器加载失败"));
    };
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
    worker.postMessage({ id, type, ...payload }, transfer);
  });
}

function copyChannelBlock(audioBuffer, channel, offset, frameCount) {
  const output = new Float32Array(frameCount);
  output.set(audioBuffer.getChannelData(channel).subarray(offset, offset + frameCount));
  return output;
}

export async function encodeAudioBufferToMp3(audioBuffer, bitrateValue, onProgress = () => {}) {
  if (!("Worker" in globalThis)) throw new Error("当前浏览器不支持后台 MP3 编码，请升级 Edge 或 Chrome");
  const numberOfChannels = Math.min(2, audioBuffer.numberOfChannels);
  if (!numberOfChannels || !audioBuffer.length) throw new Error("音频解码后没有可转换的声道数据");

  const worker = new Worker(new URL("../offscreen/mp3-worker.js", import.meta.url), { type: "module" });
  const parts = [];
  try {
    await workerRequest(worker, "init", {
      channels: numberOfChannels,
      sampleRate: audioBuffer.sampleRate,
      bitrate: normalizeMp3Bitrate(bitrateValue)
    });

    for (let offset = 0; offset < audioBuffer.length; offset += FRAME_BLOCK_SIZE) {
      const frameCount = Math.min(FRAME_BLOCK_SIZE, audioBuffer.length - offset);
      const left = copyChannelBlock(audioBuffer, 0, offset, frameCount);
      const right = numberOfChannels === 2 ? copyChannelBlock(audioBuffer, 1, offset, frameCount) : null;
      const transfer = right ? [left.buffer, right.buffer] : [left.buffer];
      const result = await workerRequest(worker, "encode", { left, right }, transfer);
      if (result.bytes?.byteLength) parts.push(result.bytes);
      onProgress(Math.min(0.99, (offset + frameCount) / audioBuffer.length));
    }

    const result = await workerRequest(worker, "flush");
    if (result.bytes?.byteLength) parts.push(result.bytes);
  } finally {
    worker.terminate();
  }

  if (!parts.length) throw new Error("MP3 编码器没有生成音频数据");
  onProgress(1);
  return new Blob(parts, { type: "audio/mpeg" });
}

import { Mp3StreamEncoder } from "../services/mp3-core.js";

let encoder = null;

self.addEventListener("message", event => {
  const { id, type } = event.data ?? {};
  try {
    let bytes = null;
    if (type === "init") {
      encoder = new Mp3StreamEncoder(event.data.channels, event.data.sampleRate, event.data.bitrate);
    } else if (type === "encode") {
      if (!encoder) throw new Error("MP3 编码器尚未初始化");
      bytes = encoder.encode(event.data.left, event.data.right);
    } else if (type === "flush") {
      if (!encoder) throw new Error("MP3 编码器尚未初始化");
      bytes = encoder.flush();
      encoder = null;
    } else {
      throw new Error(`未知 MP3 编码命令：${type}`);
    }
    self.postMessage({ id, ok: true, bytes }, bytes?.buffer ? [bytes.buffer] : []);
  } catch (error) {
    self.postMessage({ id, ok: false, error: error.message || String(error) });
  }
});

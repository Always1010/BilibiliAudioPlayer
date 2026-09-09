import assert from "node:assert/strict";
import { normalizeMp3Bitrate } from "../services/mp3.js";
import { float32ToInt16, Mp3StreamEncoder } from "../services/mp3-core.js";

assert.equal(normalizeMp3Bitrate(128), 128);
assert.equal(normalizeMp3Bitrate("320"), 320);
assert.equal(normalizeMp3Bitrate(256), 192);
assert.deepEqual([...float32ToInt16(new Float32Array([-2, -1, -0.5, 0, 0.5, 1, 2]))], [
  -32768, -32768, -16384, 0, 16383, 32767, 32767
]);

const sampleRate = 48000;
const left = new Float32Array(sampleRate);
const right = new Float32Array(sampleRate);
for (let index = 0; index < sampleRate; index += 1) {
  left[index] = Math.sin(2 * Math.PI * 440 * index / sampleRate) * 0.25;
  right[index] = Math.sin(2 * Math.PI * 660 * index / sampleRate) * 0.25;
}

const encoder = new Mp3StreamEncoder(2, sampleRate, 192);
const chunks = [];
for (let offset = 0; offset < sampleRate; offset += 1152 * 16) {
  const encoded = encoder.encode(left.subarray(offset, offset + 1152 * 16), right.subarray(offset, offset + 1152 * 16));
  if (encoded.length) chunks.push(encoded);
}
const tail = encoder.flush();
if (tail.length) chunks.push(tail);
const output = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
let position = 0;
for (const chunk of chunks) {
  output.set(chunk, position);
  position += chunk.length;
}

assert.ok(output.length > 20000, "一秒 192 kbps 音频应产生 MP3 数据");
assert.equal(output[0], 0xff, "MP3 应以 MPEG 音频帧同步字开头");
assert.equal(output[1] & 0xe0, 0xe0, "MP3 MPEG 帧同步位应有效");
console.log(`MP3 编码：码率规范化、PCM 转换与真实 LAME 输出通过（${output.length} bytes）`);

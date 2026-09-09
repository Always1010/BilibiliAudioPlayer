import { Mp3Encoder } from "../vendor/lamejs/lamejs.js";

export function float32ToInt16(samples) {
  const output = new Int16Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    output[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output;
}

export class Mp3StreamEncoder {
  constructor(channels, sampleRate, bitrate) {
    this.channels = channels;
    this.encoder = new Mp3Encoder(channels, sampleRate, bitrate);
  }

  encode(left, right = null) {
    const leftPcm = float32ToInt16(left);
    const rightPcm = this.channels === 2 ? float32ToInt16(right ?? left) : null;
    return this.channels === 2
      ? this.encoder.encodeBuffer(leftPcm, rightPcm)
      : this.encoder.encodeBuffer(leftPcm);
  }

  flush() {
    return this.encoder.flush();
  }
}

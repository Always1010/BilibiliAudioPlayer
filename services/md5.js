// Small UTF-8 MD5 implementation used only for Bilibili's WBI request signature.
export function md5(input) {
  const bytes = new TextEncoder().encode(input);
  const originalLength = bytes.length;
  const paddedLength = (((originalLength + 8) >>> 6) + 1) * 64;
  const buffer = new Uint8Array(paddedLength);
  buffer.set(bytes);
  buffer[originalLength] = 0x80;

  const bitLength = BigInt(originalLength) * 8n;
  for (let index = 0; index < 8; index += 1) {
    buffer[paddedLength - 8 + index] = Number((bitLength >> BigInt(index * 8)) & 0xffn);
  }

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;
  const shifts = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
  ];
  const constants = Array.from({ length: 64 }, (_, index) =>
    Math.floor(Math.abs(Math.sin(index + 1)) * 2 ** 32) >>> 0
  );

  for (let offset = 0; offset < paddedLength; offset += 64) {
    const words = new Uint32Array(16);
    for (let index = 0; index < 16; index += 1) {
      const start = offset + index * 4;
      words[index] = (
        buffer[start] |
        (buffer[start + 1] << 8) |
        (buffer[start + 2] << 16) |
        (buffer[start + 3] << 24)
      ) >>> 0;
    }

    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;

    for (let index = 0; index < 64; index += 1) {
      let f;
      let wordIndex;
      if (index < 16) {
        f = (b & c) | (~b & d);
        wordIndex = index;
      } else if (index < 32) {
        f = (d & b) | (~d & c);
        wordIndex = (5 * index + 1) % 16;
      } else if (index < 48) {
        f = b ^ c ^ d;
        wordIndex = (3 * index + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        wordIndex = (7 * index) % 16;
      }

      const sum = (a + f + constants[index] + words[wordIndex]) >>> 0;
      const rotated = ((sum << shifts[index]) | (sum >>> (32 - shifts[index]))) >>> 0;
      [a, d, c, b] = [d, c, b, (b + rotated) >>> 0];
    }

    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  return [a0, b0, c0, d0]
    .flatMap(word => [0, 8, 16, 24].map(shift => (word >>> shift) & 0xff))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

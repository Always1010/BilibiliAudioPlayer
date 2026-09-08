import assert from "node:assert/strict";
import { md5 } from "../services/md5.js";

const vectors = [
  ["", "d41d8cd98f00b204e9800998ecf8427e"],
  ["abc", "900150983cd24fb0d6963f7d28e17f72"],
  ["message digest", "f96b697d7cb7938d525a2f31aaf161d0"],
  ["哔哩音频", "4e22bd80f53f49136427c6e37e8ec08a"]
];

for (const [input, expected] of vectors) {
  assert.equal(md5(input), expected, `MD5 vector failed for ${JSON.stringify(input)}`);
}

console.log(`MD5: ${vectors.length} vectors passed`);

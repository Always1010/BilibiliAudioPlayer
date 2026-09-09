import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(resolve(root, "manifest.json"), "utf8"));
const sizes = [16, 32, 48, 128];
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

for (const size of sizes) {
  const expectedPath = `icons/icon${size}.png`;
  assert.equal(manifest.icons?.[size], expectedPath, `manifest.icons.${size} 应指向对应图标`);
  assert.equal(manifest.action?.default_icon?.[size], expectedPath, `action.default_icon.${size} 应指向对应图标`);

  const image = readFileSync(resolve(root, expectedPath));
  assert.deepEqual(image.subarray(0, 8), pngSignature, `${expectedPath} 应为 PNG 文件`);
  assert.equal(image.readUInt32BE(16), size, `${expectedPath} 宽度应为 ${size}`);
  assert.equal(image.readUInt32BE(20), size, `${expectedPath} 高度应为 ${size}`);
}

console.log("Manifest icons: passed");

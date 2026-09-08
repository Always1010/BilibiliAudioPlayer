import { md5 } from "./md5.js";

const MIXIN_KEY_ORDER = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52
];

let cachedKey = null;
let cachedAt = 0;

function filenameWithoutExtension(url) {
  return url.slice(url.lastIndexOf("/") + 1, url.lastIndexOf("."));
}

async function getMixinKey() {
  if (cachedKey && Date.now() - cachedAt < 6 * 60 * 60 * 1000) {
    return cachedKey;
  }

  const response = await fetch("https://api.bilibili.com/x/web-interface/nav", {
    credentials: "include"
  });
  if (!response.ok) throw new Error(`获取 WBI 密钥失败（HTTP ${response.status}）`);
  const payload = await response.json();
  const image = payload?.data?.wbi_img;
  if (!image?.img_url || !image?.sub_url) throw new Error("哔哩哔哩未返回 WBI 密钥");

  const raw = `${filenameWithoutExtension(image.img_url)}${filenameWithoutExtension(image.sub_url)}`;
  cachedKey = MIXIN_KEY_ORDER.map(index => raw[index]).join("").slice(0, 32);
  cachedAt = Date.now();
  return cachedKey;
}

export async function signWbiParams(params) {
  const mixinKey = await getMixinKey();
  const signed = { ...params, wts: Math.floor(Date.now() / 1000) };
  const query = Object.keys(signed)
    .sort()
    .map(key => {
      const value = String(signed[key] ?? "").replace(/[!'()*]/g, "");
      return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
    })
    .join("&");
  return `${query}&w_rid=${md5(query + mixinKey)}`;
}

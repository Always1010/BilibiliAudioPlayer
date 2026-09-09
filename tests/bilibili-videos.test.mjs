import assert from "node:assert/strict";
import { listCreatorVideos } from "../services/bilibili.js";

const originalFetch = globalThis.fetch;
const requestedUrls = [];

globalThis.fetch = async input => {
  const url = new URL(input);
  if (url.pathname === "/x/web-interface/nav") {
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          code: 0,
          data: {
            wbi_img: {
              img_url: "https://i0.hdslb.com/bfs/wbi/abcdefghijklmnopqrstuvwxyz0123456789.png",
              sub_url: "https://i0.hdslb.com/bfs/wbi/9876543210abcdefghijklmnopqrstuvwxyz.png"
            }
          }
        };
      }
    };
  }

  requestedUrls.push(url);
  const page = Number(url.searchParams.get("pn"));
  const pageSize = Number(url.searchParams.get("ps"));
  return {
    ok: true,
    status: 200,
    async json() {
      return {
        code: 0,
        data: {
          list: { vlist: [{ aid: page, bvid: `BV${page}`, title: `第 ${page} 页`, length: page === 2 ? "01:23" : "00:01" }] },
          page: { count: 120 }
        }
      };
    }
  };
};

try {
  const first = await listCreatorVideos("1", 0, 100);
  const second = await listCreatorVideos("1", 2, 100);

  assert.equal(requestedUrls[0].searchParams.get("pn"), "1");
  assert.equal(requestedUrls[0].searchParams.get("ps"), "50");
  assert.equal(requestedUrls[1].searchParams.get("pn"), "2");
  assert.equal(requestedUrls[1].searchParams.get("ps"), "50");
  assert.equal(first.page, 1);
  assert.equal(first.pageSize, 50);
  assert.equal(second.page, 2);
  assert.equal(second.items[0].title, "第 2 页");
  assert.equal(second.items[0].duration, 83);
  assert.equal(second.total, 120);
  console.log("全部作品分页：单页上限与后续页参数通过");
} finally {
  globalThis.fetch = originalFetch;
}

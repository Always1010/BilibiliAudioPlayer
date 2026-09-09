import assert from "node:assert/strict";
import { searchCreators } from "../services/bilibili.js";

const originalFetch = globalThis.fetch;
const requested = [];

globalThis.fetch = async (input, options = {}) => {
  const url = new URL(input);
  requested.push({ url, options });
  assert.equal(options.referrer, "https://search.bilibili.com/");
  assert.equal(options.referrerPolicy, "strict-origin-when-cross-origin");

  const keyword = url.searchParams.get("keyword");
  const result = keyword === "小Lin说"
    ? [
      { mid: 1, uname: "小Lin说世界", upic: "", fans: 20 },
      { mid: 520819684, uname: "小Lin说", upic: "", fans: 7409100 }
    ]
    : [];

  return {
    ok: true,
    status: 200,
    async json() {
      return { code: 0, message: "OK", data: { result } };
    }
  };
};

try {
  for (const keyword of ["小Lin说", "小\u200BLin说", "＠小Ｌｉｎ说"]) {
    const creators = await searchCreators(keyword);
    assert.equal(creators[0]?.id, "520819684");
    assert.equal(creators[0]?.name, "小Lin说");
  }

  assert.deepEqual(
    requested.map(item => item.url.searchParams.get("keyword")),
    ["小Lin说", "小Lin说", "小Lin说"]
  );
  console.log("UP 主名称搜索：请求来源、输入规范化和精确匹配排序通过");
} finally {
  globalThis.fetch = originalFetch;
}

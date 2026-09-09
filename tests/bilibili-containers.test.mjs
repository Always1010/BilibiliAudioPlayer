import assert from "node:assert/strict";
import {
  listAllCreatorContainers,
  listCreatorContainers
} from "../services/bilibili.js";

const requestedUrls = [];
const originalFetch = globalThis.fetch;

function season(id) {
  return {
    meta: {
      season_id: id,
      title: `合集 ${id}`,
      total: 1,
      cover: "",
      description: "",
      ptime: 0
    },
    archives: []
  };
}

function series(id) {
  return {
    meta: {
      series_id: id,
      name: `系列 ${id}`,
      total: 1,
      cover: "",
      description: "",
      last_update_ts: 0
    },
    archives: []
  };
}

globalThis.fetch = async input => {
  const url = new URL(input);
  requestedUrls.push(url);
  const page = Number(url.searchParams.get("page_num"));
  const pageSize = Number(url.searchParams.get("page_size"));

  let seasons = [];
  let seriesItems = [];
  let total = 0;
  if (pageSize === 2) {
    total = 3;
    if (page === 1) seasons = [season(101), season(102)];
    if (page === 2) seriesItems = [series(201)];
  }

  return {
    ok: true,
    status: 200,
    async json() {
      return {
        code: 0,
        message: "OK",
        data: {
          items_lists: {
            page: { page_num: page, page_size: pageSize, total },
            seasons_list: seasons,
            series_list: seriesItems
          }
        }
      };
    }
  };
};

try {
  await listCreatorContainers("1", 1, 30);
  assert.equal(requestedUrls.at(-1).searchParams.get("page_size"), "20", "page_size 应限制为 20");

  const result = await listAllCreatorContainers("1", 2);
  assert.deepEqual(result.seasons.map(item => item.id), ["101", "102"]);
  assert.deepEqual(result.series.map(item => item.id), ["201"]);
  assert.equal(result.total, 3);

  const pagedRequests = requestedUrls.filter(url => url.searchParams.get("page_size") === "2");
  assert.deepEqual(pagedRequests.map(url => url.searchParams.get("page_num")), ["1", "2"]);
  console.log("合集与系列分页：限制单页数量并完整合并通过");
} finally {
  globalThis.fetch = originalFetch;
}

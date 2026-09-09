import assert from "node:assert/strict";
import { favoriteSectionMetadata } from "../services/favorite-section-metadata.js";

const favorites = [
  { key: "9:season:101", creatorId: "9", type: "season", sectionId: "101", title: "旧合集" },
  { key: "9:series:201", creatorId: "9", type: "series", sectionId: "201", title: "旧系列" },
  { key: "8:season:102", creatorId: "8", type: "season", sectionId: "102", title: "离线合集" }
];
const metadata = favoriteSectionMetadata(favorites, {
  9: {
    seasons: [{ id: "101", type: "season", title: "在线合集", total: 18, cover: "https://example.com/season.jpg" }],
    series: [{ id: "201", type: "series", title: "在线系列", total: 6, cover: "https://example.com/series.jpg" }]
  }
});

assert.deepEqual(metadata, [
  { key: "9:season:101", title: "在线合集", total: 18, cover: "https://example.com/season.jpg", available: true },
  { key: "9:series:201", title: "在线系列", total: 6, cover: "https://example.com/series.jpg", available: true },
  { key: "8:season:102", title: "离线合集", total: null, cover: "", available: false }
]);

console.log("收藏栏目元信息：在线封面、作品数与离线回退通过");

import assert from "node:assert/strict";
import {
  addFavoriteSection,
  favoriteSectionKey,
  isFavoriteSection,
  normalizeFavoriteSection,
  normalizeFavoriteSections,
  removeFavoriteSection
} from "../services/favorite-sections.js";

const source = {
  id: 101,
  type: "season",
  title: " 通勤节目 ",
  total: 12,
  creator: { id: 9, name: "测试UP主" },
  cover: "https://example.com/cover.jpg"
};
const normalized = normalizeFavoriteSection(source, 1000);
assert.deepEqual(normalized, {
  key: "9:season:101",
  creatorId: "9",
  creatorName: "测试UP主",
  type: "season",
  sectionId: "101",
  title: "通勤节目",
  addedAt: 1000
});
assert.equal("cover" in normalized, false);
assert.equal("total" in normalized, false);
assert.equal(favoriteSectionKey({ creatorId: 9, type: "season", sectionId: 101 }), "9:season:101");
assert.equal(normalizeFavoriteSection({ ...source, type: "all" }), null);

let favorites = addFavoriteSection([], source, 1000);
favorites = addFavoriteSection(favorites, { ...source, title: "更新后的节目", total: 13 }, 2000);
assert.equal(favorites.length, 1);
assert.equal(favorites[0].title, "更新后的节目");
assert.equal(favorites[0].addedAt, 1000);
assert.equal("total" in favorites[0], false);
assert.equal(isFavoriteSection(favorites, source), true);
assert.deepEqual(removeFavoriteSection(favorites, "9:season:101"), []);
assert.deepEqual(normalizeFavoriteSections([{ ...source, addedAt: 1 }, { ...source, addedAt: 2 }, { type: "all" }]).map(item => item.key), ["9:season:101"]);

console.log("收藏栏目：最小数据、去重、更新与移除通过");

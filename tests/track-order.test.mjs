import assert from "node:assert/strict";
import {
  normalizeTrackSortDirection,
  sortTracksByPublishedAt
} from "../services/track-order.js";

const tracks = [
  { id: "old", publishedAt: 100 },
  { id: "missing", publishedAt: 0 },
  { id: "new", publishedAt: 300 },
  { id: "same", publishedAt: 100 }
];

assert.equal(normalizeTrackSortDirection("desc"), "desc");
assert.equal(normalizeTrackSortDirection("invalid"), "asc");
assert.deepEqual(sortTracksByPublishedAt(tracks, "asc").map(track => track.id), ["missing", "old", "same", "new"]);
assert.deepEqual(sortTracksByPublishedAt(tracks, "desc").map(track => track.id), ["new", "old", "same", "missing"]);
assert.deepEqual(sortTracksByPublishedAt(null), []);

console.log("作品时间排序：正序、倒序、缺失时间和稳定排序通过");

export const TRACK_SORT_DIRECTIONS = Object.freeze(["asc", "desc"]);

export function normalizeTrackSortDirection(value) {
  return value === "desc" ? "desc" : "asc";
}

export function sortTracksByPublishedAt(tracks, direction = "asc") {
  const normalizedDirection = normalizeTrackSortDirection(direction);
  return (Array.isArray(tracks) ? tracks : [])
    .map((track, index) => ({ track, index }))
    .sort((left, right) => {
      const leftTime = Number(left.track?.publishedAt) || 0;
      const rightTime = Number(right.track?.publishedAt) || 0;
      if (leftTime === rightTime) return left.index - right.index;
      return normalizedDirection === "desc" ? rightTime - leftTime : leftTime - rightTime;
    })
    .map(item => item.track);
}

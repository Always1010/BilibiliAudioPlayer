export function normalizeTrackSearchKeyword(value = "") {
  return String(value)
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("zh-CN");
}

export function filterTracksByKeyword(tracks, keyword) {
  const terms = normalizeTrackSearchKeyword(keyword).split(/\s+/).filter(Boolean);
  if (!terms.length) return tracks ?? [];
  return (tracks ?? []).filter(track => {
    const searchable = normalizeTrackSearchKeyword([
      track?.title,
      track?.bvid,
      track?.description
    ].filter(Boolean).join(" "));
    return terms.every(term => searchable.includes(term));
  });
}

function trackKey(track) {
  return String(track?.id ?? track?.bvid ?? "");
}

export async function loadAllSectionPages(loadPage, { pageSize, onProgress } = {}) {
  let safePageSize = Math.max(1, Number(pageSize) || 1);
  const items = [];
  const known = new Set();
  let page = 1;
  let total = 0;

  while (true) {
    const listing = await loadPage(page, safePageSize);
    // 全部作品接口会将请求的 100 条限制为 50 条，后续分页和短页判断采用实际值。
    const actualPageSize = Number(listing?.pageSize);
    if (Number.isFinite(actualPageSize) && actualPageSize > 0) safePageSize = actualPageSize;
    const received = Array.isArray(listing?.items) ? listing.items : [];
    total = Math.max(total, Number(listing?.total) || 0);
    const additions = received.filter(track => {
      const key = trackKey(track);
      if (!key || known.has(key)) return false;
      known.add(key);
      return true;
    });
    items.push(...additions);
    if (!total) total = items.length;
    onProgress?.({ page, total, items: [...items] });

    if (items.length >= total) return { items, total, page };
    if (!received.length || !additions.length || received.length < safePageSize) {
      throw new Error(`栏目作品未完整返回（已读取 ${items.length} / ${total}）`);
    }
    page += 1;
  }
}

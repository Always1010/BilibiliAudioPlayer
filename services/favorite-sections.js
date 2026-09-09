const FAVORITE_TYPES = new Set(["season", "series"]);

function text(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function timestamp(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

export function favoriteSectionKey({ creatorId, type, sectionId }) {
  return `${text(creatorId)}:${text(type)}:${text(sectionId)}`;
}

export function normalizeFavoriteSection(section, now = Date.now()) {
  const creatorId = text(section?.creatorId ?? section?.creator?.id);
  const type = text(section?.type);
  const sectionId = text(section?.sectionId ?? section?.id);
  const title = text(section?.title);
  if (!creatorId || !sectionId || !title || !FAVORITE_TYPES.has(type)) return null;
  return {
    key: favoriteSectionKey({ creatorId, type, sectionId }),
    creatorId,
    creatorName: text(section?.creatorName ?? section?.creator?.name, "未知UP主"),
    type,
    sectionId,
    title,
    total: Math.max(0, Number(section?.total) || 0),
    addedAt: timestamp(section?.addedAt, now)
  };
}

export function normalizeFavoriteSections(value) {
  if (!Array.isArray(value)) return [];
  const known = new Set();
  return value.flatMap((section, index) => {
    const normalized = normalizeFavoriteSection(section, Date.now() + index);
    if (!normalized || known.has(normalized.key)) return [];
    known.add(normalized.key);
    return [normalized];
  });
}

export function addFavoriteSection(favorites, section, now = Date.now()) {
  const added = normalizeFavoriteSection(section, now);
  if (!added) throw new Error("只能收藏具有 UP 主信息的合集或系列");
  const current = normalizeFavoriteSections(favorites);
  const existing = current.find(item => item.key === added.key);
  if (!existing) return [...current, added];
  return current.map(item => item.key === added.key ? { ...added, addedAt: item.addedAt } : item);
}

export function removeFavoriteSection(favorites, key) {
  const current = normalizeFavoriteSections(favorites);
  return current.filter(item => item.key !== String(key));
}

export function isFavoriteSection(favorites, section) {
  const normalized = normalizeFavoriteSection(section, 1);
  return Boolean(normalized && normalizeFavoriteSections(favorites).some(item => item.key === normalized.key));
}

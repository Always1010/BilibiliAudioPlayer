function text(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function containerKey(creatorId, type, sectionId) {
  return `${text(creatorId)}:${text(type)}:${text(sectionId)}`;
}

export function favoriteSectionMetadata(favorites, containersByCreator = {}) {
  const containers = new Map();
  Object.entries(containersByCreator).forEach(([creatorId, groups]) => {
    [...(groups?.seasons ?? []), ...(groups?.series ?? [])].forEach(section => {
      containers.set(containerKey(creatorId, section.type, section.id), section);
    });
  });
  return (favorites ?? []).map(favorite => {
    const section = containers.get(containerKey(favorite.creatorId, favorite.type, favorite.sectionId));
    return {
      key: favorite.key,
      title: text(section?.title, favorite.title),
      total: section ? Math.max(0, Number(section.total) || 0) : null,
      cover: text(section?.cover),
      available: Boolean(section)
    };
  });
}

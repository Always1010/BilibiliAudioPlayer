function validIndex(queue, index) {
  const value = Number(index);
  return Number.isInteger(value) && value >= 0 && value < queue.length;
}

export function reorderQueue(queue, fromIndex, toIndex, currentIndex) {
  const items = [...(queue ?? [])];
  if (!validIndex(items, fromIndex) || !validIndex(items, toIndex) || fromIndex === toIndex) {
    return { queue: items, currentIndex };
  }
  const current = items[currentIndex] ?? null;
  const [moved] = items.splice(fromIndex, 1);
  items.splice(toIndex, 0, moved);
  return {
    queue: items,
    currentIndex: current ? items.indexOf(current) : -1
  };
}

export function removeQueueItem(queue, removeIndex, currentIndex) {
  const items = [...(queue ?? [])];
  if (!validIndex(items, removeIndex)) {
    return { queue: items, currentIndex, removedCurrent: false };
  }
  const removedCurrent = removeIndex === currentIndex;
  items.splice(removeIndex, 1);
  if (!items.length) return { queue: [], currentIndex: -1, removedCurrent };
  if (removedCurrent) {
    return { queue: items, currentIndex: Math.min(removeIndex, items.length - 1), removedCurrent: true };
  }
  return {
    queue: items,
    currentIndex: removeIndex < currentIndex ? currentIndex - 1 : currentIndex,
    removedCurrent: false
  };
}

export function insertQueueItems(queue, tracks, currentIndex, playNext = false) {
  const items = [...(queue ?? [])];
  const additions = (tracks ?? []).filter(Boolean);
  const insertionIndex = playNext && currentIndex >= 0 ? currentIndex + 1 : items.length;
  items.splice(insertionIndex, 0, ...additions);
  return items;
}

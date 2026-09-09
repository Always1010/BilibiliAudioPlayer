function trackSnapshot(track) {
  if (!track) return null;
  return [
    String(track.id ?? track.bvid ?? ""),
    track.title ?? "",
    Number(track.duration) || 0,
    track.cover ?? "",
    track.creator?.name ?? ""
  ];
}

function sourceSnapshot(source) {
  if (!source) return null;
  return [source.kind ?? "", source.format ?? "", Number(source.bitrate) || 0, source.archiveTitle ?? ""];
}

export function playerStructureKey(player = {}, { queueOpen = false } = {}) {
  return JSON.stringify({
    queueOpen: Boolean(queueOpen),
    queueIndex: Number(player.queueIndex ?? -1),
    queueTitle: player.queueContext?.title ?? "",
    queue: (player.queue ?? []).map(trackSnapshot),
    currentTrack: trackSnapshot(player.currentTrack),
    playing: Boolean(player.playing),
    loading: Boolean(player.loading),
    source: sourceSnapshot(player.source),
    mode: player.mode ?? "list",
    error: player.error ?? ""
  });
}

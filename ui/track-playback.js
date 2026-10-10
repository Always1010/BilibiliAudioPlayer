export function updateTrackPlayback(scope, player = {}) {
  const currentId = String(player.currentTrack?.id ?? "");
  scope.querySelectorAll(".track-row[data-track-id]").forEach(row => {
    const current = Boolean(currentId) && row.dataset.trackId === currentId;
    const playing = current && Boolean(player.playing);
    row.classList.toggle("playing", current);

    const index = row.querySelector(".track-index");
    const indexText = playing ? "♫" : row.dataset.trackNumber;
    if (index && index.textContent !== indexText) index.textContent = indexText;

    const icon = row.querySelector('[data-action="play-track"] .symbol');
    const iconText = playing ? "Ⅱ" : "▶";
    if (icon && icon.textContent !== iconText) icon.textContent = iconText;
  });
}

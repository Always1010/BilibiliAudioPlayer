export function updateTrackPlayback(scope, player = {}) {
  const currentId = String(player.currentTrack?.id ?? "");
  scope.querySelectorAll(".track-row[data-track-id]").forEach(row => {
    const current = Boolean(currentId) && row.dataset.trackId === currentId;
    const playing = current && Boolean(player.playing);
    row.classList.toggle("playing", current);

    const index = row.querySelector(".track-index");
    const indexText = playing ? "♫" : row.dataset.trackNumber;
    if (index && index.textContent !== indexText) index.textContent = indexText;

    const button = row.querySelector('[data-action="play-track"]');
    const title = row.dataset.trackTitle || "当前作品";
    const label = `${current ? playing ? "暂停" : "继续播放" : "播放"} ${title}`;
    button?.setAttribute("aria-label", label);
    button?.setAttribute("title", label);
    const icon = button?.querySelector(".symbol");
    const iconText = playing ? "Ⅱ" : "▶";
    if (icon && icon.textContent !== iconText) icon.textContent = iconText;
  });
}

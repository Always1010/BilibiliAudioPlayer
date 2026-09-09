import { MESSAGE } from "../shared/constants.js";
import { formatDate, formatDuration, toErrorMessage } from "../shared/utils.js";
import { chooseCacheDirectory } from "../services/file-store.js";
import { filterTracksByKeyword } from "../services/track-search.js";
import { playbackSourceLabel } from "../services/playback-source.js";
import { playlistItemToTrack } from "../services/playlists.js";

const root = document.getElementById("app");
const isSidePanel = document.documentElement.dataset.layout === "sidepanel";

const ui = {
  app: null,
  view: "creator",
  activeContent: null,
  activeSection: null,
  detailData: null,
  detailPage: 1,
  trackSearchKeyword: "",
  queueOpen: false,
  activePlaylistId: null,
  playlistPicker: null,
  expanded: new Set(["all"]),
  searchResults: [],
  searchKeyword: "",
  searching: false,
  loading: false,
  error: "",
  notice: "",
  cacheInfo: null,
  cacheActivity: null
};

function symbol(value, className = "") {
  return `<span class="symbol ${className}" aria-hidden="true">${value}</span>`;
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function image(url, alt, className) {
  return url
    ? `<img class="${className}" src="${escapeHtml(url)}" alt="${escapeHtml(alt)}">`
    : `<span class="${className} avatar-fallback">${escapeHtml(String(alt || "音").slice(0, 1))}</span>`;
}

async function send(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({ type, target: "background", ...payload });
  if (!response?.ok) {
    const error = new Error(response?.error || "扩展后台没有响应");
    error.code = response?.code;
    throw error;
  }
  return response.data;
}

function activeCreator() {
  const id = ui.app?.settings?.activeCreatorId;
  return ui.app?.creators?.find(creator => String(creator.id) === String(id)) ?? ui.app?.creators?.[0] ?? null;
}

function creatorNav() {
  const active = activeCreator();
  return (ui.app?.creators ?? []).map(creator => {
    const update = ui.app.updateState?.[creator.id];
    return `<button class="creator-button ${String(active?.id) === String(creator.id) ? "active" : ""}" type="button" data-action="select-creator" data-id="${escapeHtml(creator.id)}">
      ${image(creator.avatar, creator.name, "creator-avatar")}
      <span class="creator-copy"><span class="creator-name">${escapeHtml(creator.name)}</span><span class="creator-meta">${update?.newCount ? `${update.newCount} 个新作品` : "已关注"}</span></span>
      ${update?.newCount ? '<span class="update-dot" aria-label="有新作品"></span>' : ""}
    </button>`;
  }).join("");
}

function cacheWorkCount() {
  const info = ui.cacheInfo;
  return Number(info?.queued ?? 0) + (info?.current ? 1 : 0);
}

function topbar() {
  const loggedIn = Boolean(ui.activeContent?.login?.isLoggedIn);
  return `<header class="topbar">
    <div class="brand"><span class="brand-mark"><img src="icons/icon32.png" alt=""></span><span class="brand-name">哔哩音频</span></div>
    <form class="search-form" data-form="search">
      <input class="search-input" name="keyword" autocomplete="off" placeholder="搜索 UP 主名称或 UID" value="${escapeHtml(ui.searchKeyword)}" aria-label="搜索 UP 主">
      <button class="search-submit" type="submit" aria-label="搜索">${ui.searching ? symbol("◌", "spinner") : symbol("⌕")}</button>
      ${searchResults()}
    </form>
    <div class="top-actions">
      ${ui.activeContent ? `<span class="login-state">${loggedIn ? "● 已登录" : "○ 未登录"}</span>` : ""}
      ${isSidePanel ? `<button class="icon-button" type="button" data-action="open-full" aria-label="打开完整播放器">${symbol("↗")}</button>` : ""}
      <button class="icon-button" type="button" data-action="show-settings" aria-label="设置">${symbol("⚙")}</button>
    </div>
  </header>`;
}

function searchResults() {
  if (!ui.searchResults.length && !ui.searching && !ui.searchKeyword) return "";
  if (ui.searching) return '<div class="search-results"><div class="search-result muted">正在搜索……</div></div>';
  if (!ui.searchResults.length) return '<div class="search-results"><div class="search-result muted">没有找到匹配的 UP 主</div></div>';
  const followed = new Set((ui.app?.creators ?? []).map(item => String(item.id)));
  return `<div class="search-results">${ui.searchResults.map(creator => `
    <div class="search-result">
      ${image(creator.avatar, creator.name, "creator-avatar")}
      <div><div class="search-result-title">${escapeHtml(creator.name)}</div><div class="search-result-meta">UID ${escapeHtml(creator.id)}${creator.fans ? ` · ${creator.fans.toLocaleString("zh-CN")} 粉丝` : ""}</div></div>
      <button class="plain-button" type="button" data-action="add-creator" data-id="${escapeHtml(creator.id)}" ${followed.has(String(creator.id)) ? "disabled" : ""}>${followed.has(String(creator.id)) ? "已添加" : "添加"}</button>
    </div>`).join("")}</div>`;
}

function sidebar() {
  const workCount = cacheWorkCount();
  return `<aside class="sidebar" aria-label="主导航">
    <button class="nav-button ${ui.view === "creator" || ui.view === "detail" ? "active" : ""}" type="button" data-action="show-creator">${symbol("⌂")}UP 主主页</button>
    <button class="nav-button ${ui.view === "playlists" ? "active" : ""}" type="button" data-action="show-playlists">${symbol("☷")}我的播放列表<span class="nav-badge subtle">${ui.app?.playlists?.length ?? 0}</span></button>
    <button class="nav-button ${ui.view === "downloads" ? "active" : ""}" type="button" data-action="show-downloads">${symbol("⇩")}缓存管理${workCount ? `<span class="nav-badge" aria-label="${workCount} 个缓存任务">${workCount}</span>` : ""}</button>
    <div class="sidebar-label">关注的 UP 主</div>
    ${creatorNav()}
  </aside>`;
}

function trackWithContext(track, section) {
  const creator = activeCreator();
  return {
    ...track,
    creator: creator ? { id: creator.id, name: creator.name } : null,
    sectionTitle: section.title
  };
}

function trackRows(items, section, limit = null) {
  const visible = limit ? items.slice(0, limit) : items;
  const currentId = ui.app?.player?.currentTrack?.id;
  const cached = new Set((ui.cacheInfo?.records ?? []).map(record => String(record.trackId)));
  return visible.map((track, index) => `<div class="track-row ${track.id === currentId ? "playing" : ""}">
    <span class="track-index">${track.id === currentId && ui.app.player.playing ? "♫" : String(index + 1).padStart(2, "0")}</span>
    <div><div class="track-title">${escapeHtml(track.title)}</div><div class="track-subtitle">${track.bvid ? escapeHtml(track.bvid) : "视频作品"}${track.publishedAt ? ` · ${formatDate(track.publishedAt)}` : ""}</div></div>
    <span class="track-duration">${formatDuration(track.duration)}</span>
    <div class="track-actions"><button class="icon-button" type="button" data-action="play-track" data-track-id="${escapeHtml(track.id)}" data-section-key="${escapeHtml(section.key)}" aria-label="播放 ${escapeHtml(track.title)}">${symbol(track.id === currentId && ui.app.player.playing ? "Ⅱ" : "▶")}</button><button class="icon-button" type="button" data-action="enqueue-track" data-track-id="${escapeHtml(track.id)}" data-section-key="${escapeHtml(section.key)}" aria-label="将 ${escapeHtml(track.title)} 添加到播放队列">${symbol("+")}</button><button class="icon-button" type="button" data-action="add-track-to-playlist" data-track-id="${escapeHtml(track.id)}" data-section-key="${escapeHtml(section.key)}" aria-label="将 ${escapeHtml(track.title)} 添加到我的播放列表">${symbol("☆")}</button><button class="icon-button ${cached.has(String(track.id)) ? "cached" : ""}" type="button" data-action="cache-track" data-track-id="${escapeHtml(track.id)}" data-section-key="${escapeHtml(section.key)}" aria-label="${cached.has(String(track.id)) ? "已缓存" : "缓存"} ${escapeHtml(track.title)}">${symbol(cached.has(String(track.id)) ? "✓" : "⇩")}</button></div>
  </div>`).join("");
}

function normalizedSections() {
  if (!ui.activeContent) return [];
  const all = {
    key: "all",
    id: "all",
    type: "all",
    title: "全部作品",
    total: ui.activeContent.all?.total ?? 0,
    items: ui.activeContent.all?.items ?? [],
    description: "该 UP 主的全部公开视频投稿"
  };
  const seasons = (ui.activeContent.containers?.seasons ?? []).map(item => ({ ...item, key: `season:${item.id}`, items: item.preview ?? [] }));
  const series = (ui.activeContent.containers?.series ?? []).map(item => ({ ...item, key: `series:${item.id}`, items: item.preview ?? [] }));
  return [all, ...seasons, ...series];
}

function findSection(key) {
  return normalizedSections().find(section => section.key === key) ?? ui.activeSection;
}

function sectionCard(section) {
  const open = ui.expanded.has(section.key);
  const typeLabel = section.type === "season" ? "合集" : section.type === "series" ? "系列" : "";
  const title = typeLabel ? `${typeLabel} · ${section.title}` : section.title;
  const items = section.items ?? [];
  const subscriptionKey = `${activeCreator()?.id}:${section.key}`;
  const following = Boolean(ui.app?.subscriptions?.[subscriptionKey]?.enabled);
  const hasCover = Boolean(section.cover);
  return `<article class="section-card ${open ? "open" : ""} ${hasCover ? "has-cover" : ""}">
    <div class="section-header">
      <button class="section-toggle" type="button" data-action="toggle-section" data-key="${escapeHtml(section.key)}" aria-expanded="${open}" aria-label="${open ? "收起" : "展开"}${escapeHtml(title)}">${symbol("›")}</button>
      ${hasCover ? `<button class="section-cover-button" type="button" data-action="open-section" data-key="${escapeHtml(section.key)}" aria-label="进入 ${escapeHtml(title)} 详情">${image(section.cover, `${title}封面`, "section-cover")}</button>` : ""}
      <button class="section-title-button" type="button" data-action="open-section" data-key="${escapeHtml(section.key)}"><h2 class="section-title">${escapeHtml(title)}</h2><span class="section-meta">${section.total} 个作品${section.updatedAt ? ` · 更新于 ${formatDate(section.updatedAt)}` : ""}${following ? " · 自动追更" : ""}</span></button>
      <div class="section-actions"><button class="icon-button" type="button" data-action="play-section" data-key="${escapeHtml(section.key)}" aria-label="播放全部">${symbol("▶")}</button><button class="icon-button" type="button" data-action="cache-section" data-key="${escapeHtml(section.key)}" aria-label="缓存全部">${symbol("⇩")}</button><button class="ghost-button" type="button" data-action="open-section" data-key="${escapeHtml(section.key)}">进入详情</button></div>
    </div>
    <div class="section-preview">${items.length ? trackRows(items, section, 4) : '<div class="notice">展开后尚无预览数据，进入详情可以重新加载。</div>'}${section.total > 4 ? `<button class="more-button" type="button" data-action="open-section" data-key="${escapeHtml(section.key)}">查看全部 ${section.total} 个作品</button>` : ""}</div>
  </article>`;
}

function creatorPage() {
  const creator = activeCreator();
  if (!creator) return emptyPage();
  if (ui.loading && !ui.activeContent) return '<div class="empty-state"><div class="spinner">◌</div><h1>正在读取 UP 主内容</h1><p>首次加载可能需要几秒钟。</p></div>';
  const content = ui.activeContent;
  const sections = normalizedSections();
  return `<section>
    ${ui.error ? `<div class="error-message">${escapeHtml(ui.error)}</div>` : ""}
    ${ui.notice ? `<div class="notice">${escapeHtml(ui.notice)}</div>` : ""}
    ${content?.warnings?.length ? `<div class="notice">部分内容暂未读取：${content.warnings.map(escapeHtml).join("、")}。可以稍后点击刷新。</div>` : ""}
    <div class="profile">
      ${image(creator.avatar, creator.name, "profile-avatar")}
      <div class="profile-copy"><h1>${escapeHtml(creator.name)}</h1><p>UID ${escapeHtml(creator.id)}${content?.all?.total ? ` · ${content.all.total} 个公开作品` : ""}</p></div>
      <div class="profile-actions"><button class="ghost-button danger-button" type="button" data-action="remove-creator">移除</button><button class="plain-button" type="button" data-action="refresh-creator">${symbol("↻")}检查更新</button><button class="primary-button" type="button" data-action="resume">${symbol("▶")}继续播放</button></div>
    </div>
    ${content ? sections.map(sectionCard).join("") : '<div class="notice">尚未载入内容。</div>'}
  </section>`;
}

function emptyPage() {
  return `<section class="empty-state"><div class="brand-mark" style="margin:auto"><img src="icons/icon48.png" alt=""></div><h1>添加一个 UP 主开始使用</h1><p>输入名称进行搜索，或者直接输入唯一的数字 UID。扩展会读取全部作品、合集和系列。</p><form class="empty-search" data-form="search"><input class="search-input" name="keyword" placeholder="UP 主名称或 UID"><button class="primary-button" type="submit">搜索</button></form>${ui.error ? `<div class="error-message">${escapeHtml(ui.error)}</div>` : ""}</section>`;
}

function detailPage() {
  const section = ui.activeSection;
  if (!section) return creatorPage();
  const items = ui.detailData?.items ?? section.items ?? [];
  const visibleItems = filterTracksByKeyword(items, ui.trackSearchKeyword);
  const total = ui.detailData?.total ?? section.total;
  const searchingTracks = Boolean(ui.trackSearchKeyword);
  const typeLabel = section.type === "season" ? "合集" : section.type === "series" ? "系列" : "全部作品";
  const subscriptionKey = `${activeCreator()?.id}:${section.key}`;
  const following = Boolean(ui.app?.subscriptions?.[subscriptionKey]?.enabled);
  return `<section>
    <button class="ghost-button" type="button" data-action="show-creator">${symbol("←")}返回 ${escapeHtml(activeCreator()?.name ?? "UP 主")}</button>
    ${ui.error ? `<div class="error-message">${escapeHtml(ui.error)}</div>` : ""}
    <div class="detail-header">
      ${image(section.cover, section.title, "detail-cover")}
      <div class="detail-copy"><h1>${escapeHtml(section.title)}</h1><div class="muted">${typeLabel} · ${total} 个作品</div><div class="detail-actions"><button class="primary-button" type="button" data-action="play-detail">${symbol("▶")}播放全部</button><button class="plain-button" type="button" data-action="cache-section" data-key="${escapeHtml(section.key)}">${symbol("⇩")}缓存全部</button><label class="switch"><input type="checkbox" data-action="follow-section" ${following ? "checked" : ""}>自动追更并缓存</label></div></div>
    </div>
    <form class="track-search-form" data-form="track-search"><input class="track-search-input" name="keyword" autocomplete="off" placeholder="搜索当前${typeLabel}中的作品" value="${escapeHtml(ui.trackSearchKeyword)}" aria-label="搜索当前${typeLabel}中的作品"><button class="plain-button" type="submit">${symbol("⌕")}搜索</button>${searchingTracks ? '<button class="ghost-button" type="button" data-action="clear-track-search">清除</button>' : ""}</form>
    ${searchingTracks && !ui.loading ? `<div class="track-search-summary">“${escapeHtml(ui.trackSearchKeyword)}”找到 ${visibleItems.length} 个作品 · 已检索 ${items.length} / ${total}</div>` : ""}
    <div class="track-table"><div class="track-table-head"><span>#</span><span>作品</span><span>发布时间</span><span>时长</span><span></span></div>${ui.loading ? '<div class="notice">正在读取并搜索全部作品……</div>' : visibleItems.length ? trackRows(visibleItems, { ...section, items: visibleItems }) : `<div class="notice">${searchingTracks ? "没有找到匹配的作品，请尝试其他关键词。" : "该栏目暂无作品。"}</div>`}${!ui.loading && items.length < total ? `<button class="more-button" type="button" data-action="load-more">继续加载（已显示 ${items.length} / ${total}）</button>` : ""}</div>
  </section>`;
}

function downloadsPage() {
  const info = ui.cacheInfo;
  const directory = info?.directory;
  const records = info?.records ?? [];
  const totalBytes = records.reduce((sum, record) => sum + Number(record.size || 0), 0);
  const activity = info?.activity ?? ui.cacheActivity;
  const current = info?.current;
  const pending = info?.pending ?? [];
  const recent = info?.recent ?? [];
  const activeCount = pending.length + (current ? 1 : 0);
  const progress = Math.max(0, Math.min(100, Math.round(Number(activity?.progress ?? 0) * 100)));
  return `<section><div class="page-heading"><div><h1>缓存管理</h1><p>本地目录、下载队列和离线文件</p></div><div class="page-heading-actions"><button class="plain-button" type="button" data-action="refresh-cache">${symbol("↻")}刷新</button><button class="primary-button" type="button" data-action="choose-folder">${symbol("▣")}${directory?.configured ? "重新授权目录" : "选择缓存目录"}</button></div></div>
    ${ui.error ? `<div class="error-message">${escapeHtml(ui.error)}</div>` : ""}
    ${ui.notice ? `<div class="notice">${escapeHtml(ui.notice)}</div>` : ""}
    <div class="settings-grid">
      <div class="settings-panel"><h2>本地目录</h2><div class="setting-row"><span>目录名称</span><strong>${escapeHtml(directory?.name || "尚未选择")}</strong></div><div class="setting-row"><span>访问权限</span><strong class="${directory?.permission === "granted" ? "cached" : ""}">${directory?.permission === "granted" ? "可读写" : directory?.configured ? "需要重新授权" : "未配置"}</strong></div></div>
      <div class="settings-panel"><h2>缓存概览</h2><div class="setting-row"><span>进行中与等待</span><strong>${activeCount}</strong></div><div class="setting-row"><span>已缓存作品</span><strong>${records.length}</strong></div><div class="setting-row"><span>占用空间</span><strong>${formatBytes(totalBytes)}</strong></div></div>
    </div>
    <div class="cache-queue-panel">
      <div class="cache-panel-heading"><div><h2>缓存队列</h2><p>${current ? "正在处理 1 个任务" : "当前没有正在处理的任务"}${pending.length ? `，另有 ${pending.length} 个等待中` : ""}</p></div><span class="queue-count">${activeCount}</span></div>
      ${current ? `<div class="queue-current"><div class="queue-status-line"><span class="status-dot active"></span><strong>${escapeHtml(current.track.title)}</strong><span>${cacheStatusText(activity)}</span></div><div class="queue-meta">${escapeHtml(current.track.creator?.name || "未知UP主")} · ${cacheFormatText(current)}</div>${["downloading", "encoding"].includes(activity?.status) ? `<div class="queue-progress" aria-label="缓存进度 ${progress}%"><span style="width:${progress}%"></span></div>` : ""}</div>` : '<div class="queue-empty">缓存作品或合集后，任务会在这里按顺序显示。</div>'}
      ${pending.length ? `<div class="queue-list"><div class="queue-list-title">等待中</div>${pending.map((task, index) => cacheTaskRow(task, `${index + 1}`, "等待中")).join("")}</div>` : ""}
    </div>
    ${recent.length ? `<div class="cache-history-panel"><div class="cache-panel-heading"><div><h2>最近任务</h2><p>保留本次后台会话最近 ${recent.length} 条结果</p></div></div><div class="queue-list">${recent.slice(0, 20).map(task => cacheTaskRow(task, cacheHistorySymbol(task.status), cacheHistoryText(task))).join("")}</div></div>` : ""}
    <h2 class="cache-files-heading">已缓存文件</h2>
    ${records.length ? `<div class="track-table" style="margin-top:12px">${records.slice().reverse().slice(0, 100).map((record, index) => `<div class="track-row"><span class="track-index">${String(index + 1).padStart(2, "0")}</span><div><div class="track-title">${escapeHtml(record.title)}</div><div class="track-subtitle">${escapeHtml(record.creator?.name || "")}${record.format === "mp3" ? ` · MP3 ${record.bitrate} kbps` : " · 原始格式"}</div></div><span class="track-duration">${formatBytes(record.size)}</span><div class="track-actions"><span class="cached">✓</span></div></div>`).join("")}</div>` : '<div class="download-placeholder" style="margin-top:12px"><h2>还没有本地缓存</h2><p>先选择目录，再回到 UP 主页面点击作品或栏目的下载按钮。</p></div>'}
  </section>`;
}

function activePlaylist() {
  return (ui.app?.playlists ?? []).find(playlist => playlist.id === ui.activePlaylistId) ?? null;
}

function playlistTotalDuration(playlist) {
  return (playlist?.items ?? []).reduce((sum, item) => sum + (Number(item.duration) || 0), 0);
}

function playlistCards() {
  const playlists = ui.app?.playlists ?? [];
  if (!playlists.length) return '<div class="download-placeholder"><h2>还没有播放列表</h2><p>创建一个列表，再从作品或当前播放队列中添加内容。</p></div>';
  return `<div class="playlist-grid">${playlists.map(playlist => `<button class="playlist-card" type="button" data-action="open-playlist" data-id="${escapeHtml(playlist.id)}"><span class="playlist-card-icon">${symbol("♫")}</span><span><strong>${escapeHtml(playlist.name)}</strong><small>${playlist.items.length} 个作品 · ${formatDuration(playlistTotalDuration(playlist))}</small></span><span>${symbol("›")}</span></button>`).join("")}</div>`;
}

function playlistDetail(playlist) {
  const tracks = playlist.items.map(playlistItemToTrack);
  return `<section>
    <button class="ghost-button" type="button" data-action="close-playlist">${symbol("←")}返回我的播放列表</button>
    ${ui.error ? `<div class="error-message">${escapeHtml(ui.error)}</div>` : ""}
    ${ui.notice ? `<div class="notice">${escapeHtml(ui.notice)}</div>` : ""}
    <div class="page-heading playlist-heading"><div><h1>${escapeHtml(playlist.name)}</h1><p>${playlist.items.length} 个作品 · ${formatDuration(playlistTotalDuration(playlist))} · 更新于 ${formatDate(Math.floor(playlist.updatedAt / 1000))}</p></div><div class="page-heading-actions"><button class="plain-button" type="button" data-action="rename-playlist" data-id="${escapeHtml(playlist.id)}">重命名</button><button class="ghost-button danger-button" type="button" data-action="delete-playlist" data-id="${escapeHtml(playlist.id)}">删除</button><button class="primary-button" type="button" data-action="play-playlist" data-id="${escapeHtml(playlist.id)}" ${tracks.length ? "" : "disabled"}>${symbol("▶")}播放全部</button></div></div>
    <div class="track-table"><div class="track-table-head playlist-table-head"><span>#</span><span>作品</span><span>UP 主</span><span>时长</span><span></span></div>${tracks.length ? tracks.map((track, index) => `<div class="playlist-track-row"><span class="track-index">${String(index + 1).padStart(2, "0")}</span><button class="playlist-track-title" type="button" data-action="play-playlist" data-id="${escapeHtml(playlist.id)}" data-index="${index}"><strong>${escapeHtml(track.title)}</strong><small>${escapeHtml(track.bvid)}</small></button><span class="playlist-creator">${escapeHtml(track.creator?.name || "未知UP主")}</span><span class="track-duration">${formatDuration(track.duration)}</span><div class="track-actions"><button class="icon-button" type="button" data-action="enqueue-playlist-track" data-id="${escapeHtml(playlist.id)}" data-index="${index}" aria-label="添加到当前队列">${symbol("+")}</button><button class="icon-button" type="button" data-action="move-playlist-track" data-id="${escapeHtml(playlist.id)}" data-index="${index}" data-to="${index - 1}" aria-label="上移" ${index === 0 ? "disabled" : ""}>${symbol("↑")}</button><button class="icon-button" type="button" data-action="move-playlist-track" data-id="${escapeHtml(playlist.id)}" data-index="${index}" data-to="${index + 1}" aria-label="下移" ${index === tracks.length - 1 ? "disabled" : ""}>${symbol("↓")}</button><button class="icon-button danger-button" type="button" data-action="remove-playlist-track" data-id="${escapeHtml(playlist.id)}" data-bvid="${escapeHtml(track.bvid)}" aria-label="从播放列表移除">${symbol("×")}</button></div></div>`).join("") : '<div class="queue-empty">这个播放列表还没有作品。</div>'}</div>
  </section>`;
}

function playlistsPage() {
  const playlist = activePlaylist();
  if (playlist) return playlistDetail(playlist);
  return `<section>${ui.error ? `<div class="error-message">${escapeHtml(ui.error)}</div>` : ""}${ui.notice ? `<div class="notice">${escapeHtml(ui.notice)}</div>` : ""}<div class="page-heading"><div><h1>我的播放列表</h1><p>跨 UP 主保存作品和固定播放顺序</p></div></div><form class="playlist-create-form" data-form="create-playlist"><input name="name" maxlength="80" placeholder="新播放列表名称" aria-label="新播放列表名称"><button class="primary-button" type="submit">${symbol("+")}创建</button></form>${playlistCards()}</section>`;
}

function cacheFormatText(task) {
  return task.format === "mp3" ? `MP3 ${task.bitrate} kbps` : "原始格式";
}

function cacheHistorySymbol(status) {
  if (status === "failed") return "!";
  if (status === "skipped") return "—";
  return "✓";
}

function cacheHistoryText(task) {
  if (task.status === "failed") return task.message ? `失败：${task.message}` : "失败";
  if (task.status === "skipped") return "已存在，已跳过";
  return "已完成";
}

function cacheTaskRow(task, marker, statusText) {
  return `<div class="queue-row ${task.status === "failed" ? "failed" : ""}"><span class="queue-marker">${escapeHtml(marker)}</span><div class="queue-copy"><div class="track-title">${escapeHtml(task.track?.title || "未命名作品")}</div><div class="track-subtitle">${escapeHtml(task.track?.creator?.name || "未知UP主")} · ${cacheFormatText(task)}</div></div><span class="queue-state">${escapeHtml(statusText)}</span></div>`;
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

function cacheStatusText(activity) {
  if (activity.status === "failed") return `失败：${escapeHtml(activity.message || "未知错误")}`;
  if (activity.status === "completed") return "缓存完成";
  if (activity.status === "skipped") return "已经缓存";
  if (activity.status === "decoding") return "正在解码原始音频";
  if (activity.status === "encoding") return `正在转换 MP3 · ${Math.round((activity.progress || 0) * 100)}%`;
  if (activity.status === "downloading") return activity.total
    ? `${Math.round((activity.progress || 0) * 100)}%（${formatBytes(activity.received)} / ${formatBytes(activity.total)}）`
    : `已下载 ${formatBytes(activity.received)}`;
  return "正在准备缓存任务";
}

function settingsPage() {
  const settings = ui.app.settings;
  return `<section><div class="page-heading"><div><h1>设置</h1><p>纯浏览器扩展，不连接外部服务</p></div></div><div class="settings-grid">
    <div class="settings-panel"><h2>下载与音频</h2><label class="setting-row"><span>默认缓存格式</span><select name="defaultFormat" data-setting><option value="original" ${settings.defaultFormat === "original" ? "selected" : ""}>保留原始音频</option><option value="mp3" ${settings.defaultFormat === "mp3" ? "selected" : ""}>转换为 MP3</option></select></label><label class="setting-row"><span>MP3 音质</span><select name="mp3Bitrate" data-setting ${settings.defaultFormat === "mp3" ? "" : "disabled"}><option value="128" ${settings.mp3Bitrate === 128 ? "selected" : ""}>128 kbps</option><option value="192" ${settings.mp3Bitrate === 192 ? "selected" : ""}>192 kbps</option><option value="320" ${settings.mp3Bitrate === 320 ? "selected" : ""}>320 kbps</option></select></label></div>
    <div class="settings-panel"><h2>追更与播放</h2><label class="setting-row"><span>浏览器启动后检查更新</span><span class="switch"><input type="checkbox" name="checkUpdatesOnStartup" data-setting ${settings.checkUpdatesOnStartup ? "checked" : ""}>开启</span></label><label class="setting-row"><span>记住播放位置</span><span class="switch"><input type="checkbox" name="rememberProgress" data-setting ${settings.rememberProgress ? "checked" : ""}>开启</span></label><label class="setting-row"><span>检查间隔</span><select name="updateIntervalMinutes" data-setting><option value="60" ${settings.updateIntervalMinutes === 60 ? "selected" : ""}>每小时</option><option value="180" ${settings.updateIntervalMinutes === 180 ? "selected" : ""}>每 3 小时</option><option value="360" ${settings.updateIntervalMinutes === 360 ? "selected" : ""}>每 6 小时</option></select></label></div>
  </div></section>`;
}

function mainContent() {
  if (!ui.app) return '<div class="empty-state"><div class="spinner">◌</div><h1>正在启动</h1></div>';
  if (ui.view === "detail") return detailPage();
  if (ui.view === "playlists") return playlistsPage();
  if (ui.view === "downloads") return downloadsPage();
  if (ui.view === "settings") return settingsPage();
  return creatorPage();
}

function playerMarkup() {
  const player = ui.app?.player ?? {};
  const track = player.currentTrack;
  const progressMax = Math.max(1, Number(player.duration) || Number(track?.duration) || 1);
  const sourceLabel = playbackSourceLabel(player.source, player.loading);
  return `<footer class="player-bar">
    <div class="now-playing">${image(track?.cover, track?.title ?? "尚未播放", "now-cover")}<div class="now-copy"><div class="now-title">${escapeHtml(track?.title ?? "选择一个作品开始播放")}</div><div class="now-meta"><span class="muted">${escapeHtml(track?.creator?.name ?? "哔哩音频")}</span>${sourceLabel ? `<span class="source-badge ${player.source?.kind === "cache" ? "local" : ""}">${escapeHtml(sourceLabel)}</span>` : ""}${player.error ? `<span class="player-error">${escapeHtml(player.error)}</span>` : ""}</div></div></div>
    <div class="player-controls"><button class="icon-button" type="button" data-action="change-mode" aria-label="切换播放模式">${symbol(player.mode === "shuffle" ? "⤨" : player.mode === "single" ? "①" : "↻")}</button><button class="icon-button" type="button" data-action="previous" aria-label="上一首">${symbol("◀|")}</button><button class="play-main" type="button" data-action="${player.playing ? "pause" : "resume"}" aria-label="${player.playing ? "暂停" : "播放"}">${symbol(player.playing ? "Ⅱ" : "▶")}</button><button class="icon-button" type="button" data-action="next" aria-label="下一首">${symbol("|▶")}</button><button class="queue-toggle ${ui.queueOpen ? "active" : ""}" type="button" data-action="toggle-play-queue" aria-expanded="${ui.queueOpen}" aria-label="查看播放队列">${symbol("☷")}<span>${player.queue?.length ?? 0}</span></button></div>
    <div class="progress-area"><input class="progress-input" type="range" min="0" max="${progressMax}" value="${Math.min(Number(player.currentTime) || 0, progressMax)}" step="1" data-action="seek" aria-label="播放进度"><span class="time-label">${formatDuration(player.currentTime)} / ${formatDuration(progressMax)}</span></div>
  </footer>`;
}

function playQueueMarkup() {
  if (!ui.queueOpen) return "";
  const player = ui.app?.player ?? {};
  const queue = player.queue ?? [];
  const currentIndex = Number(player.queueIndex);
  const title = player.queueContext?.title || "播放队列";
  return `<section class="play-queue-drawer" aria-label="播放队列">
    <div class="play-queue-header"><div><h2>${escapeHtml(title)}</h2><p>${queue.length ? `${currentIndex >= 0 ? currentIndex + 1 : 0} / ${queue.length}` : "队列为空"}</p></div><div><button class="plain-button" type="button" data-action="save-play-queue" ${queue.length ? "" : "disabled"}>保存为播放列表</button><button class="ghost-button" type="button" data-action="clear-play-queue" ${queue.length ? "" : "disabled"}>清空</button><button class="icon-button" type="button" data-action="toggle-play-queue" aria-label="关闭播放队列">${symbol("×")}</button></div></div>
    <div class="play-queue-list">${queue.length ? queue.map((track, index) => `<div class="play-queue-row ${index === currentIndex ? "current" : ""}" data-queue-index="${index}"><button class="queue-track-button" type="button" data-action="play-queue-index" data-index="${index}"><span class="queue-position">${index === currentIndex ? "♫" : index + 1}</span><span><strong>${escapeHtml(track.title)}</strong><small>${escapeHtml(track.creator?.name || "未知UP主")} · ${formatDuration(track.duration)}</small></span></button><div class="queue-row-actions"><button class="icon-button" type="button" data-action="move-queue-item" data-index="${index}" data-to="${index - 1}" aria-label="上移" ${index === 0 ? "disabled" : ""}>${symbol("↑")}</button><button class="icon-button" type="button" data-action="move-queue-item" data-index="${index}" data-to="${index + 1}" aria-label="下移" ${index === queue.length - 1 ? "disabled" : ""}>${symbol("↓")}</button>${index !== currentIndex && index !== currentIndex + 1 ? `<button class="queue-next-button" type="button" data-action="move-queue-item" data-index="${index}" data-to="${Math.min(currentIndex + 1, queue.length - 1)}">下一首</button>` : ""}<button class="icon-button danger-button" type="button" data-action="remove-queue-item" data-index="${index}" aria-label="移出队列">${symbol("×")}</button></div></div>`).join("") : '<div class="queue-empty">从作品列表点击“+”即可添加到这里。</div>'}</div>
  </section>`;
}

function playerAreaMarkup() {
  return `${playQueueMarkup()}${playerMarkup()}`;
}

function playlistPickerMarkup() {
  const picker = ui.playlistPicker;
  if (!picker) return "";
  const playlists = ui.app?.playlists ?? [];
  return `<div class="modal-backdrop" data-action="close-playlist-picker"><section class="playlist-picker" role="dialog" aria-modal="true" aria-label="添加到播放列表"><div class="playlist-picker-header"><div><h2>添加到播放列表</h2><p>${escapeHtml(picker.label)} · ${picker.tracks.length} 个作品</p></div><button class="icon-button" type="button" data-action="close-playlist-picker" aria-label="关闭">${symbol("×")}</button></div><div class="playlist-picker-list">${playlists.map(playlist => `<button type="button" data-action="add-to-playlist" data-id="${escapeHtml(playlist.id)}"><span>${escapeHtml(playlist.name)}</span><small>${playlist.items.length} 个作品</small></button>`).join("") || '<div class="queue-empty">还没有播放列表，可以在下方新建。</div>'}</div><form class="playlist-create-form modal-create" data-form="create-and-add-playlist"><input name="name" maxlength="80" placeholder="新播放列表名称" aria-label="新播放列表名称"><button class="primary-button" type="submit">新建并添加</button></form></section></div>`;
}

function render() {
  root.innerHTML = `<div class="shell">${topbar()}<div class="workspace">${sidebar()}<main class="content">${mainContent()}</main></div><div class="player-slot">${playerAreaMarkup()}</div>${playlistPickerMarkup()}</div>`;
}

function renderPlayer() {
  const slot = root.querySelector(".player-slot");
  if (slot) slot.innerHTML = playerAreaMarkup();
}

function queueContextForSection(section) {
  return {
    kind: section.type,
    title: `${activeCreator()?.name || "UP 主"} · ${section.title}`
  };
}

async function loadActiveCreator(force = false) {
  const creator = activeCreator();
  if (!creator) {
    ui.activeContent = null;
    render();
    return;
  }
  ui.loading = true;
  ui.error = "";
  ui.activeContent = ui.app.creatorContent?.[creator.id] ?? null;
  render();
  try {
    const content = await send(MESSAGE.loadCreator, { id: creator.id, force });
    ui.activeContent = content;
    ui.app.creatorContent[creator.id] = content;
  } catch (error) {
    ui.error = toErrorMessage(error);
  } finally {
    ui.loading = false;
    render();
  }
}

async function search(keyword) {
  ui.searchKeyword = keyword.trim();
  if (!ui.searchKeyword) return;
  ui.searching = true;
  ui.searchResults = [];
  ui.error = "";
  render();
  try {
    ui.searchResults = await send(MESSAGE.searchCreators, { keyword: ui.searchKeyword, page: 1 });
  } catch (error) {
    ui.error = toErrorMessage(error);
    ui.notice = "名称搜索受到站点风控时，可以改用 UP 主数字 UID 精确添加。";
  } finally {
    ui.searching = false;
    render();
  }
}

async function openSection(key) {
  const section = findSection(key);
  if (!section) return;
  ui.activeSection = section;
  ui.detailData = null;
  ui.detailPage = 1;
  ui.trackSearchKeyword = "";
  ui.view = "detail";
  ui.loading = true;
  ui.error = "";
  render();
  try {
    ui.detailData = await send(MESSAGE.loadSection, {
      creatorId: activeCreator().id,
      section: { id: section.id, type: section.type },
      page: 1,
      pageSize: section.type === "all" ? 50 : 100
    });
  } catch (error) {
    ui.error = toErrorMessage(error);
  } finally {
    ui.loading = false;
    render();
  }
}

async function searchDetailTracks(keyword) {
  const section = ui.activeSection;
  if (!section) return;
  ui.trackSearchKeyword = String(keyword).trim();
  ui.error = "";
  if (!ui.trackSearchKeyword) {
    render();
    return;
  }

  let items = ui.detailData?.items ?? section.items ?? [];
  let total = Number(ui.detailData?.total ?? section.total) || items.length;
  if (items.length >= total) {
    render();
    return;
  }

  ui.loading = true;
  render();
  try {
    const pageSize = section.type === "all" ? 50 : 100;
    let nextPage = ui.detailPage + 1;
    while (items.length < total) {
      const listing = await send(MESSAGE.loadSection, {
        creatorId: activeCreator().id,
        section: { id: section.id, type: section.type },
        page: nextPage,
        pageSize
      });
      total = Number(listing.total) || total;
      const known = new Set(items.map(item => String(item.id)));
      const additions = listing.items.filter(item => !known.has(String(item.id)));
      items = [...items, ...additions];
      ui.detailData = { ...listing, items, total };
      ui.detailPage = nextPage;
      if (!listing.items.length || additions.length === 0 || listing.items.length < pageSize) break;
      nextPage += 1;
    }
  } catch (error) {
    ui.error = `搜索剩余作品时出错：${toErrorMessage(error)}`;
  } finally {
    ui.loading = false;
    render();
  }
}

async function loadMoreDetail() {
  const section = ui.activeSection;
  if (!section) return;
  ui.loading = true;
  render();
  try {
    const nextPage = ui.detailPage + 1;
    const listing = await send(MESSAGE.loadSection, {
      creatorId: activeCreator().id,
      section: { id: section.id, type: section.type },
      page: nextPage,
      pageSize: section.type === "all" ? 50 : 100
    });
    const existing = ui.detailData?.items ?? [];
    const known = new Set(existing.map(item => String(item.id)));
    ui.detailData = {
      ...listing,
      items: [...existing, ...listing.items.filter(item => !known.has(String(item.id)))]
    };
    ui.detailPage = nextPage;
  } catch (error) {
    ui.error = toErrorMessage(error);
  } finally {
    ui.loading = false;
    render();
  }
}

function queueForSection(section, items = section.items ?? []) {
  return items.map(track => trackWithContext(track, section));
}

async function playerCommand(command, payload = {}) {
  try {
    const player = await send(MESSAGE.playerCommand, { command, payload });
    ui.app.player = { ...ui.app.player, ...player };
    renderPlayer();
  } catch (error) {
    ui.app.player = { ...ui.app.player, error: toErrorMessage(error), loading: false };
    renderPlayer();
  }
}

async function playlistCommand(command, payload = {}) {
  ui.app.playlists = await send(MESSAGE.playlistCommand, { command, payload });
  return ui.app.playlists;
}

function openPlaylistPicker(tracks, label) {
  const valid = (tracks ?? []).filter(track => track?.bvid);
  if (!valid.length) throw new Error("没有可添加到播放列表的作品");
  ui.playlistPicker = { tracks: valid, label };
  render();
}

async function addPickerTracks(playlistId) {
  const picker = ui.playlistPicker;
  if (!picker) return;
  const before = ui.app.playlists.find(playlist => playlist.id === playlistId)?.items.length ?? 0;
  await playlistCommand("addTracks", { playlistId, tracks: picker.tracks });
  const after = ui.app.playlists.find(playlist => playlist.id === playlistId)?.items.length ?? before;
  ui.playlistPicker = null;
  ui.notice = `已添加 ${after - before} 个作品，重复作品已自动跳过。`;
  render();
}

async function refreshCacheInfo() {
  try {
    ui.cacheInfo = await send(MESSAGE.cacheCommand, { command: "status" });
  } catch (error) {
    ui.error = toErrorMessage(error);
  }
}

async function cacheTracks(tracks, section) {
  if (!tracks.length) throw new Error("当前栏目没有可缓存的作品");
  const contextual = tracks.map(track => trackWithContext(track, section));
  await send(MESSAGE.cacheCommand, {
    command: "cacheTracks",
    payload: {
      tracks: contextual,
      section: { id: section.id, type: section.type, title: section.title },
      format: ui.app.settings.defaultFormat,
      bitrate: ui.app.settings.mp3Bitrate
    }
  });
  ui.notice = `已将 ${contextual.length} 个作品加入缓存队列。`;
  await refreshCacheInfo();
  render();
}

async function cacheWholeSection(section) {
  ui.notice = `正在读取“${section.title}”的全部作品……`;
  render();
  const pageSize = 100;
  let page = 1;
  let accepted = 0;
  let total = Number(section.total) || 0;
  while (page === 1 || accepted < total) {
    const listing = await send(MESSAGE.loadSection, {
      creatorId: activeCreator().id,
      section: { id: section.id, type: section.type },
      page,
      pageSize
    });
    total = Number(listing.total) || total;
    if (!listing.items.length) break;
    const contextual = listing.items.map(track => trackWithContext(track, section));
    await send(MESSAGE.cacheCommand, {
      command: "cacheTracks",
      payload: {
        tracks: contextual,
        section: { id: section.id, type: section.type, title: section.title },
        format: ui.app.settings.defaultFormat,
        bitrate: ui.app.settings.mp3Bitrate
      }
    });
    accepted += listing.items.length;
    ui.notice = `正在加入缓存队列：${Math.min(accepted, total)} / ${total}`;
    render();
    if (listing.items.length < pageSize || accepted >= total) break;
    page += 1;
  }
  ui.notice = `“${section.title}”的 ${Math.min(accepted, total)} 个作品已加入缓存队列。`;
  await refreshCacheInfo();
  render();
}

root.addEventListener("submit", event => {
  const form = event.target.closest("[data-form]");
  if (!form) return;
  event.preventDefault();
  const formData = new FormData(form);
  const keyword = formData.get("keyword") ?? formData.get("name") ?? "";
  if (form.dataset.form === "track-search") searchDetailTracks(keyword);
  else if (form.dataset.form === "search") search(keyword);
  else if (form.dataset.form === "create-playlist") {
    playlistCommand("create", { name: keyword }).then(() => {
      ui.notice = `已创建播放列表“${String(keyword).trim()}”。`;
      render();
    }).catch(error => { ui.error = toErrorMessage(error); render(); });
  } else if (form.dataset.form === "create-and-add-playlist") {
    playlistCommand("create", { name: keyword }).then(playlists => addPickerTracks(playlists.at(-1).id)).catch(error => { ui.error = toErrorMessage(error); render(); });
  }
});

root.addEventListener("change", async event => {
  const follow = event.target.closest('[data-action="follow-section"]');
  if (follow) {
    const section = ui.activeSection;
    const items = ui.detailData?.items ?? section.items ?? [];
    try {
      ui.app.subscriptions = await send(MESSAGE.setSubscription, {
        creatorId: activeCreator().id,
        section,
        enabled: follow.checked,
        mode: "download",
        lastSeenIds: items.map(item => item.id)
      });
      ui.notice = follow.checked ? "已开启自动追更；以后发现新作品会加入缓存队列。" : "已关闭自动追更。";
    } catch (error) {
      ui.error = toErrorMessage(error);
    }
    render();
    return;
  }
  const setting = event.target.closest("[data-setting]");
  if (!setting) return;
  let value = setting.type === "checkbox" ? setting.checked : setting.value;
  if (["mp3Bitrate", "updateIntervalMinutes"].includes(setting.name)) value = Number(value);
  try {
    ui.app.settings = await send(MESSAGE.saveSettings, { patch: { [setting.name]: value } });
  } catch (error) {
    ui.error = toErrorMessage(error);
  }
  render();
});

root.addEventListener("input", event => {
  if (event.target.matches('[data-action="seek"]')) {
    playerCommand("seek", { time: Number(event.target.value) });
  }
});

root.addEventListener("click", async event => {
  const button = event.target.closest("[data-action]");
  if (!button || button.disabled) return;
  const action = button.dataset.action;
  try {
    if (action === "show-creator") { ui.view = "creator"; ui.error = ""; render(); }
    else if (action === "show-playlists") { ui.view = "playlists"; ui.activePlaylistId = null; ui.error = ""; render(); }
    else if (action === "show-downloads") { ui.view = "downloads"; render(); }
    else if (action === "show-settings") { ui.view = "settings"; render(); }
    else if (action === "open-full") await send(MESSAGE.openPlayer);
    else if (action === "toggle-play-queue") {
      ui.queueOpen = !ui.queueOpen;
      renderPlayer();
      if (ui.queueOpen) requestAnimationFrame(() => root.querySelector(".play-queue-row.current")?.scrollIntoView({ block: "nearest" }));
    }
    else if (action === "play-queue-index") await playerCommand("playIndex", { index: Number(button.dataset.index) });
    else if (action === "remove-queue-item") await playerCommand("removeQueueItem", { index: Number(button.dataset.index) });
    else if (action === "move-queue-item") await playerCommand("reorderQueue", { fromIndex: Number(button.dataset.index), toIndex: Number(button.dataset.to) });
    else if (action === "clear-play-queue") await playerCommand("clearQueue");
    else if (action === "save-play-queue") openPlaylistPicker(ui.app.player.queue ?? [], "当前播放队列");
    else if (action === "close-playlist-picker") {
      if (event.target === button || button.closest(".playlist-picker-header")) {
        ui.playlistPicker = null;
        render();
      }
    }
    else if (action === "add-to-playlist") await addPickerTracks(button.dataset.id);
    else if (action === "open-playlist") { ui.activePlaylistId = button.dataset.id; ui.notice = ""; render(); }
    else if (action === "close-playlist") { ui.activePlaylistId = null; render(); }
    else if (action === "rename-playlist") {
      const playlist = ui.app.playlists.find(item => item.id === button.dataset.id);
      const name = window.prompt("新的播放列表名称", playlist?.name || "");
      if (name != null) { await playlistCommand("rename", { playlistId: button.dataset.id, name }); render(); }
    }
    else if (action === "delete-playlist") {
      const playlist = ui.app.playlists.find(item => item.id === button.dataset.id);
      if (window.confirm(`确定删除播放列表“${playlist?.name || "未命名"}”吗？不会删除缓存文件。`)) {
        await playlistCommand("delete", { playlistId: button.dataset.id });
        ui.activePlaylistId = null;
        ui.notice = "播放列表已删除。";
        render();
      }
    }
    else if (action === "play-playlist") {
      const playlist = ui.app.playlists.find(item => item.id === button.dataset.id);
      const queue = playlist.items.map(playlistItemToTrack);
      await playerCommand("playQueue", { queue, index: Number(button.dataset.index) || 0, queueContext: { kind: "playlist", id: playlist.id, title: `我的播放列表 · ${playlist.name}` } });
    }
    else if (action === "enqueue-playlist-track") {
      const playlist = ui.app.playlists.find(item => item.id === button.dataset.id);
      const track = playlistItemToTrack(playlist.items[Number(button.dataset.index)]);
      await playerCommand("appendQueue", { tracks: [track], queueContext: { kind: "manual", title: "手动播放队列" } });
    }
    else if (action === "move-playlist-track") {
      await playlistCommand("reorderTrack", { playlistId: button.dataset.id, fromIndex: Number(button.dataset.index), toIndex: Number(button.dataset.to) });
      render();
    }
    else if (action === "remove-playlist-track") {
      await playlistCommand("removeTrack", { playlistId: button.dataset.id, bvid: button.dataset.bvid });
      render();
    }
    else if (action === "toggle-section") {
      ui.expanded.has(button.dataset.key) ? ui.expanded.delete(button.dataset.key) : ui.expanded.add(button.dataset.key);
      render();
    }
    else if (action === "open-section") await openSection(button.dataset.key);
    else if (action === "load-more") await loadMoreDetail();
    else if (action === "clear-track-search") {
      ui.trackSearchKeyword = "";
      render();
    }
    else if (action === "select-creator") {
      await send(MESSAGE.selectCreator, { id: button.dataset.id });
      ui.app.settings.activeCreatorId = button.dataset.id;
      ui.view = "creator";
      ui.activeContent = ui.app.creatorContent[button.dataset.id] ?? null;
      await loadActiveCreator();
    }
    else if (action === "add-creator") {
      const creator = ui.searchResults.find(item => String(item.id) === String(button.dataset.id));
      const result = await send(MESSAGE.addCreator, { creator });
      ui.app.creators = result.creators;
      ui.app.settings.activeCreatorId = result.creator.id;
      ui.searchResults = [];
      ui.searchKeyword = "";
      ui.view = "creator";
      await loadActiveCreator(true);
    }
    else if (action === "refresh-creator") await loadActiveCreator(true);
    else if (action === "remove-creator") {
      const removed = activeCreator();
      ui.app.creators = await send(MESSAGE.removeCreator, { id: removed.id });
      ui.app.settings.activeCreatorId = ui.app.creators[0]?.id ?? null;
      ui.activeContent = null;
      ui.notice = `已从扩展列表移除“${removed.name}”，本地音频文件不会删除。`;
      await loadActiveCreator();
    }
    else if (action === "play-section") {
      const section = findSection(button.dataset.key);
      const queue = queueForSection(section);
      if (!queue.length) await openSection(section.key);
      else await playerCommand("playQueue", { queue, index: 0, queueContext: queueContextForSection(section) });
    }
    else if (action === "play-detail") {
      const items = ui.detailData?.items ?? ui.activeSection.items ?? [];
      await playerCommand("playQueue", { queue: queueForSection(ui.activeSection, items), index: 0, queueContext: queueContextForSection(ui.activeSection) });
    }
    else if (action === "play-track") {
      const section = findSection(button.dataset.sectionKey) ?? ui.activeSection;
      const items = ui.view === "detail" ? ui.detailData?.items ?? [] : section.items ?? [];
      const queue = queueForSection(section, items);
      const index = Math.max(0, queue.findIndex(track => String(track.id) === String(button.dataset.trackId)));
      await playerCommand("playQueue", { queue, index, queueContext: queueContextForSection(section) });
    }
    else if (action === "enqueue-track") {
      const section = findSection(button.dataset.sectionKey) ?? ui.activeSection;
      const source = ui.view === "detail" ? ui.detailData?.items ?? [] : section?.items ?? [];
      const track = source.find(item => String(item.id) === String(button.dataset.trackId));
      if (track) {
        await playerCommand("appendQueue", { tracks: [trackWithContext(track, section)], queueContext: { kind: "manual", title: "手动播放队列" } });
        ui.notice = `已将“${track.title}”添加到播放队列。`;
        render();
      }
    }
    else if (action === "add-track-to-playlist") {
      const section = findSection(button.dataset.sectionKey) ?? ui.activeSection;
      const source = ui.view === "detail" ? ui.detailData?.items ?? [] : section?.items ?? [];
      const track = source.find(item => String(item.id) === String(button.dataset.trackId));
      if (track) openPlaylistPicker([trackWithContext(track, section)], track.title);
    }
    else if (["pause", "resume", "next", "previous"].includes(action)) await playerCommand(action);
    else if (action === "change-mode") {
      const order = ["list", "single", "shuffle"];
      const mode = order[(order.indexOf(ui.app.player.mode) + 1) % order.length];
      await playerCommand("mode", { mode });
    }
    else if (action === "choose-folder") {
      const directory = await chooseCacheDirectory();
      await send(MESSAGE.cacheCommand, { command: "refreshDirectory" });
      ui.notice = `缓存目录已设置为“${directory.name}”。`;
      await refreshCacheInfo();
      render();
    }
    else if (action === "refresh-cache") {
      await refreshCacheInfo();
      render();
    }
    else if (action === "cache-track") {
      const section = findSection(button.dataset.sectionKey) ?? ui.activeSection;
      const source = ui.view === "detail" ? ui.detailData?.items ?? [] : section?.items ?? [];
      const track = source.find(item => String(item.id) === String(button.dataset.trackId));
      await cacheTracks(track ? [track] : [], section);
    }
    else if (action === "cache-section") {
      const section = findSection(button.dataset.key) ?? ui.activeSection;
      await cacheWholeSection(section);
    }
  } catch (error) {
    ui.error = toErrorMessage(error);
    render();
  }
});

chrome.runtime.onMessage.addListener(message => {
  if (message?.type === MESSAGE.playerEvent && ui.app) {
    ui.app.player = { ...ui.app.player, ...message.player };
    renderPlayer();
  }
  if (message?.type === MESSAGE.cacheEvent && ui.app) {
    ui.cacheInfo = { ...(ui.cacheInfo ?? {}), ...message.cache };
    ui.cacheActivity = message.cache.activity ?? message.cache;
    if (["completed", "failed", "idle"].includes(message.cache.status)) {
      refreshCacheInfo().then(() => render());
    } else if (ui.view === "downloads" || ["started", "preparing", "skipped"].includes(message.cache.status)) {
      render();
    }
  }
});

async function start() {
  try {
    ui.app = await send(MESSAGE.getAppState);
    await refreshCacheInfo();
    const active = activeCreator();
    if (active && !ui.app.settings.activeCreatorId) ui.app.settings.activeCreatorId = active.id;
    render();
    if (active) await loadActiveCreator();
  } catch (error) {
    root.innerHTML = `<div class="empty-state"><h1>扩展启动失败</h1><div class="error-message">${escapeHtml(toErrorMessage(error))}</div></div>`;
  }
}

start();

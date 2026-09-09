import { MESSAGE } from "../shared/constants.js";
import { formatDate, formatDuration, toErrorMessage } from "../shared/utils.js";
import { chooseCacheDirectory, needsCacheDirectoryReauthorization, reauthorizeCacheDirectory } from "../services/file-store.js";
import { filterTracksByKeyword } from "../services/track-search.js";
import { playbackSourceLabel } from "../services/playback-source.js";
import { playlistItemToTrack } from "../services/playlists.js";
import { parsePlaylistExport, serializePlaylistExport } from "../services/playlist-transfer.js";
import { cacheCoverageForTracks, cacheRecordBytes } from "../services/cache-records.js";
import {
  buildCacheLibrary,
  cacheLibraryLocationMap,
  cacheSelectionState,
  cacheSelectionSummary,
  cacheTaskLocationKey
} from "../services/cache-library.js";
import { loadAllSectionPages } from "../services/section-pagination.js";
import { playbackModeLabel } from "../services/playback-mode.js";
import { PLAYBACK_RATE_MAX, PLAYBACK_RATE_MIN, PLAYBACK_RATE_STEP, normalizePlaybackRate, playbackRateLabel } from "../services/playback-rate.js";
import { PLAYBACK_VOLUME_MAX, PLAYBACK_VOLUME_MIN, normalizePlaybackVolume, playbackVolumePercent } from "../services/playback-volume.js";
import { playerStructureKey } from "../services/player-render-policy.js";
import { isFavoriteSection } from "../services/favorite-sections.js";
import { normalizeTrackSortDirection, sortTracksByPublishedAt } from "../services/track-order.js";

const root = document.getElementById("app");
const isSidePanel = document.documentElement.dataset.layout === "sidepanel";
let draggedRow = null;
let cacheToastTimer = null;
let renderedPlayerKey = "";
let favoriteMetadataRequest = null;

const ui = {
  app: null,
  view: "creator",
  activeContent: null,
  activeSection: null,
  detailData: null,
  detailPage: 1,
  trackSearchKeyword: "",
  queueOpen: false,
  rateOpen: false,
  volumeOpen: false,
  activePlaylistId: null,
  playlistPicker: null,
  playlistImportPreview: null,
  directoryPermissionPrompt: false,
  expanded: new Set(["all"]),
  searchResults: [],
  searchKeyword: "",
  searchOpen: false,
  searching: false,
  loading: false,
  loadingSectionKey: null,
  error: "",
  notice: "",
  cacheInfo: null,
  cacheActivity: null,
  cacheToast: null,
  cacheExpandedGroups: new Set(),
  cacheExpansionInitialized: false,
  cacheManageMode: false,
  cacheSelectedLocations: new Set(),
  cacheDeleting: false,
  detailOrigin: "creator",
  favoriteMetadata: {},
  favoriteMetadataLoading: false,
  favoriteMetadataError: ""
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

function applyIconTooltips(scope) {
  const selector = [
    "button.icon-button[aria-label]",
    "button.search-submit[aria-label]",
    "button.play-main[aria-label]",
    "button.queue-toggle[aria-label]",
    "button.speed-toggle[aria-label]",
    "button.volume-toggle[aria-label]",
    "button.section-toggle[aria-label]",
    "button.section-cover-button[aria-label]"
  ].join(",");
  scope.querySelectorAll(selector).forEach(button => {
    if (!button.title) button.title = button.getAttribute("aria-label") || "";
  });
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

function cacheQueueCount(snapshot = ui.cacheInfo) {
  return Number(snapshot?.queued ?? 0) + (snapshot?.current ? 1 : 0);
}

function showCacheToast(message, snapshot = ui.cacheInfo) {
  ui.cacheToast = { message, count: cacheQueueCount(snapshot) };
  clearTimeout(cacheToastTimer);
  cacheToastTimer = setTimeout(() => {
    ui.cacheToast = null;
    renderCacheToast();
  }, 5000);
  renderCacheToast();
}

function cacheToastMarkup() {
  if (!ui.cacheToast) return "";
  return `<div class="cache-toast" role="status" aria-live="polite"><span class="cache-toast-icon">${symbol("⇩")}</span><div><strong data-role="cache-toast-message">${escapeHtml(ui.cacheToast.message)}</strong><small data-role="cache-toast-count">当前队列 ${ui.cacheToast.count} 项</small></div><button class="cache-toast-link" type="button" data-action="open-cache-queue">查看队列</button><button class="cache-toast-close" type="button" data-action="dismiss-cache-toast" aria-label="关闭缓存提示">${symbol("×")}</button></div>`;
}

function renderCacheToast() {
  const host = root.querySelector(".cache-toast-host");
  if (!host) return;
  const toast = host.querySelector(".cache-toast");
  if (!ui.cacheToast) {
    if (toast) toast.remove();
    return;
  }
  if (!toast) {
    host.innerHTML = cacheToastMarkup();
    applyIconTooltips(host);
    return;
  }
  const message = toast.querySelector('[data-role="cache-toast-message"]');
  const count = toast.querySelector('[data-role="cache-toast-count"]');
  if (message && message.textContent !== ui.cacheToast.message) message.textContent = ui.cacheToast.message;
  const countText = `当前队列 ${ui.cacheToast.count} 项`;
  if (count && count.textContent !== countText) count.textContent = countText;
}

function topbar() {
  const loggedIn = Boolean(ui.activeContent?.login?.isLoggedIn);
  return `<header class="topbar">
    <div class="brand"><span class="brand-mark"><img src="icons/icon32.png" alt=""></span><span class="brand-name">哔哩音频</span></div>
    <form class="search-form" data-form="search">
      <input class="search-input" name="keyword" autocomplete="off" placeholder="搜索 UP 主名称或 UID" value="${escapeHtml(ui.searchKeyword)}" aria-label="搜索 UP 主" data-role="creator-search-input">
      <button class="search-submit" type="submit" aria-label="搜索">${ui.searching ? symbol("◌", "spinner") : symbol("⌕")}</button>
      ${searchResults()}
    </form>
    <div class="top-actions">
      ${ui.activeContent ? `<span class="login-state">${loggedIn ? "● 已登录" : "○ 未登录"}</span>` : ""}
      ${isSidePanel ? `<button class="icon-button" type="button" data-action="open-full" aria-label="打开完整播放器">${symbol("↗")}</button>` : ""}
    </div>
  </header>`;
}

function searchResults() {
  if (!ui.searchOpen || (!ui.searchResults.length && !ui.searching && !ui.searchKeyword)) return "";
  const header = `<div class="search-results-head"><span>搜索结果</span><button class="icon-button" type="button" data-action="close-search" aria-label="关闭搜索结果">${symbol("×")}</button></div>`;
  if (ui.searching) return `<div class="search-results">${header}<div class="search-result muted">正在搜索……</div></div>`;
  if (!ui.searchResults.length) return `<div class="search-results">${header}<div class="search-result muted">没有找到匹配的 UP 主</div></div>`;
  const followed = new Set((ui.app?.creators ?? []).map(item => String(item.id)));
  return `<div class="search-results">${header}${ui.searchResults.map(creator => `
    <div class="search-result">
      ${image(creator.avatar, creator.name, "creator-avatar")}
      <div><div class="search-result-title">${escapeHtml(creator.name)}</div><div class="search-result-meta">UID ${escapeHtml(creator.id)}${creator.fans ? ` · ${creator.fans.toLocaleString("zh-CN")} 粉丝` : ""}</div></div>
      <button class="plain-button" type="button" data-action="add-creator" data-id="${escapeHtml(creator.id)}" ${followed.has(String(creator.id)) ? "disabled" : ""}>${followed.has(String(creator.id)) ? "已添加" : "添加"}</button>
    </div>`).join("")}</div>`;
}

function sidebar() {
  const workCount = cacheWorkCount();
  return `<aside class="sidebar" aria-label="主导航">
    <button class="nav-button ${ui.view === "playlists" ? "active" : ""}" type="button" data-action="show-playlists">${symbol("☷")}我的播放列表<span class="nav-badge subtle">${ui.app?.playlists?.length ?? 0}</span></button>
    <button class="nav-button ${ui.view === "favorites" ? "active" : ""}" type="button" data-action="show-favorite-sections">${symbol("★")}收藏的合集与系列<span class="nav-badge subtle">${ui.app?.favoriteSections?.length ?? 0}</span></button>
    <button class="nav-button ${ui.view === "downloads" ? "active" : ""}" type="button" data-action="show-downloads">${symbol("⇩")}缓存管理<span class="nav-badge" data-role="cache-nav-count" aria-label="${workCount} 个缓存任务" ${workCount ? "" : "hidden"}>${workCount || ""}</span></button>
    <button class="nav-button ${ui.view === "settings" ? "active" : ""}" type="button" data-action="show-settings">${symbol("⚙")}设置</button>
    <div class="sidebar-label">关注的 UP 主</div>
    ${creatorNav()}
  </aside>`;
}

function trackWithContext(track, section) {
  const creator = creatorForSection(section);
  return {
    ...track,
    creator: creator ? { id: creator.id, name: creator.name } : null,
    sectionTitle: section.title
  };
}

function currentTrackSortDirection() {
  return normalizeTrackSortDirection(ui.app?.settings?.sectionSortDirection);
}

function trackSortLabel() {
  return currentTrackSortDirection() === "desc" ? "发布时间：倒序" : "发布时间：正序";
}

function trackRows(items, section, limit = null) {
  const visibleItems = sortTracksByPublishedAt(items, currentTrackSortDirection());
  const visible = limit ? visibleItems.slice(0, limit) : visibleItems;
  const currentId = ui.app?.player?.currentTrack?.id;
  const cached = new Set((ui.cacheInfo?.records ?? []).map(record => String(record.trackId)));
  return visible.map((track, index) => `<div class="track-row ${track.id === currentId ? "playing" : ""}">
    <span class="track-index">${track.id === currentId && ui.app.player.playing ? "♫" : String(index + 1).padStart(2, "0")}</span>
    <div><div class="track-title">${escapeHtml(track.title)}</div><div class="track-subtitle">${track.bvid ? escapeHtml(track.bvid) : "视频作品"}${track.publishedAt ? ` · ${formatDate(track.publishedAt)}` : ""}</div></div>
    <span class="track-duration">${formatDuration(track.duration)}</span>
    <div class="track-actions"><button class="icon-button" type="button" data-action="play-track" data-track-id="${escapeHtml(track.id)}" data-section-key="${escapeHtml(section.key)}" aria-label="播放 ${escapeHtml(track.title)}">${symbol(track.id === currentId && ui.app.player.playing ? "Ⅱ" : "▶")}</button><button class="icon-button" type="button" data-action="enqueue-track" data-track-id="${escapeHtml(track.id)}" data-section-key="${escapeHtml(section.key)}" aria-label="添加到当前播放队列">${symbol("+")}</button><button class="icon-button" type="button" data-action="add-track-to-playlist" data-track-id="${escapeHtml(track.id)}" data-section-key="${escapeHtml(section.key)}" aria-label="添加到我的播放列表">${symbol("☆")}</button><button class="icon-button ${cached.has(String(track.id)) ? "cached" : ""}" type="button" data-action="cache-track" data-track-id="${escapeHtml(track.id)}" data-section-key="${escapeHtml(section.key)}" aria-label="${cached.has(String(track.id)) ? "已缓存" : "缓存"}">${symbol(cached.has(String(track.id)) ? "✓" : "⇩")}</button></div>
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
  if (ui.view === "detail" && ui.activeSection?.key === key) return ui.activeSection;
  return normalizedSections().find(section => section.key === key) ?? ui.activeSection;
}

function creatorForSection(section) {
  const creator = section?.creator;
  if (creator?.id != null) return { id: String(creator.id), name: creator.name || "未知UP主" };
  return activeCreator();
}

function favoriteSectionPayload(section) {
  const creator = creatorForSection(section);
  if (!creator) throw new Error("未找到栏目的所属 UP 主");
  return {
    creatorId: creator.id,
    creatorName: creator.name,
    type: section.type,
    sectionId: section.id,
    title: section.title
  };
}

function isSectionFavorite(section) {
  return section?.type !== "all" && isFavoriteSection(ui.app?.favoriteSections ?? [], favoriteSectionPayload(section));
}

function favoriteSectionToSection(favorite) {
  const metadata = ui.favoriteMetadata[favorite.key] ?? {};
  return {
    key: `${favorite.type}:${favorite.sectionId}`,
    id: favorite.sectionId,
    type: favorite.type,
    title: metadata.title || favorite.title,
    total: metadata.available ? metadata.total : null,
    cover: metadata.cover || "",
    items: [],
    creator: { id: favorite.creatorId, name: favorite.creatorName },
    favoriteKey: favorite.key
  };
}

function sectionCard(section) {
  const open = ui.expanded.has(section.key);
  const typeLabel = section.type === "season" ? "合集" : section.type === "series" ? "系列" : "";
  const title = typeLabel ? `${typeLabel} · ${section.title}` : section.title;
  const items = section.items ?? [];
  const creator = creatorForSection(section);
  const subscriptionKey = `${creator?.id}:${section.key}`;
  const following = Boolean(ui.app?.subscriptions?.[subscriptionKey]?.enabled);
  const favorite = section.type !== "all" && isSectionFavorite(section);
  const hasCover = Boolean(section.cover);
  const loading = ui.loadingSectionKey === section.key;
  return `<article class="section-card ${open ? "open" : ""} ${hasCover ? "has-cover" : ""}">
    <div class="section-header">
      <button class="section-toggle" type="button" data-action="toggle-section" data-key="${escapeHtml(section.key)}" aria-expanded="${open}" aria-label="${open ? "收起" : "展开"}${escapeHtml(title)}">${symbol("›")}</button>
      ${hasCover ? `<button class="section-cover-button" type="button" data-action="open-section" data-key="${escapeHtml(section.key)}" aria-label="进入 ${escapeHtml(title)} 详情">${image(section.cover, `${title}封面`, "section-cover")}</button>` : ""}
      <button class="section-title-button" type="button" data-action="open-section" data-key="${escapeHtml(section.key)}"><h2 class="section-title">${escapeHtml(title)}</h2><span class="section-meta">${section.total} 个作品${section.updatedAt ? ` · 更新于 ${formatDate(section.updatedAt)}` : ""}${following ? " · 自动追更" : ""}</span></button>
      <div class="section-actions"><button class="icon-button" type="button" data-action="play-section" data-key="${escapeHtml(section.key)}" aria-label="${loading ? "正在读取全部作品" : "播放全部"}" ${loading ? "disabled" : ""}>${symbol(loading ? "◌" : "▶", loading ? "spinner" : "")}</button><button class="icon-button" type="button" data-action="cache-section" data-key="${escapeHtml(section.key)}" aria-label="缓存全部" ${loading ? "disabled" : ""}>${symbol("⇩")}</button>${section.type !== "all" ? `<button class="icon-button" type="button" data-action="toggle-favorite-section" data-key="${escapeHtml(section.key)}" aria-label="${favorite ? "取消收藏" : "收藏"}${typeLabel}">${symbol(favorite ? "★" : "☆")}</button>` : ""}<button class="ghost-button" type="button" data-action="open-section" data-key="${escapeHtml(section.key)}" ${loading ? "disabled" : ""}>${loading ? "正在读取作品…" : "进入详情"}</button></div>
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
  const items = sortTracksByPublishedAt(ui.detailData?.items ?? section.items ?? [], currentTrackSortDirection());
  const visibleItems = filterTracksByKeyword(items, ui.trackSearchKeyword);
  const total = ui.detailData?.total ?? section.total;
  const searchingTracks = Boolean(ui.trackSearchKeyword);
  const typeLabel = section.type === "season" ? "合集" : section.type === "series" ? "系列" : "全部作品";
  const creator = creatorForSection(section);
  const subscriptionKey = `${creator?.id}:${section.key}`;
  const following = Boolean(ui.app?.subscriptions?.[subscriptionKey]?.enabled);
  const canFollow = (ui.app?.creators ?? []).some(item => String(item.id) === String(creator?.id));
  const favorite = section.type !== "all" && isSectionFavorite(section);
  const backLabel = ui.detailOrigin === "favorites" ? "返回收藏的合集与系列" : `返回 ${activeCreator()?.name ?? "UP 主"}`;
  return `<section>
    <button class="ghost-button" type="button" data-action="show-creator">${symbol("←")}${escapeHtml(backLabel)}</button>
    ${ui.error ? `<div class="error-message">${escapeHtml(ui.error)}</div>` : ""}
    <div class="detail-header">
      ${image(section.cover, section.title, "detail-cover")}
      <div class="detail-copy"><h1>${escapeHtml(section.title)}</h1><div class="muted">${typeLabel} · ${total} 个作品${creator?.name ? ` · ${escapeHtml(creator.name)}` : ""}</div><div class="detail-actions"><button class="primary-button" type="button" data-action="play-detail">${symbol("▶")}播放全部</button><button class="plain-button" type="button" data-action="cache-section" data-key="${escapeHtml(section.key)}">${symbol("⇩")}缓存全部</button>${section.type !== "all" ? `<button class="plain-button" type="button" data-action="toggle-active-section-favorite">${symbol(favorite ? "★" : "☆")}${favorite ? "已收藏" : "收藏"}</button>` : ""}${canFollow ? `<label class="switch"><input type="checkbox" data-action="follow-section" ${following ? "checked" : ""}>自动追更并缓存</label>` : ""}</div></div>
    </div>
    <div class="track-list-toolbar"><form class="track-search-form" data-form="track-search"><input class="track-search-input" name="keyword" autocomplete="off" placeholder="搜索当前${typeLabel}中的作品" value="${escapeHtml(ui.trackSearchKeyword)}" aria-label="搜索当前${typeLabel}中的作品"><button class="plain-button" type="submit">${symbol("⌕")}搜索</button>${searchingTracks ? '<button class="ghost-button" type="button" data-action="clear-track-search">清除</button>' : ""}</form><button class="plain-button sort-button" type="button" data-action="toggle-sort-order" aria-label="切换作品发布时间排序">${symbol(currentTrackSortDirection() === "desc" ? "↓" : "↑")}${trackSortLabel()}</button></div>
    ${searchingTracks && !ui.loading ? `<div class="track-search-result-bar"><div class="track-search-summary">“${escapeHtml(ui.trackSearchKeyword)}”找到 ${visibleItems.length} 个作品 · 已检索 ${items.length} / ${total}</div>${visibleItems.length ? `<div class="track-search-actions"><button class="plain-button" type="button" data-action="play-search-results">${symbol("▶")}播放搜索结果</button><button class="plain-button" type="button" data-action="save-search-results">${symbol("☆")}保存到我的播放列表</button></div>` : ""}</div>` : ""}
    <div class="track-table"><div class="track-table-head"><span>#</span><span>作品</span><span>发布时间</span><span>时长</span><span></span></div>${ui.loading ? '<div class="notice">正在读取并搜索全部作品……</div>' : visibleItems.length ? trackRows(visibleItems, { ...section, items: visibleItems }) : `<div class="notice">${searchingTracks ? "没有找到匹配的作品，请尝试其他关键词。" : "该栏目暂无作品。"}</div>`}${!ui.loading && items.length < total ? `<button class="more-button" type="button" data-action="load-more">继续加载（已显示 ${items.length} / ${total}）</button>` : ""}</div>
  </section>`;
}

function downloadsPage() {
  const info = ui.cacheInfo;
  const directory = info?.directory;
  const records = info?.records ?? [];
  const locations = records.flatMap(record => (record.locations ?? []).map(location => ({
    ...location,
    trackId: record.trackId,
    bvid: record.bvid,
    title: record.title,
    creator: record.creator
  })));
  const totalBytes = records.reduce((sum, record) => sum + cacheRecordBytes(record), 0);
  const activity = info?.activity ?? ui.cacheActivity;
  const current = info?.current;
  const pending = info?.pending ?? [];
  const recent = info?.recent ?? [];
  const activeCount = pending.length + (current ? 1 : 0);
  const progress = Math.max(0, Math.min(100, Math.round(Number(activity?.progress ?? 0) * 100)));
  const library = buildCacheLibrary(records);
  const locationMap = cacheLibraryLocationMap(records);
  for (const key of ui.cacheSelectedLocations) {
    if (!locationMap.has(key)) ui.cacheSelectedLocations.delete(key);
  }
  const busyKeys = cacheBusyLocationKeys(info);
  const selectableKeys = [...locationMap.keys()].filter(key => !busyKeys.has(key));
  const selection = cacheSelectionSummary(records, ui.cacheSelectedLocations);
  const allSelectionState = cacheSelectionState(selectableKeys, ui.cacheSelectedLocations);
  if (!ui.cacheExpansionInitialized && library.length) {
    library.forEach(node => ui.cacheExpandedGroups.add(node.id));
    ui.cacheExpansionInitialized = true;
  }
  return `<section><div data-cache-section="heading"><div class="page-heading"><div><h1>缓存管理</h1><p>本地目录、下载队列和离线文件</p></div><div class="page-heading-actions"><button class="plain-button" type="button" data-action="refresh-cache">${symbol("↻")}刷新</button><button class="plain-button" type="button" data-action="scan-cache-archives">${symbol("⌕")}扫描归档</button><button class="primary-button" type="button" data-action="choose-folder">${symbol("▣")}${directory?.configured ? "重新授权目录" : "选择缓存目录"}</button></div></div>
    ${ui.error ? `<div class="error-message">${escapeHtml(ui.error)}</div>` : ""}
    ${ui.notice ? `<div class="notice">${escapeHtml(ui.notice)}</div>` : ""}</div>
    <div class="settings-grid" data-cache-section="summary">
      <div class="settings-panel"><h2>本地目录</h2><div class="setting-row"><span>目录名称</span><strong>${escapeHtml(directory?.name || "尚未选择")}</strong></div><div class="setting-row"><span>访问权限</span><strong class="${directory?.permission === "granted" ? "cached" : ""}">${directory?.permission === "granted" ? "可读写" : directory?.configured ? "需要重新授权" : "未配置"}</strong></div></div>
      <div class="settings-panel"><h2>缓存概览</h2><div class="setting-row"><span>进行中与等待</span><strong>${activeCount}</strong></div><div class="setting-row"><span>本地可用作品</span><strong>${records.length}</strong></div><div class="setting-row"><span>归档副本</span><strong>${locations.length}</strong></div><div class="setting-row"><span>占用空间</span><strong>${formatBytes(totalBytes)}</strong></div></div>
    </div>
    <div class="cache-queue-panel" data-cache-section="queue">
      <div class="cache-panel-heading"><div><h2>缓存队列</h2><p>${current ? "正在处理 1 个任务" : "当前没有正在处理的任务"}${pending.length ? `，另有 ${pending.length} 个等待中` : ""}</p></div><span class="queue-count">${activeCount}</span></div>
      ${current ? `<div class="queue-current"><div class="queue-status-line"><span class="status-dot active"></span><strong>${escapeHtml(current.track.title)}</strong><span data-role="cache-current-status">${escapeHtml(cacheStatusText(activity))}</span></div><div class="queue-meta">${escapeHtml(current.track.creator?.name || "未知UP主")} · ${cacheFormatText(current)}</div>${["downloading", "encoding"].includes(activity?.status) ? `<div class="queue-progress" data-role="cache-progress" aria-label="缓存进度 ${progress}%"><span data-role="cache-progress-bar" style="width:${progress}%"></span></div>` : ""}</div>` : '<div class="queue-empty">缓存作品或合集后，任务会在这里按顺序显示。</div>'}
      ${pending.length ? `<div class="queue-list"><div class="queue-list-title">等待中</div>${pending.map((task, index) => cacheTaskRow(task, `${index + 1}`, "等待中")).join("")}</div>` : ""}
    </div>
    <div data-cache-section="history">${recent.length ? `<div class="cache-history-panel"><div class="cache-panel-heading"><div><h2>最近任务</h2><p>保留本次后台会话最近 ${recent.length} 条结果</p></div></div><div class="queue-list">${recent.slice(0, 20).map(task => cacheTaskRow(task, cacheHistorySymbol(task.status), cacheHistoryText(task))).join("")}</div></div>` : ""}</div>
    <div data-cache-section="files"><div class="cache-files-heading"><div><h2>已缓存文件</h2><p>按本地归档目录展示，共 ${locations.length} 个实体副本</p></div>${locations.length ? `<button class="plain-button" type="button" data-action="toggle-cache-management" ${ui.cacheDeleting ? "disabled" : ""}>${ui.cacheManageMode ? "完成" : "批量管理"}</button>` : ""}</div>
    ${ui.cacheManageMode && library.length ? `<div class="cache-batch-toolbar"><label class="cache-select-label"><input type="checkbox" data-action="toggle-cache-selection" data-key="__all__" ${allSelectionState === "all" ? "checked" : ""} data-indeterminate="${allSelectionState === "some"}">全选</label><span>已选择 ${selection.count} 个 · ${formatBytes(selection.size)}</span><button class="plain-button danger-button" type="button" data-action="delete-selected-cache" ${selection.count && !ui.cacheDeleting ? "" : "disabled"}>${ui.cacheDeleting ? "正在删除…" : "删除所选"}</button></div>` : ""}
    ${library.length ? `<div class="cache-library">${library.map(node => cacheLibraryNodeMarkup(node, 0, busyKeys)).join("")}</div>` : '<div class="download-placeholder"><h2>还没有本地缓存</h2><p>先选择目录，再回到 UP 主页面点击作品或栏目的下载按钮。</p></div>'}</div>
  </section>`;
}

function cacheBusyLocationKeys(info = ui.cacheInfo) {
  return new Set([info?.current, ...(info?.pending ?? [])].map(cacheTaskLocationKey).filter(Boolean));
}

function findCacheLibraryNode(nodes, id) {
  for (const node of nodes) {
    if (node.id === id || node.key === id) return node;
    if (node.kind === "group") {
      const child = findCacheLibraryNode(node.children, id);
      if (child) return child;
    }
  }
  return null;
}

function cacheNodeLocationKeys(node) {
  return node?.kind === "group" ? node.locationKeys : node?.key ? [node.key] : [];
}

function cacheSelectionCheckbox(node, busyKeys) {
  const keys = cacheNodeLocationKeys(node).filter(key => !busyKeys.has(key));
  const state = cacheSelectionState(keys, ui.cacheSelectedLocations);
  return `<input class="cache-select-input" type="checkbox" data-action="toggle-cache-selection" data-key="${escapeHtml(node.id || node.key)}" ${state === "all" ? "checked" : ""} data-indeterminate="${state === "some"}" ${keys.length && !ui.cacheDeleting ? "" : "disabled"} aria-label="选择${escapeHtml(node.label || node.title)}">`;
}

function cacheLibraryNodeMarkup(node, depth = 0, busyKeys = new Set()) {
  if (node.kind === "file") {
    const format = node.format === "mp3" ? `MP3 ${node.bitrate} kbps` : "原始格式";
    const busy = busyKeys.has(node.key);
    return `<div class="cache-file-row">${ui.cacheManageMode ? cacheSelectionCheckbox(node, busyKeys) : '<span class="cache-tree-guide"></span>'}<div class="cache-file-copy"><div class="track-title">${escapeHtml(node.title)}</div><div class="track-subtitle">${escapeHtml(node.bvid || node.trackId)} · ${format}${busy ? " · 缓存任务进行中" : ""}</div></div><span class="track-duration">${formatBytes(node.size)}</span>${ui.cacheManageMode ? "" : `<button class="icon-button danger-button" type="button" data-action="delete-cache-node" data-key="${escapeHtml(node.key)}" aria-label="删除缓存" ${busy || ui.cacheDeleting ? "disabled" : ""}>${symbol("×")}</button>`}</div>`;
  }
  const expanded = ui.cacheExpandedGroups.has(node.id);
  const busy = node.locationKeys.some(key => busyKeys.has(key));
  return `<div class="cache-group" data-cache-group="${escapeHtml(node.id)}"><div class="cache-group-row">${ui.cacheManageMode ? cacheSelectionCheckbox(node, busyKeys) : ""}<button class="cache-group-main" type="button" data-action="toggle-cache-group" data-key="${escapeHtml(node.id)}" aria-expanded="${expanded}"><span class="cache-group-toggle">${symbol(expanded ? "⌄" : "›")}</span><span class="cache-group-copy"><strong>${escapeHtml(node.label)}</strong>${node.subtitle ? `<small>${escapeHtml(node.subtitle)}</small>` : ""}</span><span class="cache-group-meta">${node.count} 个 · ${formatBytes(node.size)}${busy ? " · 有任务进行中" : ""}</span></button>${ui.cacheManageMode ? "" : `<button class="icon-button danger-button" type="button" data-action="delete-cache-node" data-key="${escapeHtml(node.id)}" aria-label="删除${escapeHtml(node.label)}的缓存" ${busy || ui.cacheDeleting ? "disabled" : ""}>${symbol("×")}</button>`}</div>${expanded ? `<div class="cache-group-children">${node.children.map(child => cacheLibraryNodeMarkup(child, depth + 1, busyKeys)).join("")}</div>` : ""}</div>`;
}

function applyCacheSelectionStates(scope = root) {
  scope.querySelectorAll('input[data-indeterminate="true"]').forEach(input => { input.indeterminate = true; });
}

async function deleteCacheNodes(keys, label) {
  const records = ui.cacheInfo?.records ?? [];
  const locations = cacheLibraryLocationMap(records);
  const targets = [...new Set(keys)].map(key => locations.get(key)).filter(Boolean);
  if (!targets.length) throw new Error("没有可删除的缓存文件");
  const busy = cacheBusyLocationKeys();
  if (targets.some(target => busy.has(target.key))) throw new Error("所选缓存仍有任务进行中，请稍后再删除");
  const totalSize = targets.reduce((sum, target) => sum + (Number(target.size) || 0), 0);
  if (!window.confirm(`确定永久删除${label ? `“${label}”对应的` : "所选"} ${targets.length} 个实体缓存文件吗？\n预计释放 ${formatBytes(totalSize)}，此操作无法撤销。`)) return;
  ui.cacheDeleting = true;
  ui.error = "";
  render();
  try {
    ui.cacheInfo = await send(MESSAGE.cacheCommand, {
      command: "deleteCacheLocations",
      payload: { locations: targets.map(target => ({ trackId: target.trackId, locationId: target.locationId })) }
    });
    const result = ui.cacheInfo.deletion ?? {};
    const failed = Number(result.failed) || 0;
    const cleaned = Number(result.cleaned) || 0;
    ui.notice = `已删除 ${Number(result.deleted) || 0} 个缓存文件${cleaned ? `，并清理 ${cleaned} 条失效记录` : ""}，释放 ${formatBytes(result.bytes)}。`;
    ui.error = failed ? `${failed} 个文件未能完整处理，请检查目录权限后重试；必要时可使用“扫描归档”校准索引。` : result.manifestErrors ? `${result.manifestErrors} 个播放列表清单未能同步更新，可稍后使用“扫描归档”修复。` : "";
    ui.cacheSelectedLocations.clear();
    if (!(ui.cacheInfo.records ?? []).length) ui.cacheManageMode = false;
  } finally {
    ui.cacheDeleting = false;
    render();
  }
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
  const format = ui.app.settings.defaultFormat;
  const bitrate = format === "mp3" ? ui.app.settings.mp3Bitrate : null;
  const coverage = cacheCoverageForTracks(tracks, ui.cacheInfo?.records ?? [], {
    scopeKey: `playlist:${playlist.id}`,
    format,
    bitrate
  });
  const records = new Map((ui.cacheInfo?.records ?? []).map(record => [record.trackId, record]));
  return `<section>
    <button class="ghost-button" type="button" data-action="close-playlist">${symbol("←")}返回我的播放列表</button>
    ${ui.error ? `<div class="error-message">${escapeHtml(ui.error)}</div>` : ""}
    ${ui.notice ? `<div class="notice">${escapeHtml(ui.notice)}</div>` : ""}
    <div class="page-heading playlist-heading"><div><h1>${escapeHtml(playlist.name)}</h1><p>${playlist.items.length} 个作品 · ${formatDuration(playlistTotalDuration(playlist))} · 当前列表归档 ${coverage.archivedCount}/${coverage.total} · 本地可用 ${coverage.availableCount}/${coverage.total}</p></div><div class="page-heading-actions"><button class="plain-button" type="button" data-action="rename-playlist" data-id="${escapeHtml(playlist.id)}">重命名</button><button class="ghost-button danger-button" type="button" data-action="delete-playlist" data-id="${escapeHtml(playlist.id)}">删除</button><button class="plain-button" type="button" data-action="cache-playlist" data-id="${escapeHtml(playlist.id)}" ${tracks.length ? "" : "disabled"}>${symbol("⇩")}缓存到列表目录</button><button class="primary-button" type="button" data-action="play-playlist" data-id="${escapeHtml(playlist.id)}" ${tracks.length ? "" : "disabled"}>${symbol("▶")}播放全部</button></div></div>
    <div class="track-table"><div class="track-table-head playlist-table-head"><span>#</span><span>作品</span><span>UP 主</span><span>时长</span><span></span></div>${tracks.length ? tracks.map((track, index) => {
      const record = records.get(track.bvid);
      const inArchive = record?.locations?.some(location => location.scope?.key === `playlist:${playlist.id}`);
      const local = Boolean(record?.locations?.length);
      const cacheLabel = inArchive ? "已归档到当前列表" : local ? "其他本地归档可用" : "仅在线";
      return `<div class="playlist-track-row" draggable="true" data-drag-kind="playlist" data-playlist-id="${escapeHtml(playlist.id)}" data-index="${index}"><span class="track-index drag-handle" title="拖动调整顺序">${String(index + 1).padStart(2, "0")}</span><button class="playlist-track-title" type="button" data-action="play-playlist" data-id="${escapeHtml(playlist.id)}" data-index="${index}"><strong>${escapeHtml(track.title)}</strong><small>${escapeHtml(track.bvid)} · ${cacheLabel}</small></button><span class="playlist-creator">${escapeHtml(track.creator?.name || "未知UP主")}</span><span class="track-duration">${formatDuration(track.duration)}</span><div class="track-actions"><button class="icon-button" type="button" data-action="enqueue-playlist-track" data-id="${escapeHtml(playlist.id)}" data-index="${index}" aria-label="添加到当前队列">${symbol("+")}</button><button class="icon-button" type="button" data-action="move-playlist-track" data-id="${escapeHtml(playlist.id)}" data-index="${index}" data-to="${index - 1}" aria-label="上移" ${index === 0 ? "disabled" : ""}>${symbol("↑")}</button><button class="icon-button" type="button" data-action="move-playlist-track" data-id="${escapeHtml(playlist.id)}" data-index="${index}" data-to="${index + 1}" aria-label="下移" ${index === tracks.length - 1 ? "disabled" : ""}>${symbol("↓")}</button><button class="icon-button danger-button" type="button" data-action="remove-playlist-track" data-id="${escapeHtml(playlist.id)}" data-bvid="${escapeHtml(track.bvid)}" aria-label="从播放列表移除">${symbol("×")}</button></div></div>`;
    }).join("") : '<div class="queue-empty">这个播放列表还没有作品。</div>'}</div>
  </section>`;
}

function playlistsPage() {
  const playlist = activePlaylist();
  if (playlist) return playlistDetail(playlist);
  return `<section>${ui.error ? `<div class="error-message">${escapeHtml(ui.error)}</div>` : ""}${ui.notice ? `<div class="notice">${escapeHtml(ui.notice)}</div>` : ""}<div class="page-heading"><div><h1>我的播放列表</h1><p>跨 UP 主保存作品和固定播放顺序</p></div><div class="page-heading-actions"><button class="plain-button" type="button" data-action="import-playlists">${symbol("⇧")}导入</button><button class="plain-button" type="button" data-action="export-playlists">${symbol("⇩")}导出</button><input class="visually-hidden" type="file" accept="application/json,.json" data-role="playlist-import-file"></div></div><form class="playlist-create-form" data-form="create-playlist"><input name="name" maxlength="80" placeholder="新播放列表名称" aria-label="新播放列表名称"><button class="primary-button" type="submit">${symbol("+")}创建</button></form>${playlistCards()}</section>`;
}

function favoriteSectionCard(favorite) {
  const section = favoriteSectionToSection(favorite);
  const typeLabel = favorite.type === "season" ? "合集" : "系列";
  const loading = ui.loadingSectionKey === section.key;
  const hasCover = Boolean(section.cover);
  const total = Number.isFinite(section.total) ? `${section.total} 个作品` : "作品数待刷新";
  const leading = `<span class="section-toggle favorite-section-icon" aria-hidden="true">${symbol("★")}</span>${hasCover ? `<button class="section-cover-button" type="button" data-action="open-favorite-section" data-key="${escapeHtml(favorite.key)}" aria-label="进入 ${escapeHtml(section.title)} 详情">${image(section.cover, `${section.title}封面`, "section-cover")}</button>` : ""}`;
  return `<article class="section-card favorite-section-card ${hasCover ? "has-cover" : ""}"><div class="section-header">${leading}<button class="section-title-button" type="button" data-action="open-favorite-section" data-key="${escapeHtml(favorite.key)}"><h2 class="section-title">${escapeHtml(section.title)}</h2><span class="section-meta">${typeLabel} · ${escapeHtml(favorite.creatorName)} · ${total}</span></button><div class="section-actions"><button class="icon-button" type="button" data-action="play-favorite-section" data-key="${escapeHtml(favorite.key)}" aria-label="${loading ? "正在读取全部作品" : "播放全部"}" ${loading ? "disabled" : ""}>${symbol(loading ? "◌" : "▶", loading ? "spinner" : "")}</button><button class="icon-button" type="button" data-action="remove-favorite-section" data-key="${escapeHtml(favorite.key)}" aria-label="取消收藏">${symbol("★")}</button><button class="ghost-button" type="button" data-action="open-favorite-section" data-key="${escapeHtml(favorite.key)}">进入详情</button></div></div></article>`;
}

function favoriteSectionsPage() {
  const favorites = [...(ui.app?.favoriteSections ?? [])].sort((left, right) => Number(right.addedAt) - Number(left.addedAt));
  const refreshState = ui.favoriteMetadataLoading ? '<div class="notice">正在在线刷新收藏栏目的封面和作品信息……</div>' : ui.favoriteMetadataError ? `<div class="notice">${escapeHtml(ui.favoriteMetadataError)}</div>` : "";
  return `<section>${ui.error ? `<div class="error-message">${escapeHtml(ui.error)}</div>` : ""}${ui.notice ? `<div class="notice">${escapeHtml(ui.notice)}</div>` : ""}${refreshState}<div class="page-heading"><div><h1>收藏的合集与系列</h1><p>跨 UP 主快速打开你保存的优质栏目</p></div></div>${favorites.length ? favorites.map(favoriteSectionCard).join("") : '<div class="download-placeholder"><h2>还没有收藏栏目</h2><p>在 UP 主主页或合集、系列详情页点击收藏，之后就能在这里直接打开。</p></div>'}</section>`;
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
  return task.message || "已完成";
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
  if (activity.status === "failed") return `失败：${activity.message || "未知错误"}`;
  if (activity.status === "completed") return "缓存完成";
  if (activity.status === "skipped") return "已经缓存";
  if (activity.status === "decoding") return "正在解码原始音频";
  if (activity.status === "copying") return activity.message || "正在从其他本地归档复制";
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
  if (ui.view === "favorites") return favoriteSectionsPage();
  if (ui.view === "downloads") return downloadsPage();
  if (ui.view === "settings") return settingsPage();
  return creatorPage();
}

function playerMarkup() {
  const player = ui.app?.player ?? {};
  const track = player.currentTrack;
  const modeLabel = playbackModeLabel(player.mode);
  const playbackRate = normalizePlaybackRate(player.playbackRate);
  const playbackVolume = normalizePlaybackVolume(player.volume);
  const volumePercent = playbackVolumePercent(playbackVolume);
  const progressMax = Math.max(1, Number(player.duration) || Number(track?.duration) || 1);
  const sourceLabel = playbackSourceLabel(player.source, player.loading);
  return `<footer class="player-bar">
    <div class="now-playing">${image(track?.cover, track?.title ?? "尚未播放", "now-cover")}<div class="now-copy"><div class="now-title">${escapeHtml(track?.title ?? "选择一个作品开始播放")}</div><div class="now-meta"><span class="muted">${escapeHtml(track?.creator?.name ?? "哔哩音频")}</span>${sourceLabel ? `<span class="source-badge ${player.source?.kind === "cache" ? "local" : ""}">${escapeHtml(sourceLabel)}</span>` : ""}${player.error ? `<span class="player-error">${escapeHtml(player.error)}</span>` : ""}</div></div></div>
    <div class="player-controls"><button class="icon-button" type="button" data-action="change-mode" aria-label="${modeLabel}">${symbol(player.mode === "shuffle" ? "⤨" : player.mode === "single" ? "①" : "↻")}</button><button class="icon-button" type="button" data-action="previous" aria-label="上一首">${symbol("◀|")}</button><button class="play-main" type="button" data-action="${player.playing ? "pause" : "resume"}" aria-label="${player.playing ? "暂停" : "播放"}">${symbol(player.playing ? "Ⅱ" : "▶")}</button><button class="icon-button" type="button" data-action="next" aria-label="下一首">${symbol("|▶")}</button><div class="volume-control"><button class="volume-toggle ${ui.volumeOpen ? "active" : ""}" type="button" data-action="toggle-volume" aria-expanded="${ui.volumeOpen}" aria-label="音量，当前 ${volumePercent}%${playbackVolume > 1 ? "（增强）" : ""}">${symbol(playbackVolume === 0 ? "🔇" : playbackVolume > 1 ? "🔊+" : "🔊")}</button>${ui.volumeOpen ? `<section class="volume-panel" aria-label="音量调节"><output class="slider-value" data-role="volume-value">${volumePercent}%${playbackVolume > 1 ? " · 增强" : ""}</output><div class="volume-range"><span aria-hidden="true">0</span><input class="volume-input" type="range" min="${PLAYBACK_VOLUME_MIN}" max="${PLAYBACK_VOLUME_MAX}" step="0.01" value="${playbackVolume}" data-action="set-volume-slider" aria-label="音量，当前 ${volumePercent}%${playbackVolume > 1 ? "，增强" : ""}"><span aria-hidden="true">200%</span></div><p>超过 100% 为增强，部分音源可能失真。</p></section>` : ""}</div><div class="speed-control"><button class="speed-toggle ${ui.rateOpen ? "active" : ""}" type="button" data-action="toggle-rate" aria-expanded="${ui.rateOpen}" aria-label="播放倍速，当前 ${playbackRateLabel(playbackRate)}">${playbackRateLabel(playbackRate)}</button>${ui.rateOpen ? `<section class="speed-panel" aria-label="播放倍速"><output class="slider-value" data-role="rate-value">${playbackRateLabel(playbackRate)}</output><div class="speed-range"><span aria-hidden="true">${PLAYBACK_RATE_MIN}×</span><input class="speed-input" type="range" min="${PLAYBACK_RATE_MIN}" max="${PLAYBACK_RATE_MAX}" step="${PLAYBACK_RATE_STEP}" value="${playbackRate}" data-action="set-rate-slider" aria-label="精细调节播放倍速，当前 ${playbackRateLabel(playbackRate)}"><span aria-hidden="true">${PLAYBACK_RATE_MAX}×</span></div></section>` : ""}</div><button class="queue-toggle ${ui.queueOpen ? "active" : ""}" type="button" data-action="toggle-play-queue" aria-expanded="${ui.queueOpen}" aria-label="查看播放队列">${symbol("☷")}<span>${player.queue?.length ?? 0}</span></button></div>
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
    <div class="play-queue-list">${queue.length ? queue.map((track, index) => `<div class="play-queue-row ${index === currentIndex ? "current" : ""}" draggable="true" data-drag-kind="queue" data-index="${index}" data-queue-index="${index}"><button class="queue-track-button" type="button" data-action="play-queue-index" data-index="${index}"><span class="queue-position drag-handle" title="拖动调整顺序">${index === currentIndex ? "♫" : index + 1}</span><span><strong>${escapeHtml(track.title)}</strong><small>${escapeHtml(track.creator?.name || "未知UP主")} · ${formatDuration(track.duration)}</small></span></button><div class="queue-row-actions"><button class="icon-button" type="button" data-action="move-queue-item" data-index="${index}" data-to="${index - 1}" aria-label="上移" ${index === 0 ? "disabled" : ""}>${symbol("↑")}</button><button class="icon-button" type="button" data-action="move-queue-item" data-index="${index}" data-to="${index + 1}" aria-label="下移" ${index === queue.length - 1 ? "disabled" : ""}>${symbol("↓")}</button>${index !== currentIndex && index !== currentIndex + 1 ? `<button class="queue-next-button" type="button" data-action="move-queue-item" data-index="${index}" data-to="${Math.min(currentIndex + 1, queue.length - 1)}">下一首</button>` : ""}<button class="icon-button danger-button" type="button" data-action="remove-queue-item" data-index="${index}" aria-label="移出队列">${symbol("×")}</button></div></div>`).join("") : '<div class="queue-empty">从作品列表点击“+”即可添加到这里。</div>'}</div>
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

function playlistImportPreviewMarkup() {
  const preview = ui.playlistImportPreview;
  if (!preview) return "";
  const currentIds = new Set((ui.app?.playlists ?? []).map(playlist => playlist.id));
  const conflicts = preview.playlists.filter(playlist => currentIds.has(playlist.id)).length;
  return `<div class="modal-backdrop" data-action="close-playlist-import"><section class="playlist-picker import-preview" role="dialog" aria-modal="true" aria-label="预览播放列表导入"><div class="playlist-picker-header"><div><h2>预览导入</h2><p>${escapeHtml(preview.fileName)}</p></div><button class="icon-button" type="button" data-action="close-playlist-import" aria-label="关闭">${symbol("×")}</button></div><div class="import-summary"><strong>${preview.playlistCount}</strong><span>个播放列表</span><strong>${preview.itemCount}</strong><span>个作品</span></div>${conflicts ? `<div class="notice">检测到 ${conflicts} 个同 ID 播放列表。合并时会保留两份，并将导入副本标记为“（导入）”。</div>` : ""}<p class="import-help">备份仅包含 BV 号、标题、时长、UP 主信息和添加时间，不包含音频文件或缓存路径。</p><div class="import-actions"><button class="plain-button" type="button" data-action="confirm-playlist-import" data-mode="merge">合并到现有列表</button><button class="danger-button" type="button" data-action="confirm-playlist-import" data-mode="replace">替换现有列表</button></div></section></div>`;
}

function directoryPermissionPromptMarkup() {
  const directory = ui.cacheInfo?.directory;
  if (!ui.directoryPermissionPrompt || !needsCacheDirectoryReauthorization(directory)) return "";
  return `<div class="modal-backdrop" data-action="dismiss-directory-permission"><section class="permission-dialog" role="dialog" aria-modal="true" aria-label="缓存目录需要重新授权"><div class="permission-dialog-icon">${symbol("▣")}</div><div><h2>本地缓存目录需要重新授权</h2><p>“${escapeHtml(directory.name || "已选择的目录")}”当前不可访问。重新授权前，已缓存的音频不会被识别，播放会回退到在线资源。</p></div><div class="permission-dialog-actions"><button class="ghost-button" type="button" data-action="dismiss-directory-permission">稍后处理</button><button class="primary-button" type="button" data-action="reauthorize-directory">重新授权目录</button></div></section></div>`;
}

function render() {
  root.innerHTML = `<div class="shell"><div class="cache-toast-host">${cacheToastMarkup()}</div>${topbar()}<div class="workspace">${sidebar()}<main class="content">${mainContent()}</main></div><div class="player-slot">${playerAreaMarkup()}</div>${playlistPickerMarkup()}${playlistImportPreviewMarkup()}${directoryPermissionPromptMarkup()}</div>`;
  renderedPlayerKey = playerStructureKey(ui.app?.player, { queueOpen: ui.queueOpen });
  applyIconTooltips(root);
  applyCacheSelectionStates(root);
}

function updatePlayerProgress(slot) {
  const player = ui.app?.player ?? {};
  const progressMax = Math.max(1, Number(player.duration) || Number(player.currentTrack?.duration) || 1);
  const currentTime = Math.min(Number(player.currentTime) || 0, progressMax);
  const input = slot.querySelector(".progress-input");
  if (input) {
    input.max = String(progressMax);
    if (document.activeElement !== input) input.value = String(currentTime);
  }
  const label = slot.querySelector(".time-label");
  if (label) label.textContent = `${formatDuration(player.currentTime)} / ${formatDuration(progressMax)}`;
}

function renderPlayer({ force = false } = {}) {
  const slot = root.querySelector(".player-slot");
  if (slot) {
    const nextKey = playerStructureKey(ui.app?.player, { queueOpen: ui.queueOpen });
    if (!force && nextKey === renderedPlayerKey) {
      updatePlayerProgress(slot);
      return;
    }
    const previousQueue = slot.querySelector(".play-queue-list");
    const scrollTop = previousQueue ? previousQueue.scrollTop : null;
    slot.innerHTML = playerAreaMarkup();
    renderedPlayerKey = nextKey;
    applyIconTooltips(slot);
    if (scrollTop !== null) {
      const nextQueue = slot.querySelector(".play-queue-list");
      if (nextQueue) nextQueue.scrollTop = scrollTop;
    }
  }
}

function updateCacheNavCount() {
  const badge = root.querySelector('[data-role="cache-nav-count"]');
  if (!badge) return;
  const count = cacheWorkCount();
  badge.textContent = count ? String(count) : "";
  badge.hidden = !count;
  badge.setAttribute("aria-label", `${count} 个缓存任务`);
}

function patchCacheProgress() {
  const activity = ui.cacheInfo?.activity ?? ui.cacheActivity ?? {};
  const status = root.querySelector('[data-role="cache-current-status"]');
  if (status) status.textContent = cacheStatusText(activity);
  const progress = Math.max(0, Math.min(100, Math.round(Number(activity.progress ?? 0) * 100)));
  const progressHost = root.querySelector('[data-role="cache-progress"]');
  const progressBar = root.querySelector('[data-role="cache-progress-bar"]');
  if (progressHost) progressHost.setAttribute("aria-label", `缓存进度 ${progress}%`);
  if (progressBar) progressBar.style.width = `${progress}%`;
}

function replaceCacheSections() {
  const content = root.querySelector(".content");
  if (!content) return;
  const template = document.createElement("template");
  template.innerHTML = downloadsPage();
  ["heading", "summary", "queue", "history", "files"].forEach(name => {
    const current = content.querySelector(`[data-cache-section="${name}"]`);
    const next = template.content.querySelector(`[data-cache-section="${name}"]`);
    if (current && next) current.replaceWith(next);
  });
  applyIconTooltips(content);
  applyCacheSelectionStates(content);
}

function renderCacheState({ progressOnly = false } = {}) {
  updateCacheNavCount();
  if (ui.view === "downloads") {
    if (progressOnly) patchCacheProgress();
    else replaceCacheSections();
  }
  renderCacheToast();
}

function queueContextForSection(section) {
  const creator = creatorForSection(section);
  return {
    kind: section.type,
    id: String(section.id),
    creatorId: String(creator?.id || ""),
    title: `${creator?.name || "UP 主"} · ${section.title}`
  };
}

function currentSearchResults() {
  if (!ui.activeSection || !ui.trackSearchKeyword) return [];
  const items = ui.detailData?.items ?? ui.activeSection.items ?? [];
  return sortTracksByPublishedAt(filterTracksByKeyword(items, ui.trackSearchKeyword), currentTrackSortDirection());
}

function searchQueueContext() {
  const creator = creatorForSection(ui.activeSection);
  return {
    kind: "search",
    title: `搜索结果 · ${creator?.name || "UP 主"} / ${ui.activeSection?.title || "栏目"} / ${ui.trackSearchKeyword}`
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
  if (!ui.searchKeyword) {
    ui.searchResults = [];
    ui.searchOpen = false;
    ui.searching = false;
    render();
    return;
  }
  ui.searchOpen = true;
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
  ui.detailOrigin = "creator";
  await openSectionDetail(section);
}

async function openFavoriteSection(key) {
  const favorite = (ui.app?.favoriteSections ?? []).find(item => item.key === key);
  if (!favorite) throw new Error("收藏的栏目不存在");
  ui.detailOrigin = "favorites";
  await refreshFavoriteSectionMetadata();
  await openSectionDetail(favoriteSectionToSection(favorite));
}

async function openSectionDetail(section) {
  const creator = creatorForSection(section);
  if (!creator) throw new Error("未找到栏目的所属 UP 主");
  ui.activeSection = section;
  ui.detailData = null;
  ui.detailPage = 1;
  ui.trackSearchKeyword = "";
  ui.view = "detail";
  ui.loading = true;
  ui.error = "";
  ui.notice = "";
  render();
  try {
    const pageSize = section.type === "all" ? 50 : 100;
    if (currentTrackSortDirection() === "desc") {
      const result = await loadAllSectionPages(
        (page, size) => send(MESSAGE.loadSection, {
          creatorId: creator.id,
          section: { id: section.id, type: section.type },
          page,
          pageSize: size
        }),
        {
          pageSize,
          onProgress: ({ items, total }) => {
            ui.notice = `正在读取“${section.title}”：${Math.min(items.length, total)} / ${total}`;
            render();
          }
        }
      );
      ui.detailData = { ...result, pageSize };
      ui.detailPage = result.page;
      ui.notice = "";
    } else {
      ui.detailData = await send(MESSAGE.loadSection, {
        creatorId: creator.id,
        section: { id: section.id, type: section.type },
        page: 1,
        pageSize
      });
    }
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
        creatorId: creatorForSection(section)?.id,
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
    if (currentTrackSortDirection() === "desc") {
      const creator = creatorForSection(section);
      const pageSize = section.type === "all" ? 50 : 100;
      const result = await loadAllSectionPages(
        (page, size) => send(MESSAGE.loadSection, {
          creatorId: creator?.id,
          section: { id: section.id, type: section.type },
          page,
          pageSize: size
        }),
        { pageSize }
      );
      ui.detailData = { ...result, pageSize };
      ui.detailPage = result.page;
      return;
    }
    const nextPage = ui.detailPage + 1;
    const listing = await send(MESSAGE.loadSection, {
      creatorId: creatorForSection(section)?.id,
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

async function loadCompleteSection(section) {
  if (!section) throw new Error("未找到要播放的栏目");
  const creator = creatorForSection(section);
  if (!creator) throw new Error("请先选择一个 UP 主");
  const pageSize = section.type === "all" ? 50 : 100;
  ui.loadingSectionKey = section.key;
  ui.error = "";
  ui.notice = `正在读取“${section.title}”的全部作品…`;
  render();
  try {
    const result = await loadAllSectionPages(
      (page, size) => send(MESSAGE.loadSection, {
        creatorId: creator.id,
        section: { id: section.id, type: section.type },
        page,
        pageSize: size
      }),
      {
        pageSize,
        onProgress: ({ items, total }) => {
          ui.notice = `正在读取“${section.title}”：${Math.min(items.length, total)} / ${total}`;
          render();
        }
      }
    );
    if (ui.activeSection?.key === section.key) {
      ui.detailData = { items: result.items, total: result.total, page: result.page, pageSize };
      ui.detailPage = result.page;
    }
    if (!result.items.length) throw new Error("当前栏目没有可播放的作品");
    return result.items;
  } catch (error) {
    ui.notice = "";
    throw error;
  } finally {
    ui.loadingSectionKey = null;
    render();
  }
}

function queueForSection(section, items = section.items ?? []) {
  return sortTracksByPublishedAt(items, currentTrackSortDirection()).map(track => trackWithContext(track, section));
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

async function favoriteSectionCommand(command, payload = {}) {
  ui.app.favoriteSections = await send(MESSAGE.favoriteSectionCommand, { command, payload });
  return ui.app.favoriteSections;
}

async function refreshFavoriteSectionMetadata() {
  if (favoriteMetadataRequest) return favoriteMetadataRequest;
  ui.favoriteMetadataLoading = true;
  ui.favoriteMetadataError = "";
  favoriteMetadataRequest = (async () => {
    try {
      const result = await send(MESSAGE.favoriteSectionCommand, { command: "hydrateMetadata" });
      const metadata = Object.fromEntries((result.items ?? []).map(item => [item.key, item]));
      ui.favoriteMetadata = { ...ui.favoriteMetadata, ...metadata };
      if (result.failedCreatorIds?.length) {
        ui.favoriteMetadataError = `部分收藏栏目的在线资料暂时无法刷新（${result.failedCreatorIds.length} 位 UP 主）。`;
      }
      return result;
    } catch (error) {
      ui.favoriteMetadataError = `收藏栏目的在线资料暂时无法刷新：${toErrorMessage(error)}`;
      return { items: [], failedCreatorIds: [] };
    } finally {
      ui.favoriteMetadataLoading = false;
      favoriteMetadataRequest = null;
    }
  })();
  return favoriteMetadataRequest;
}

async function toggleFavoriteSection(section) {
  if (!section || !["season", "series"].includes(section.type)) {
    throw new Error("只能收藏合集或系列");
  }
  const payload = favoriteSectionPayload(section);
  const existing = (ui.app.favoriteSections ?? []).find(item => item.key === `${payload.creatorId}:${payload.type}:${payload.sectionId}`);
  if (existing) {
    await favoriteSectionCommand("remove", { key: existing.key });
    delete ui.favoriteMetadata[existing.key];
    ui.notice = `已取消收藏“${section.title}”。`;
    return false;
  }
  await favoriteSectionCommand("add", { section: payload });
  const favorite = ui.app.favoriteSections.find(item => item.key === `${payload.creatorId}:${payload.type}:${payload.sectionId}`);
  if (favorite) {
    ui.favoriteMetadata[favorite.key] = {
      key: favorite.key,
      title: section.title,
      total: Math.max(0, Number(section.total) || 0),
      cover: section.cover || "",
      available: true
    };
  }
  ui.notice = `已收藏“${section.title}”，可在“收藏的合集与系列”中直接打开。`;
  return true;
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

function exportPlaylists() {
  const text = serializePlaylistExport(ui.app?.playlists ?? [], {
    appVersion: chrome.runtime.getManifest().version
  });
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `哔哩音频-播放列表-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  ui.notice = `已导出 ${ui.app?.playlists?.length ?? 0} 个播放列表。`;
  render();
}

async function previewPlaylistImport(file) {
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) throw new Error("导入文件不能超过 5 MB");
  const parsed = parsePlaylistExport(await file.text());
  ui.playlistImportPreview = { ...parsed, fileName: file.name };
  ui.error = "";
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
  const snapshot = await send(MESSAGE.cacheCommand, {
    command: "cacheTracks",
    payload: {
      tracks: contextual,
      section: { id: section.id, type: section.type, title: section.title },
      format: ui.app.settings.defaultFormat,
      bitrate: ui.app.settings.mp3Bitrate
    }
  });
  ui.cacheInfo = { ...(ui.cacheInfo ?? {}), ...snapshot };
  ui.notice = `已将 ${contextual.length} 个作品加入缓存队列。`;
  showCacheToast(`已将 ${contextual.length} 个作品加入缓存队列`, snapshot);
  await refreshCacheInfo();
  renderCacheState();
}

async function cachePlaylistArchive(playlist) {
  const tracks = playlist.items.map(playlistItemToTrack);
  if (!tracks.length) throw new Error("播放列表没有可缓存的作品");
  const snapshot = await send(MESSAGE.cacheCommand, {
    command: "cacheTracks",
    payload: {
      tracks,
      section: { id: playlist.id, type: "playlist", title: playlist.name },
      format: ui.app.settings.defaultFormat,
      bitrate: ui.app.settings.mp3Bitrate
    }
  });
  ui.cacheInfo = { ...(ui.cacheInfo ?? {}), ...snapshot };
  ui.notice = `“${playlist.name}”的 ${tracks.length} 个作品已加入列表归档队列；已有其他本地副本时会优先复制。`;
  showCacheToast(`已将 ${tracks.length} 个作品加入“${playlist.name}”缓存队列`, snapshot);
  await refreshCacheInfo();
  renderCacheState();
}

async function cacheWholeSection(section) {
  const creator = creatorForSection(section);
  if (!creator) throw new Error("未找到栏目的所属 UP 主");
  ui.notice = `正在读取“${section.title}”的全部作品……`;
  renderCacheState();
  const pageSize = 100;
  let page = 1;
  let accepted = 0;
  let total = Number(section.total) || 0;
  while (page === 1 || accepted < total) {
    const listing = await send(MESSAGE.loadSection, {
      creatorId: creator.id,
      section: { id: section.id, type: section.type },
      page,
      pageSize
    });
    total = Number(listing.total) || total;
    if (!listing.items.length) break;
    const contextual = listing.items.map(track => trackWithContext(track, section));
    const snapshot = await send(MESSAGE.cacheCommand, {
      command: "cacheTracks",
      payload: {
        tracks: contextual,
        section: { id: section.id, type: section.type, title: section.title },
        format: ui.app.settings.defaultFormat,
        bitrate: ui.app.settings.mp3Bitrate
      }
    });
    ui.cacheInfo = { ...(ui.cacheInfo ?? {}), ...snapshot };
    accepted += listing.items.length;
    ui.notice = `正在加入缓存队列：${Math.min(accepted, total)} / ${total}`;
    showCacheToast(`已将 ${Math.min(accepted, total)} 个作品加入缓存队列`, snapshot);
    renderCacheState();
    if (listing.items.length < pageSize || accepted >= total) break;
    page += 1;
  }
  ui.notice = `“${section.title}”的 ${Math.min(accepted, total)} 个作品已加入缓存队列。`;
  showCacheToast(`已将 ${Math.min(accepted, total)} 个作品加入缓存队列`, ui.cacheInfo);
  await refreshCacheInfo();
  renderCacheState();
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

root.addEventListener("focusin", event => {
  if (!event.target.matches('[data-role="creator-search-input"]') || ui.searchOpen
    || (!ui.searchKeyword && !ui.searchResults.length && !ui.searching)) return;
  ui.searchOpen = true;
  render();
  requestAnimationFrame(() => root.querySelector('[data-role="creator-search-input"]')?.focus());
});

document.addEventListener("keydown", event => {
  const target = event.target;
  const editable = Boolean(target?.matches?.("input, textarea, select, [contenteditable=\"true\"]") || target?.isContentEditable);
  if (event.key === "Escape" && (ui.rateOpen || ui.volumeOpen)) {
    ui.rateOpen = false;
    ui.volumeOpen = false;
    renderPlayer({ force: true });
    return;
  }
  if (event.key === "Escape" && ui.searchOpen) {
    ui.searchOpen = false;
    render();
    return;
  }
  const isSlash = event.key === "/" || (event.code === "Slash" && !event.shiftKey);
  if (isSlash && !editable && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    ui.searchOpen = true;
    const focusSearch = () => root.querySelector('[data-role="creator-search-input"]')?.focus();
    if (root.querySelector('[data-role="creator-search-input"]')) focusSearch();
    else {
      render();
      requestAnimationFrame(focusSearch);
    }
  }
});

root.addEventListener("change", async event => {
  if (event.target.matches('[data-role="playlist-import-file"]')) {
    try {
      await previewPlaylistImport(event.target.files?.[0]);
    } catch (error) {
      ui.error = toErrorMessage(error);
      render();
    }
    return;
  }
  const follow = event.target.closest('[data-action="follow-section"]');
  if (follow) {
    const section = ui.activeSection;
    const creator = creatorForSection(section);
    const items = ui.detailData?.items ?? section.items ?? [];
    try {
      ui.app.subscriptions = await send(MESSAGE.setSubscription, {
        creatorId: creator.id,
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
  if (event.target.matches('[data-action="set-rate-slider"]')) {
    const rate = normalizePlaybackRate(event.target.value);
    event.target.setAttribute("aria-label", `精细调节播放倍速，当前 ${playbackRateLabel(rate)}`);
    const value = event.target.closest(".speed-panel")?.querySelector('[data-role="rate-value"]');
    if (value) value.textContent = playbackRateLabel(rate);
  }
  if (event.target.matches('[data-action="set-volume-slider"]')) {
    const volume = normalizePlaybackVolume(event.target.value);
    event.target.setAttribute("aria-label", `音量，当前 ${playbackVolumePercent(volume)}%${volume > 1 ? "，增强" : ""}`);
    const value = event.target.closest(".volume-panel")?.querySelector('[data-role="volume-value"]');
    if (value) value.textContent = `${playbackVolumePercent(volume)}%${volume > 1 ? " · 增强" : ""}`;
    playerCommand("volume", { volume });
  }
});

root.addEventListener("change", event => {
  if (event.target.matches('[data-action="set-rate-slider"]')) {
    const rate = normalizePlaybackRate(event.target.value);
    playerCommand("rate", { rate });
  }
});

root.addEventListener("dragstart", event => {
  const row = event.target.closest("[data-drag-kind]");
  if (!row || !event.target.closest(".drag-handle")) {
    event.preventDefault();
    return;
  }
  draggedRow = {
    kind: row.dataset.dragKind,
    index: Number(row.dataset.index),
    playlistId: row.dataset.playlistId || ""
  };
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", `${draggedRow.kind}:${draggedRow.index}`);
  requestAnimationFrame(() => row.classList.add("dragging"));
});

root.addEventListener("dragover", event => {
  const row = event.target.closest("[data-drag-kind]");
  if (!row || !draggedRow || row.dataset.dragKind !== draggedRow.kind
    || (draggedRow.kind === "playlist" && row.dataset.playlistId !== draggedRow.playlistId)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  root.querySelectorAll(".drag-over").forEach(item => item.classList.remove("drag-over"));
  row.classList.add("drag-over");
});

root.addEventListener("drop", async event => {
  const row = event.target.closest("[data-drag-kind]");
  if (!row || !draggedRow || row.dataset.dragKind !== draggedRow.kind) return;
  event.preventDefault();
  const fromIndex = draggedRow.index;
  const toIndex = Number(row.dataset.index);
  const kind = draggedRow.kind;
  const playlistId = draggedRow.playlistId;
  draggedRow = null;
  if (fromIndex === toIndex) {
    row.classList.remove("drag-over", "dragging");
    return;
  }
  try {
    if (kind === "queue") await playerCommand("reorderQueue", { fromIndex, toIndex });
    else if (kind === "playlist" && row.dataset.playlistId === playlistId) {
      await playlistCommand("reorderTrack", { playlistId, fromIndex, toIndex });
      render();
    }
  } catch (error) {
    ui.error = toErrorMessage(error);
    render();
  }
});

root.addEventListener("dragend", () => {
  draggedRow = null;
  root.querySelectorAll(".dragging, .drag-over").forEach(item => item.classList.remove("dragging", "drag-over"));
});

root.addEventListener("click", async event => {
  if ((ui.rateOpen || ui.volumeOpen) && !event.target.closest(".speed-control, .volume-control")) {
    ui.rateOpen = false;
    ui.volumeOpen = false;
    renderPlayer({ force: true });
  }
  if (ui.searchOpen && !event.target.closest(".search-form")) {
    ui.searchOpen = false;
    render();
  }
  const button = event.target.closest("[data-action]");
  if (!button || button.disabled) return;
  const action = button.dataset.action;
  try {
    if (action === "close-search") { ui.searchOpen = false; render(); }
    else if (action === "show-creator") {
      ui.view = ui.detailOrigin === "favorites" ? "favorites" : "creator";
      ui.activeSection = null;
      ui.detailData = null;
      ui.detailOrigin = "creator";
      ui.error = "";
      render();
    }
    else if (action === "show-playlists") { ui.view = "playlists"; ui.activePlaylistId = null; ui.error = ""; render(); }
    else if (action === "show-favorite-sections") {
      ui.view = "favorites";
      ui.activeSection = null;
      ui.detailData = null;
      ui.detailOrigin = "creator";
      ui.error = "";
      render();
      refreshFavoriteSectionMetadata().then(() => {
        if (ui.view === "favorites") render();
      });
    }
    else if (action === "export-playlists") exportPlaylists();
    else if (action === "import-playlists") {
      const input = root.querySelector('[data-role="playlist-import-file"]');
      if (input) { input.value = ""; input.click(); }
    }
    else if (action === "close-playlist-import") {
      if (event.target === button || button.closest(".playlist-picker-header")) {
        ui.playlistImportPreview = null;
        render();
      }
    }
    else if (action === "dismiss-directory-permission") {
      if (event.target === button || button.closest(".permission-dialog-actions")) {
        ui.directoryPermissionPrompt = false;
        render();
      }
    }
    else if (action === "reauthorize-directory") {
      const directory = await reauthorizeCacheDirectory();
      await send(MESSAGE.cacheCommand, { command: "refreshDirectory" });
      await refreshCacheInfo();
      ui.directoryPermissionPrompt = false;
      ui.notice = `缓存目录“${directory.name}”已重新授权，本地缓存已恢复可用。`;
      render();
    }
    else if (action === "confirm-playlist-import") {
      const preview = ui.playlistImportPreview;
      const mode = button.dataset.mode;
      if (!preview) return;
      if (mode === "replace" && !window.confirm("确定用导入内容替换现有全部播放列表吗？此操作不会删除音频缓存。")) return;
      await playlistCommand("import", { playlists: preview.playlists, mode });
      ui.playlistImportPreview = null;
      ui.notice = `已${mode === "replace" ? "替换" : "合并"} ${preview.playlistCount} 个播放列表，共 ${preview.itemCount} 个作品。`;
      render();
    }
    else if (action === "show-downloads") { ui.view = "downloads"; render(); }
    else if (action === "toggle-cache-group") {
      ui.cacheExpandedGroups.has(button.dataset.key)
        ? ui.cacheExpandedGroups.delete(button.dataset.key)
        : ui.cacheExpandedGroups.add(button.dataset.key);
      replaceCacheSections();
    }
    else if (action === "toggle-cache-management") {
      ui.cacheManageMode = !ui.cacheManageMode;
      if (!ui.cacheManageMode) ui.cacheSelectedLocations.clear();
      replaceCacheSections();
    }
    else if (action === "toggle-cache-selection") {
      const library = buildCacheLibrary(ui.cacheInfo?.records ?? []);
      const locations = cacheLibraryLocationMap(ui.cacheInfo?.records ?? []);
      const node = button.dataset.key === "__all__" ? null : findCacheLibraryNode(library, button.dataset.key);
      const busy = cacheBusyLocationKeys();
      const keys = (node ? cacheNodeLocationKeys(node) : [...locations.keys()]).filter(key => !busy.has(key));
      keys.forEach(key => button.checked ? ui.cacheSelectedLocations.add(key) : ui.cacheSelectedLocations.delete(key));
      replaceCacheSections();
    }
    else if (action === "delete-cache-node") {
      const node = findCacheLibraryNode(buildCacheLibrary(ui.cacheInfo?.records ?? []), button.dataset.key);
      await deleteCacheNodes(cacheNodeLocationKeys(node), node?.label || node?.title || "缓存文件");
    }
    else if (action === "delete-selected-cache") {
      await deleteCacheNodes([...ui.cacheSelectedLocations], "");
    }
    else if (action === "show-settings") { ui.view = "settings"; render(); }
    else if (action === "open-cache-queue") { ui.view = "downloads"; ui.cacheToast = null; render(); }
    else if (action === "dismiss-cache-toast") { ui.cacheToast = null; renderCacheToast(); }
    else if (action === "open-full") await send(MESSAGE.openPlayer);
    else if (action === "toggle-play-queue") {
      ui.rateOpen = false;
      ui.volumeOpen = false;
      ui.queueOpen = !ui.queueOpen;
      renderPlayer();
      if (ui.queueOpen) requestAnimationFrame(() => root.querySelector(".play-queue-row.current")?.scrollIntoView({ block: "nearest" }));
    }
    else if (action === "toggle-rate") {
      ui.volumeOpen = false;
      ui.rateOpen = !ui.rateOpen;
      renderPlayer({ force: true });
    }
    else if (action === "toggle-volume") {
      ui.rateOpen = false;
      ui.volumeOpen = !ui.volumeOpen;
      renderPlayer({ force: true });
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
    else if (action === "cache-playlist") {
      const playlist = ui.app.playlists.find(item => item.id === button.dataset.id);
      if (!playlist) throw new Error("播放列表不存在");
      await cachePlaylistArchive(playlist);
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
    else if (action === "toggle-favorite-section") {
      await toggleFavoriteSection(findSection(button.dataset.key));
      render();
    }
    else if (action === "toggle-active-section-favorite") {
      await toggleFavoriteSection(ui.activeSection);
      render();
    }
    else if (action === "remove-favorite-section") {
      const favorite = (ui.app.favoriteSections ?? []).find(item => item.key === button.dataset.key);
      if (!favorite) throw new Error("收藏的栏目不存在");
      await favoriteSectionCommand("remove", { key: favorite.key });
      delete ui.favoriteMetadata[favorite.key];
      ui.notice = `已取消收藏“${favorite.title}”。`;
      render();
    }
    else if (action === "open-favorite-section") await openFavoriteSection(button.dataset.key);
    else if (action === "play-favorite-section") {
      const favorite = (ui.app.favoriteSections ?? []).find(item => item.key === button.dataset.key);
      if (!favorite) throw new Error("收藏的栏目不存在");
      const section = favoriteSectionToSection(favorite);
      const items = await loadCompleteSection(section);
      await playerCommand("playQueue", { queue: queueForSection(section, items), index: 0, queueContext: queueContextForSection(section) });
    }
    else if (action === "open-section") await openSection(button.dataset.key);
    else if (action === "load-more") await loadMoreDetail();
    else if (action === "clear-track-search") {
      ui.trackSearchKeyword = "";
      render();
    }
    else if (action === "play-search-results") {
      const queue = queueForSection(ui.activeSection, currentSearchResults());
      if (!queue.length) throw new Error("当前没有可播放的搜索结果");
      await playerCommand("playQueue", { queue, index: 0, queueContext: searchQueueContext() });
    }
    else if (action === "save-search-results") {
      const queue = queueForSection(ui.activeSection, currentSearchResults());
      openPlaylistPicker(queue, `搜索“${ui.trackSearchKeyword}”的结果`);
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
      ui.searchOpen = false;
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
      const items = await loadCompleteSection(section);
      await playerCommand("playQueue", { queue: queueForSection(section, items), index: 0, queueContext: queueContextForSection(section) });
    }
    else if (action === "play-detail") {
      const items = await loadCompleteSection(ui.activeSection);
      await playerCommand("playQueue", { queue: queueForSection(ui.activeSection, items), index: 0, queueContext: queueContextForSection(ui.activeSection) });
    }
    else if (action === "toggle-sort-order") {
      const next = currentTrackSortDirection() === "desc" ? "asc" : "desc";
      if (next === "desc" && ui.activeSection) {
        const loaded = ui.detailData?.items?.length ?? ui.activeSection.items?.length ?? 0;
        const total = Number(ui.detailData?.total ?? ui.activeSection.total) || loaded;
        if (loaded < total) await loadCompleteSection(ui.activeSection);
      }
      ui.app.settings = await send(MESSAGE.saveSettings, { patch: { sectionSortDirection: next } });
      ui.notice = `已切换为${trackSortLabel()}，合集、系列和全部作品会统一使用此顺序。`;
      render();
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
      ui.directoryPermissionPrompt = false;
      await refreshCacheInfo();
      render();
    }
    else if (action === "refresh-cache") {
      await refreshCacheInfo();
      render();
    }
    else if (action === "scan-cache-archives") {
      ui.notice = "正在扫描缓存目录、验证旧索引并恢复归档文件……";
      render();
      ui.cacheInfo = await send(MESSAGE.cacheCommand, { command: "scanArchives" });
      const recovery = ui.cacheInfo.recovery;
      ui.notice = `归档扫描完成：识别 ${recovery.files} 个音频文件、${recovery.manifests} 份清单${recovery.errors ? `，${recovery.errors} 个文件未能读取` : ""}。`;
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
    const previousStatus = ui.cacheInfo?.activity?.status ?? ui.cacheActivity?.status;
    ui.cacheInfo = { ...(ui.cacheInfo ?? {}), ...message.cache };
    ui.cacheActivity = message.cache.activity ?? message.cache;
    const status = message.cache.status ?? ui.cacheActivity?.status;
    if (["completed", "failed", "idle"].includes(status)) {
      refreshCacheInfo().then(() => renderCacheState());
    } else {
      const progressOnly = status === previousStatus && ["downloading", "encoding"].includes(status);
      renderCacheState({ progressOnly });
    }
  }
});

async function start() {
  try {
    ui.app = await send(MESSAGE.getAppState);
    await refreshCacheInfo();
    ui.directoryPermissionPrompt = needsCacheDirectoryReauthorization(ui.cacheInfo?.directory);
    const active = activeCreator();
    if (active && !ui.app.settings.activeCreatorId) ui.app.settings.activeCreatorId = active.id;
    render();
    if ((ui.app.playlists ?? []).some(playlist => playlist.items.some(item => Number(item.duration) <= 0))) {
      playlistCommand("repairDurations")
        .then(playlists => {
          ui.app.playlists = playlists;
          render();
        })
        .catch(error => {
          console.warn("历史播放列表时长补全失败", error);
        });
    }
    if (active) await loadActiveCreator();
  } catch (error) {
    root.innerHTML = `<div class="empty-state"><h1>扩展启动失败</h1><div class="error-message">${escapeHtml(toErrorMessage(error))}</div></div>`;
  }
}

start();

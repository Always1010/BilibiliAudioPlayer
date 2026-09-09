import { normalizeImageUrl, stripHtml } from "../shared/utils.js";
import { signWbiParams } from "./wbi.js";

const API_ROOT = "https://api.bilibili.com";

export class BilibiliApiError extends Error {
  constructor(message, code = null) {
    super(message);
    this.name = "BilibiliApiError";
    this.code = code;
  }
}

async function fetchJson(path, { params = {}, wbi = false, referrer = "" } = {}) {
  const query = wbi
    ? await signWbiParams(params)
    : new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)])).toString();
  const url = `${API_ROOT}${path}${query ? `?${query}` : ""}`;
  const response = await fetch(url, {
    credentials: "include",
    headers: { Accept: "application/json" },
    ...(referrer ? {
      referrer,
      referrerPolicy: "strict-origin-when-cross-origin"
    } : {})
  });
  if (!response.ok) throw new BilibiliApiError(`请求失败（HTTP ${response.status}）`, response.status);
  const payload = await response.json();
  if (payload.code !== 0) {
    const hint = payload.code === -412
      ? "请求被站点风控拦截，请稍后重试或确认浏览器已登录哔哩哔哩"
      : payload.message || "哔哩哔哩接口返回错误";
    throw new BilibiliApiError(hint, payload.code);
  }
  return payload.data;
}

function normalizeCreator(item) {
  return {
    id: String(item.mid ?? item.uid ?? item.id),
    name: stripHtml(item.uname ?? item.name ?? item.card?.name ?? `UID ${item.mid}`),
    avatar: normalizeImageUrl(item.upic ?? item.face ?? item.card?.face ?? ""),
    sign: stripHtml(item.usign ?? item.sign ?? item.card?.sign ?? ""),
    fans: Number(item.fans ?? item.card?.fans ?? 0),
    addedAt: Date.now()
  };
}

function parseDuration(value) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.includes(":")) {
    return value.split(":").reduce((total, part) => total * 60 + Number(part), 0);
  }
  return Number(value ?? 0) || 0;
}

function normalizeVideo(item, creator = null) {
  return {
    id: item.bvid || String(item.aid),
    bvid: item.bvid || "",
    aid: Number(item.aid ?? 0),
    title: stripHtml(item.title ?? "未命名作品"),
    cover: normalizeImageUrl(item.pic ?? item.cover ?? ""),
    duration: parseDuration(item.duration),
    publishedAt: Number(item.pubdate ?? item.created ?? item.ctime ?? 0),
    description: stripHtml(item.description ?? item.desc ?? ""),
    creator
  };
}

export async function getLoginStatus() {
  try {
    const data = await fetchJson("/x/web-interface/nav");
    return {
      isLoggedIn: Boolean(data.isLogin),
      userId: data.mid ? String(data.mid) : null,
      name: data.uname ?? ""
    };
  } catch (error) {
    if (error.code === -101) return { isLoggedIn: false, userId: null, name: "" };
    throw error;
  }
}

export async function getCreator(mid) {
  try {
    const data = await fetchJson("/x/web-interface/card", { params: { mid, photo: true } });
    return normalizeCreator({ ...data, mid, card: data.card });
  } catch {
    const data = await fetchJson("/x/space/acc/info", { params: { mid } });
    return normalizeCreator(data);
  }
}

export async function searchCreators(keyword, page = 1) {
  const trimmed = String(keyword)
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .trim()
    .replace(/^@+/, "")
    .trim();
  if (!trimmed) return [];
  if (/^\d+$/.test(trimmed)) {
    return [await getCreator(trimmed)];
  }

  const data = await fetchJson("/x/web-interface/search/type", {
    params: { search_type: "bili_user", keyword: trimmed, page },
    referrer: "https://search.bilibili.com/"
  });
  return (data.result ?? [])
    .map(normalizeCreator)
    .sort((left, right) => Number(right.name === trimmed) - Number(left.name === trimmed));
}

export async function listCreatorVideos(mid, page = 1, pageSize = 30) {
  const data = await fetchJson("/x/space/wbi/arc/search", {
    wbi: true,
    params: {
      mid,
      pn: page,
      ps: pageSize,
      order: "pubdate",
      order_avoided: true,
      platform: "web",
      web_location: "1550101"
    }
  });
  const list = data?.list?.vlist ?? [];
  return {
    items: list.map(normalizeVideo),
    page,
    pageSize,
    total: Number(data?.page?.count ?? list.length)
  };
}

export async function listCreatorContainers(mid, page = 1, pageSize = 20) {
  const safePageSize = Math.max(1, Math.min(20, Number(pageSize) || 20));
  const data = await fetchJson("/x/polymer/web-space/seasons_series_list", {
    params: { mid, page_num: page, page_size: safePageSize }
  });
  const lists = data?.items_lists ?? {};
  const seasons = (lists.seasons_list ?? []).map(item => ({
    id: String(item.meta.season_id),
    type: "season",
    title: item.meta.title || item.meta.name,
    cover: normalizeImageUrl(item.meta.cover ?? ""),
    description: item.meta.description ?? "",
    total: Number(item.meta.total ?? 0),
    updatedAt: Number(item.meta.ptime ?? 0),
    preview: (item.archives ?? []).map(normalizeVideo)
  }));
  const series = (lists.series_list ?? []).map(item => ({
    id: String(item.meta.series_id),
    type: "series",
    title: item.meta.name,
    cover: normalizeImageUrl(item.meta.cover ?? ""),
    description: item.meta.description ?? "",
    total: Number(item.meta.total ?? 0),
    updatedAt: Number(item.meta.last_update_ts ?? 0),
    preview: (item.archives ?? []).map(normalizeVideo)
  }));
  return {
    seasons,
    series,
    page: Number(lists.page?.page_num ?? page),
    pageSize: safePageSize,
    total: Number(lists.page?.total ?? seasons.length + series.length)
  };
}

export async function listAllCreatorContainers(mid, pageSize = 20) {
  const safePageSize = Math.max(1, Math.min(20, Number(pageSize) || 20));
  const firstPage = await listCreatorContainers(mid, 1, safePageSize);
  const seasons = [...firstPage.seasons];
  const series = [...firstPage.series];
  const totalPages = Math.max(1, Math.ceil(firstPage.total / safePageSize));

  for (let page = 2; page <= totalPages; page += 1) {
    const nextPage = await listCreatorContainers(mid, page, safePageSize);
    seasons.push(...nextPage.seasons);
    series.push(...nextPage.series);
  }

  const uniqueById = items => [...new Map(items.map(item => [item.id, item])).values()];
  return {
    seasons: uniqueById(seasons),
    series: uniqueById(series),
    total: firstPage.total
  };
}

export async function listContainerVideos(mid, type, id, page = 1, pageSize = 30) {
  const data = type === "season"
    ? await fetchJson("/x/polymer/web-space/seasons_archives_list", {
      params: { mid, season_id: id, sort_reverse: false, page_num: page, page_size: pageSize }
    })
    : await fetchJson("/x/series/archives", {
      params: { mid, series_id: id, only_normal: true, sort: "desc", pn: page, ps: pageSize }
    });

  const items = data.archives ?? data.items ?? [];
  return {
    items: items.map(normalizeVideo),
    page,
    pageSize,
    total: Number(data.page?.total ?? data.page?.count ?? data.total ?? items.length)
  };
}

export async function resolveAudioStream(track) {
  const video = await fetchJson("/x/web-interface/view", {
    params: track.bvid ? { bvid: track.bvid } : { aid: track.aid }
  });
  const cid = track.cid || video.cid || video.pages?.[0]?.cid;
  if (!cid) throw new BilibiliApiError("无法取得视频分 P 信息");

  let play;
  try {
    play = await fetchJson("/x/player/wbi/playurl", {
      wbi: true,
      params: {
        bvid: video.bvid,
        cid,
        qn: 80,
        fnver: 0,
        fnval: 16,
        fourk: 1
      }
    });
  } catch {
    play = await fetchJson("/x/player/playurl", {
      params: { bvid: video.bvid, cid, qn: 80, fnver: 0, fnval: 16 }
    });
  }

  const audio = [...(play.dash?.audio ?? [])].sort((left, right) => (right.bandwidth ?? 0) - (left.bandwidth ?? 0))[0];
  const url = audio?.baseUrl ?? audio?.base_url ?? play.durl?.[0]?.url;
  if (!url) throw new BilibiliApiError("该作品没有可用的音频流");
  return {
    url,
    backupUrls: audio?.backupUrl ?? audio?.backup_url ?? [],
    codec: audio?.codecs ?? "",
    mimeType: audio?.mimeType ?? audio?.mime_type ?? "audio/mp4",
    cid,
    bvid: video.bvid,
    duration: Number(video.duration ?? 0)
  };
}

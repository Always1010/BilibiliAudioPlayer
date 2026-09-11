function text(value) {
  return String(value ?? "").trim();
}

export function bilibiliVideoUrl(track) {
  const id = text(track?.id);
  const bvid = text(track?.bvid || (/^BV[0-9A-Za-z]+$/.test(id) ? id : ""));
  if (/^BV[0-9A-Za-z]+$/.test(bvid)) {
    return `https://www.bilibili.com/video/${bvid}`;
  }

  const idAid = id.match(/^av([1-9]\d*)$/i)?.[1] || (/^[1-9]\d*$/.test(id) ? id : "");
  const aid = text(track?.aid || idAid);
  return /^[1-9]\d*$/.test(aid) ? `https://www.bilibili.com/video/av${aid}` : "";
}

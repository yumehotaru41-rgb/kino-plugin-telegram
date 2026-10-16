/// <reference path="./kino.d.ts" />

const BASE = "https://t.me";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function normalizeUsername(raw) {
  if (!raw) return "";
  return String(raw)
    .trim()
    .replace(/^@+/, "")
    .replace(/^https?:\/\/(t\.me|telegram\.me)\//i, "")
    .replace(/^s\//i, "")
    .split(/[/?#]/)[0]
    .toLowerCase();
}

function getChannels() {
  const list = kino.config.get("channels");
  if (!Array.isArray(list) || list.length === 0) return [];
  return list
    .map((row) => {
      const username = normalizeUsername(row.username);
      if (!username) return null;
      return {
        username,
        label: (row.label && String(row.label).trim()) || username,
      };
    })
    .filter(Boolean);
}

function getMaxPerChannel() {
  const n = parseInt(kino.config.get("maxPerChannel") || "20", 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 50) : 20;
}

function getPagesPerChannel() {
  const n = parseInt(kino.config.get("pagesPerChannel") || "2", 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 4) : 2;
}

function bgUrl(style) {
  if (!style) return null;
  const m = String(style).match(/url\(\s*['"]?([^'")\s]+)['"]?\s*\)/i);
  return m ? m[1].replace(/&amp;/g, "&") : null;
}

function parseDuration(text) {
  if (!text) return undefined;
  const parts = String(text).trim().split(":").map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return undefined;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return undefined;
}

function parseVideoPosts(html, channel) {
  const wraps = kino.html.select(html, "div.tgme_widget_message[data-post]");
  const items = [];
  let oldestId = null;

  for (const wrap of wraps) {
    const dataPost = wrap.attrs["data-post"];
    if (!dataPost || !dataPost.includes("/")) continue;

    const [chan, idStr] = dataPost.split("/");
    if (!idStr || !/^\d+$/.test(idStr)) continue;
    const id = idStr;
    const numId = parseInt(id, 10);
    if (oldestId === null || numId < oldestId) oldestId = numId;

    const videoPlayers = kino.html.select(
      wrap.html,
      "a.tgme_widget_message_video_player, .tgme_widget_message_video_player"
    );
    if (!videoPlayers.length) continue;

    let title = "";
    let overview = "";
    const textEls = kino.html.select(
      wrap.html,
      ".tgme_widget_message_text.js-message_text, .tgme_widget_message_text"
    );
    if (textEls.length) {
      overview = (textEls[0].text || "").trim().replace(/\s+/g, " ");
      title = overview;
    }
    if (!title) title = `\( {channel.label || channel.username} # \){id}`;
    if (title.length > 140) title = title.slice(0, 137) + "…";
    if (overview.length > 500) overview = overview.slice(0, 497) + "…";

    let poster;
    const thumbs = kino.html.select(wrap.html, ".tgme_widget_message_video_thumb");
    if (thumbs.length) {
      poster = bgUrl(thumbs[0].attrs.style);
    }
    if (!poster) {
      const imgs = kino.html.select(wrap.html, "img[src]");
      for (const img of imgs) {
        const src = img.attrs.src || "";
        if (/cdn|telegram|telesco/i.test(src)) {
          poster = src;
          break;
        }
      }
    }

    let year;
    const times = kino.html.select(wrap.html, "time[datetime]");
    if (times.length && times[0].attrs.datetime) {
      year = times[0].attrs.datetime.slice(0, 4);
    }

    let duration;
    const durEls = kino.html.select(
      wrap.html,
      "time.message_video_duration, .message_video_duration"
    );
    if (durEls.length) {
      duration = parseDuration(durEls[0].text);
    }

    items.push({
      id: `\( {chan}_ \){id}`,
      ref: `\( {chan}/ \){id}`,
      title,
      kind: "movie",
      year,
      poster,
      overview: overview || title,
      duration,
    });
  }

  items.reverse();
  return { items, oldestId };
}

async function fetchPage(channel, before) {
  let url = `\( {BASE}/s/ \){encodeURIComponent(channel.username)}`;
  if (before) url += `?before=${before}`;

  const r = await kino.fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
    },
    timeoutMs: 18000,
  });

  if (!r.ok) {
    if (r.status === 302 || r.status === 301 || r.status === 404) {
      throw kino.error(
        "unavailable",
        `El canal @${channel.username} no tiene vista pública o no existe`
      );
    }
    throw kino.error("unavailable", `Telegram respondió ${r.status}`);
  }

  return r.text();
}

async function fetchChannelVideos(channel, limit, maxPages) {
  const all = [];
  let before = null;
  const seen = new Set();

  for (let page = 0; page < maxPages && all.length < limit; page++) {
    const html = await fetchPage(channel, before);
    const { items, oldestId } = parseVideoPosts(html, channel);

    for (const it of items) {
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      all.push(it);
      if (all.length >= limit) break;
    }

    if (!oldestId || items.length === 0) break;
    before = oldestId;

    if (page + 1 < maxPages && all.length < limit) {
      await kino.sleep(400);
    }
  }

  return all.slice(0, limit);
}

export async function home() {
  const channels = getChannels();
  if (!channels.length) {
    throw kino.error(
      "auth_required",
      "Configura al menos un canal público en Ajustes del plugin"
    );
  }

  const max = getMaxPerChannel();
  const pages = getPagesPerChannel();
  const rows = [];

  for (const ch of channels) {
    try {
      const items = await fetchChannelVideos(ch, max, pages);
      if (items.length) {
        rows.push({
          id: `tg-${ch.username}`,
          title: ch.label,
          items,
        });
      }
    } catch (e) {
      try {
        kino.log?.warn?.(`Canal @${ch.username}: ${e.message || e}`);
      } catch (_) {}
    }
  }

  if (!rows.length) {
    throw kino.error(
      "not_found",
      "No se encontraron vídeos en los canales configurados. Comprueba que tengan vista pública (t.me/s/usuario)."
    );
  }

  return rows;
}

export async function search(query) {
  const q = (query.q || "").trim().toLowerCase();
  if (!q) return [];

  const channels = getChannels();
  if (!channels.length) return [];

  const direct = q.match(/(?:t\.me\/)?([a-zA-Z0-9_]+)\/(\d+)/i);
  if (direct) {
    const ref = `\( {direct[1].toLowerCase()}/ \){direct[2]}`;
    return [
      {
        id: ref.replace("/", "_"),
        ref,
        title: `Telegram ${ref}`,
        kind: "movie",
      },
    ];
  }

  const max = getMaxPerChannel();
  const pages = getPagesPerChannel();
  const results = [];
  const seen = new Set();

  for (const ch of channels) {
    try {
      const items = await fetchChannelVideos(ch, max, pages);
      for (const it of items) {
        if (seen.has(it.id)) continue;
        const hay =
          it.title.toLowerCase().includes(q) ||
          (it.overview && it.overview.toLowerCase().includes(q)) ||
          ch.username.includes(q) ||
          (ch.label && ch.label.toLowerCase().includes(q));
        if (hay) {
          seen.add(it.id);
          results.push(it);
        }
      }
    } catch (_) {}
  }

  return results;
}

function extractVideoUrl(html) {
  const videos = kino.html.select(html, "video[src]");
  for (const v of videos) {
    const src = (v.attrs.src || "").trim();
    if (src && (/cdn|telegram|telesco/i.test(src) || /\.(mp4|webm|m3u8)(\?|$)/i.test(src))) {
      return src.replace(/&amp;/g, "&");
    }
  }

  const sources = kino.html.select(html, "source[src]");
  for (const s of sources) {
    const src = (s.attrs.src || "").trim();
    if (src && (/cdn|telegram|telesco/i.test(src) || /\.(mp4|webm|m3u8)(\?|$)/i.test(src))) {
      return src.replace(/&amp;/g, "&");
    }
  }

  const patterns = [
    /<video[^>]+src=["']([^"']+)["']/i,
    /src=["'](https?:\/\/[^"']*(?:cdn-telegram|telegram-cdn|telesco\.me)[^"']*\.mp4[^"']*)["']/i,
    /(https?:\/\/[^"'\\\s<>]+(?:cdn-telegram|telegram-cdn|telesco\.me)[^"'\\\s<>]+\.mp4[^"'\\\s<>]*)/i,
  ];

  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1]) {
      return m[1].replace(/&amp;/g, "&").replace(/\\u0026/g, "&");
    }
  }

  return null;
}

export async function resolve(ref) {
  const parts = String(ref).split("/");
  if (parts.length < 2) {
    throw kino.error("not_found", "Referencia inválida (se espera canal/id)");
  }

  const channel = parts[0].toLowerCase();
  const msgId = parts[1];

  const embedUrl =
    `\( {BASE}/ \){encodeURIComponent(channel)}/${encodeURIComponent(msgId)}` +
    "?embed=1&single";

  const r = await kino.fetch(embedUrl, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml",
      Referer: `\( {BASE}/s/ \){channel}`,
      "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
    },
    timeoutMs: 22000,
  });

  if (!r.ok) {
    throw kino.error("not_found", `No se pudo abrir el post (${r.status})`);
  }

  const html = r.text();
  const videoUrl = extractVideoUrl(html);

  if (!videoUrl) {
    throw kino.error(
      "not_found",
      "Este post no tiene un vídeo reproducible o el enlace ha caducado"
    );
  }

  const headers = {
    Referer: `\( {BASE}/ \){channel}/${msgId}`,
    "User-Agent": UA,
  };

  return {
    url: videoUrl,
    mime: /\.m3u8(\?|$)/i.test(videoUrl)
      ? "application/x-mpegURL"
      : "video/mp4",
    headers,
    expiresInSeconds: 3600,
  };
}
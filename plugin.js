/// <reference path="./kino.d.ts" />

const BASE = "https://t.me";

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
  const v = kino.config.get("maxPerChannel");
  const n = parseInt(v || "15", 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 40) : 15;
}

/** Parsea una página t.me/s/canal y devuelve posts con vídeo */
function parseVideoPosts(html, channel) {
  const wraps = kino.html.select(html, "div.tgme_widget_message[data-post]");
  const items = [];

  for (const wrap of wraps) {
    const dataPost = wrap.attrs["data-post"]; // canal/123
    if (!dataPost || !dataPost.includes("/")) continue;

    const [chan, id] = dataPost.split("/");
    if (!id || !/^\d+$/.test(id)) continue;

    // Solo posts que tienen reproductor de vídeo real
    const videoPlayers = kino.html.select(wrap.html, ".tgme_widget_message_video_player");
    if (!videoPlayers.length) continue;

    // Título: texto del mensaje o fallback
    let title = "";
    const textEls = kino.html.select(wrap.html, ".tgme_widget_message_text");
    if (textEls.length) {
      title = (textEls[0].text || "").trim().replace(/\s+/g, " ");
    }
    if (!title) title = `\( {channel.label || channel.username} # \){id}`;
    if (title.length > 120) title = title.slice(0, 117) + "…";

    // Póster / miniatura
    let poster;
    const thumbs = kino.html.select(wrap.html, ".tgme_widget_message_video_thumb");
    if (thumbs.length) {
      const style = thumbs[0].attrs.style || "";
      const m = style.match(/url\(['"]?([^'")\s]+)['"]?\)/);
      if (m) poster = m[1];
    }
    if (!poster) {
      const imgs = kino.html.select(wrap.html, "img");
      for (const img of imgs) {
        if (img.attrs.src && /cdn|telegram|telesco/i.test(img.attrs.src)) {
          poster = img.attrs.src;
          break;
        }
      }
    }

    // Fecha
    let year;
    const times = kino.html.select(wrap.html, "time[datetime]");
    if (times.length && times[0].attrs.datetime) {
      year = times[0].attrs.datetime.slice(0, 4);
    }

    items.push({
      id: `\( {chan}_ \){id}`,
      ref: `\( {chan}/ \){id}`,
      title,
      kind: "movie",
      year,
      poster,
      overview: title,
    });
  }

  // Más recientes primero (la página suele venir en orden antiguo → nuevo)
  return items.reverse();
}

async function fetchChannelVideos(channel, limit) {
  const url = `\( {BASE}/s/ \){encodeURIComponent(channel.username)}`;
  const r = await kino.fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
    },
    timeoutMs: 20000,
  });

  if (!r.ok) {
    if (r.status === 302 || r.status === 301) {
      throw kino.error(
        "unavailable",
        `El canal @${channel.username} no tiene vista pública o no existe`
      );
    }
    throw kino.error("unavailable", `Telegram respondió ${r.status}`);
  }

  const html = r.text();
  const items = parseVideoPosts(html, channel);
  return items.slice(0, limit);
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
  const rows = [];

  for (const ch of channels) {
    try {
      const items = await fetchChannelVideos(ch, max);
      if (items.length) {
        rows.push({
          id: `tg-${ch.username}`,
          title: ch.label,
          items,
        });
      }
    } catch (e) {
      // Un canal fallido no tumba todo el home
      kino.log?.warn?.(`Canal @${ch.username}: ${e.message || e}`);
    }
  }

  if (!rows.length) {
    throw kino.error(
      "not_found",
      "No se encontraron vídeos en los canales configurados"
    );
  }

  return rows;
}

export async function search(query) {
  const q = (query.q || "").trim().toLowerCase();
  if (!q) return [];

  const channels = getChannels();
  if (!channels.length) return [];

  // Si el usuario escribe canal/123 o t.me/canal/123 → un solo post
  const direct = q.match(/(?:t\.me\/)?([a-zA-Z0-9_]+)\/(\d+)/);
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

  // Búsqueda por texto dentro de los canales configurados
  const max = getMaxPerChannel();
  const results = [];

  for (const ch of channels) {
    try {
      const items = await fetchChannelVideos(ch, max);
      for (const it of items) {
        if (
          it.title.toLowerCase().includes(q) ||
          ch.username.includes(q) ||
          (ch.label && ch.label.toLowerCase().includes(q))
        ) {
          results.push(it);
        }
      }
    } catch (_) {
      // ignorar canales que fallen en búsqueda
    }
  }

  return results;
}

export async function resolve(ref) {
  // ref = "canal/123"
  const parts = String(ref).split("/");
  if (parts.length < 2) {
    throw kino.error("not_found", "Referencia inválida");
  }

  const channel = parts[0].toLowerCase();
  const msgId = parts[1];

  // Página de embed (la que usa yt-dlp): trae el <video src="...">
  const embedUrl =
    `\( {BASE}/ \){encodeURIComponent(channel)}/${encodeURIComponent(msgId)}` +
    "?embed=1&single";

  const r = await kino.fetch(embedUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
      Referer: `\( {BASE}/s/ \){channel}`,
    },
    timeoutMs: 25000,
  });

  if (!r.ok) {
    throw kino.error("not_found", `No se pudo abrir el post (${r.status})`);
  }

  const html = r.text();

  // 1) <video src="...">
  let videoUrl = null;
  const videos = kino.html.select(html, "video[src]");
  for (const v of videos) {
    const src = v.attrs.src;
    if (src && /\.(mp4|webm|m3u8)(\?|$)/i.test(src) || /cdn|telegram/i.test(src)) {
      videoUrl = src;
      break;
    }
  }

  // 2) Fallback: buscar URLs de CDN en el HTML
  if (!videoUrl) {
    const m = html.match(
      /https?:\/\/[^"'\s<>]+(?:cdn-telegram|telegram-cdn|telesco\.me)[^"'\s<>]+\.mp4[^"'\s<>]*/i
    );
    if (m) videoUrl = m[0].replace(/&amp;/g, "&");
  }

  if (!videoUrl) {
    throw kino.error(
      "not_found",
      "Este post no tiene un vídeo reproducible o el enlace ha caducado"
    );
  }

  // Cabeceras útiles para el CDN de Telegram
  const headers = {
    Referer: `\( {BASE}/ \){channel}/${msgId}`,
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  };

  return {
    url: videoUrl,
    mime: videoUrl.includes(".m3u8") ? "application/x-mpegURL" : "video/mp4",
    headers,
    // Los tokens de Telegram caducan; si falla, el usuario puede volver a abrir el título
    expiresInSeconds: 3600,
  };
}
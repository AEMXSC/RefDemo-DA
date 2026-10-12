/*
 * scrape — minimal browser SSE client for the LiveDemos asset scraper.
 * Ported unchanged from the UE extension (lib/scrapeSSE.js): scraping/backend
 * services stay the same across the DA migration, only the auth token source
 * changes (DA SDK token instead of UE's imsToken).
 *
 * Endpoint: GET /api/assets?sse=true&url=...&colors=true&brandColors=true&images=true&texts=true
 *   Authorization: Bearer <ims-token>
 *
 * The endpoint streams Server-Sent Events. Frame types:
 *   event: progress  data: { "message": "...", "step": "...", "ts": "..." }
 *   event: result     data: { "ok": true, "brandColors": [...], "colors": {...}, "images": [...], "texts": [...] }
 *   event: error      data: { "error": "..." }
 *
 * The browser's built-in EventSource does not support custom headers (we need
 * the IMS Authorization header), so we stream the response ourselves via
 * fetch() + ReadableStream + TextDecoder and parse SSE frames out of the
 * accumulating buffer.
 */

import { LIVEDEMOS_BASE_URL, LIVEDEMOS_ASSETS_PATH } from '../config.js';

function parseFrame(raw) {
  let eventType = 'message';
  const dataLines = [];
  for (const rawLine of raw.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (!line) continue;
    if (line.startsWith(':')) continue; // comment/heartbeat
    if (line.startsWith('event:')) {
      eventType = line.slice('event:'.length).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trim());
    }
  }
  if (dataLines.length === 0) return null;
  const dataStr = dataLines.join('\n');
  let data;
  try {
    data = JSON.parse(dataStr);
  } catch {
    data = dataStr;
  }
  return { event: eventType, data };
}

const BOOL_FLAGS = ['colors', 'brandColors', 'images', 'texts'];

// Local-debug-only escape hatch: the debug harness (dev/debug.html?proxy=1)
// sets this global to route through da-plugin/dev-proxy so a bad token shows
// up as a plain 401 instead of an opaque CORS error. Inert in production —
// the plugin never sets this global itself.
function baseUrl() {
  if (typeof window !== 'undefined' && window.__DEMO_PILOT_SCRAPE_PROXY__) {
    return window.__DEMO_PILOT_SCRAPE_PROXY__;
  }
  return LIVEDEMOS_BASE_URL;
}

function buildEndpoint(url, params) {
  const qs = new URLSearchParams();
  qs.set('url', url);
  qs.set('sse', 'true');
  for (const flag of BOOL_FLAGS) {
    if (params && flag in params) qs.set(flag, params[flag] ? 'true' : 'false');
  }
  return `${baseUrl()}${LIVEDEMOS_ASSETS_PATH}?${qs.toString()}`;
}

export async function* scrapeStream({ url, params, token, signal }) {
  if (!url) throw new Error('scrapeStream: `url` is required');
  if (!token) throw new Error('scrapeStream: `token` (IMS bearer) is required');

  const endpoint = buildEndpoint(url, params);
  const resp = await fetch(endpoint, {
    method: 'GET',
    headers: { Accept: 'text/event-stream', Authorization: `Bearer ${token}` },
    signal,
  });

  if (!resp.ok) {
    const bodyText = await resp.text().catch(() => '');
    const snippet = bodyText ? `: ${bodyText.slice(0, 500)}` : '';
    const err = new Error(`Scraper returned HTTP ${resp.status}${snippet}`);
    err.status = resp.status;
    throw err;
  }

  if (!resp.body || typeof resp.body.getReader !== 'function') {
    throw new Error('Scraper response has no readable body stream (browser lacks ReadableStream support?)');
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        if (buffer.trim()) {
          const parsed = parseFrame(buffer);
          if (parsed) yield parsed;
        }
        return;
      }
      buffer += decoder.decode(value, { stream: true });

      while (true) {
        const nn = buffer.indexOf('\n\n');
        const rn = buffer.indexOf('\r\n\r\n');
        let sepIdx = -1;
        let sepLen = 0;
        if (nn !== -1 && (rn === -1 || nn < rn)) { sepIdx = nn; sepLen = 2; }
        else if (rn !== -1) { sepIdx = rn; sepLen = 4; }
        if (sepIdx === -1) break;

        const frame = buffer.slice(0, sepIdx);
        buffer = buffer.slice(sepIdx + sepLen);
        const parsed = parseFrame(frame);
        if (parsed) yield parsed;
      }
    }
  } finally {
    try { reader.releaseLock(); } catch (_) { /* ignore */ }
  }
}

/**
 * Run a full scrape and return the unwrapped payload from the terminal
 * `result` event, yielding `progress` events to `onProgress` along the way.
 */
export async function runScrape({ url, params, token, signal, onProgress }) {
  let lastStatus = '';
  let finalPayload = null;

  for await (const evt of scrapeStream({ url, params, token, signal })) {
    const data = (evt.data && typeof evt.data === 'object') ? evt.data : null;

    if (evt.event === 'progress') {
      if (data && typeof data.message === 'string') lastStatus = data.message;
      if (typeof onProgress === 'function') {
        try { onProgress(data || {}); } catch (_) { /* never let UI throw kill the stream */ }
      }
    } else if (evt.event === 'result') {
      if (data && data.ok === false) {
        const msg = (typeof data.error === 'string' && data.error) ? data.error : 'Scraper returned ok=false';
        throw new Error(msg);
      }
      finalPayload = data;
      break;
    } else if (evt.event === 'error') {
      const msg = (data && typeof data.error === 'string' && data.error) ? data.error : 'Scraper emitted error event';
      throw new Error(msg);
    }
  }

  const unwrapItem = (item) =>
    (item && typeof item === 'object' && item.data && typeof item.data === 'object')
      ? { ...item.data, origin: item.origin }
      : item;

  const unwrapColorTree = (node) => {
    if (!node || typeof node !== 'object') return node;
    if (node.data && typeof node.data === 'object' && typeof node.data.value === 'string') {
      return node.data.value;
    }
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = unwrapColorTree(v);
    return out;
  };

  const minImageSize = Number(params && params.minImageSize);
  const maxImageSize = Number(params && params.maxImageSize);
  const hasMin = Number.isFinite(minImageSize) && minImageSize > 0;
  const hasMax = Number.isFinite(maxImageSize) && maxImageSize > 0;

  const rawImages = (finalPayload && Array.isArray(finalPayload.images)) ? finalPayload.images : [];
  const images = rawImages.map(unwrapItem).filter((img) => {
    if (!img || typeof img.src !== 'string' || !img.src) return false;
    const w = Number(img.width) || 0;
    const h = Number(img.height) || 0;
    const longest = Math.max(w, h);
    if (longest === 0) return true;
    if (hasMin && longest < minImageSize) return false;
    if (hasMax && longest > maxImageSize) return false;
    return true;
  });

  const rawTexts = (finalPayload && Array.isArray(finalPayload.texts)) ? finalPayload.texts : [];
  const texts = rawTexts.map(unwrapItem);
  const colors = (finalPayload && finalPayload.colors && typeof finalPayload.colors === 'object')
    ? unwrapColorTree(finalPayload.colors)
    : null;
  const rawBrandColors = (finalPayload && Array.isArray(finalPayload.brandColors)) ? finalPayload.brandColors : [];
  const brandColors = rawBrandColors
    .map((c) => {
      const u = unwrapItem(c);
      if (typeof u === 'string') return u;
      if (u && typeof u.value === 'string') return u.value;
      return null;
    })
    .filter((c) => typeof c === 'string' && c);

  return { images, texts, colors, brandColors, status: lastStatus };
}

/** Group the scraper's flat `texts` array into `{ [component]: string[] }`. */
export function groupTextsByComponent(textsArray) {
  const out = {};
  const seen = {};
  for (const raw of textsArray || []) {
    const entry = (raw && typeof raw === 'object' && raw.data && typeof raw.data === 'object') ? raw.data : raw;
    let text = '';
    if (typeof entry === 'string') {
      text = entry;
    } else if (entry && typeof entry === 'object') {
      const t = entry.text || entry.value || entry.content || entry.label || entry.string;
      if (typeof t === 'string') text = t;
    }
    text = (text || '').trim();
    if (!text) continue;
    const compRaw = (entry && typeof entry === 'object')
      ? (entry.component || entry.type || entry.category || entry.tag || entry.role)
      : '';
    const component = (typeof compRaw === 'string' && compRaw.trim()) || 'other';
    if (!out[component]) {
      out[component] = [];
      seen[component] = new Set();
    }
    if (seen[component].has(text)) continue;
    seen[component].add(text);
    out[component].push(text);
  }
  return out;
}

/** Merge two grouped-texts shapes, de-duping within each component. */
export function mergeTextsByComponent(existing, incoming) {
  const out = { ...(existing || {}) };
  for (const [component, items] of Object.entries(incoming || {})) {
    const prev = Array.isArray(out[component]) ? out[component] : [];
    const seen = new Set(prev);
    const merged = prev.slice();
    for (const t of items || []) {
      if (typeof t !== 'string') continue;
      if (seen.has(t)) continue;
      seen.add(t);
      merged.push(t);
    }
    out[component] = merged;
  }
  return out;
}

/*
 * theme — brand-theme scraping → DA "sheet" storage, replacing Content
 * Fragments entirely.
 *
 * Storage model:
 *   /theme.json          — the single, canonical, PUBLISHED theme every page's
 *                           runtime reads (site-wide, not page-scoped). A plain
 *                           DA single-sheet document: { key, value } rows.
 *   /themes/{name}.json   — one saved theme per scrape/save, same shape, listed
 *                           via the DA List API. "Apply to site" just copies a
 *                           saved theme's fields into /theme.json and publishes
 *                           that one file — no page-by-page fan-out needed.
 *
 * Color-mapping logic (mapScrapeToElements + luminance helpers) is ported
 * verbatim from the UE extension's lib/brandThemeCF.js — only the CF
 * element-ID plumbing (FIELD_IDS / model path) is gone, since a sheet has no
 * model to satisfy.
 */

import { getSource, putJsonSource, listSource, publishSource } from './daAdmin.js';
import { THEME_PATH, THEMES_FOLDER } from '../config.js';

// ---------------------------------------------------------------------------
// Color utilities (hex + W3C sRGB relative luminance) — unchanged from
// brandThemeCF.js.
// ---------------------------------------------------------------------------

function parseHex(hex) {
  if (typeof hex !== 'string') return null;
  const m = /^#?([0-9a-fA-F]+)$/.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length !== 6 && h.length !== 8) return null;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return null;
  return { r, g, b };
}

export function luminance(hex) {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const linearize = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linearize(rgb.r) + 0.7152 * linearize(rgb.g) + 0.0722 * linearize(rgb.b);
}

function isDark(hex) { const L = luminance(hex); return L !== null && L < 0.3; }
function isLight(hex) { const L = luminance(hex); return L !== null && L > 0.7; }

function firstColor(...candidates) {
  for (const c of candidates) if (typeof c === 'string' && c.trim()) return c.trim();
  return null;
}

function firstWhere(pred, ...candidates) {
  for (const c of candidates) if (typeof c === 'string' && c.trim() && pred(c.trim())) return c.trim();
  return null;
}

function darkestUnder(arr, threshold) {
  let best = null;
  let bestL = Infinity;
  for (const hex of arr || []) {
    const L = luminance(hex);
    if (L !== null && L < threshold && L < bestL) { best = hex; bestL = L; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Slug / name helpers
// ---------------------------------------------------------------------------

export function slugFromUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '').replace(/\./g, '-').toLowerCase();
  } catch (_) {
    return 'site';
  }
}

export function isoStamp(date = new Date()) {
  return date.toISOString().replace(/\.\d+/, '').replace(/:/g, '-');
}

// ---------------------------------------------------------------------------
// Pure mapping — scrape payload → flat field map (same field set as before,
// just no FIELD_IDS translation — the sheet's keys ARE the field names).
// ---------------------------------------------------------------------------

export function mapScrapeToElements({ siteUrl, colors, brandColors } = {}) {
  const c = colors || {};
  const body = c.body || {};
  const link = c.link || {};
  const header = c.header || {};
  const footer = c.footer || {};
  const pri = c.primaryButton || {};
  const cta = c.ctaButton || {};
  const bc = Array.isArray(brandColors) ? brandColors : [];

  const themeColor = firstColor(bc[0], cta.background, pri.background);
  const linkHoverColor = themeColor;
  const darkColor = firstWhere(isDark, footer.background, body.text) || darkestUnder(bc, 0.3);
  const lightTextColor = firstWhere(isLight, pri.text, footer.text, header.text);

  const out = {
    siteUrl: siteUrl || null,
    backgroundColor: body.background || null,
    themeColor: themeColor || null,
    darkColor: darkColor || null,
    linkColor: link.color || null,
    linkHoverColor: linkHoverColor || null,
    textColor: body.text || null,
    lightTextColor: lightTextColor || null,
    headerBackgroundColor: header.background || null,
    headerTextColor: header.text || null,
    footerBackgroundColor: footer.background || null,
    footerTextColor: footer.text || null,
  };

  const cleaned = {};
  for (const [k, v] of Object.entries(out)) {
    if (v === null || v === undefined || v === '') continue;
    cleaned[k] = v;
  }
  return cleaned;
}

// ---------------------------------------------------------------------------
// Sheet <-> flat-object conversion
// ---------------------------------------------------------------------------

function toSheet(fields) {
  const data = Object.entries(fields).map(([key, value]) => ({ key, value: String(value) }));
  return { ':type': 'sheet', total: data.length, data };
}

function fromSheet(sheet) {
  const rows = (sheet && Array.isArray(sheet.data)) ? sheet.data : [];
  const out = {};
  for (const row of rows) {
    if (row && typeof row.key === 'string') out[row.key] = row.value;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Save a scrape result as a new named theme under /themes/{slug}-{stamp}.json. */
export async function saveTheme({ org, repo, token, siteUrl, colors, brandColors }) {
  const fields = mapScrapeToElements({ siteUrl, colors, brandColors });
  const name = `${slugFromUrl(siteUrl)}-${isoStamp()}`;
  const path = `${THEMES_FOLDER}/${name}.json`;
  await putJsonSource({ org, repo, token, path, json: toSheet(fields) });
  return { path, name, fields };
}

/** List every saved theme, newest first. */
export async function listThemes({ org, repo, token }) {
  const entries = await listSource({ org, repo, token, path: THEMES_FOLDER });
  const files = entries.filter((e) => e && typeof e.name === 'string' && e.name.endsWith('.json'));
  const themes = [];
  for (const f of files) {
    const path = `${THEMES_FOLDER}/${f.name}`;
    // eslint-disable-next-line no-await-in-loop -- small folder, sequential is fine and keeps ordering simple
    const sheet = await getSource({ org, repo, token, path });
    if (!sheet) continue;
    const fields = fromSheet(sheet);
    themes.push({ path, name: f.name.replace(/\.json$/, ''), fields, lastModified: f.lastModified || null });
  }
  themes.sort((a, b) => (a.name < b.name ? 1 : -1));
  return themes;
}

/** Read the currently-active, published theme (the one every page renders with). */
export async function getActiveTheme({ org, repo, token }) {
  const sheet = await getSource({ org, repo, token, path: THEME_PATH });
  return sheet ? fromSheet(sheet) : {};
}

/**
 * Apply a saved theme to the whole site: overwrite /theme.json and publish
 * just that one file. Every page's runtime picks it up on next fetch — no
 * per-page writes, no site crawl, no fan-out required.
 */
export async function applyThemeToSite({ org, repo, token, ref, fields }) {
  await putJsonSource({ org, repo, token, path: THEME_PATH, json: toSheet(fields) });
  await publishSource({ org, repo, token, ref, path: THEME_PATH });
}

import { listSource } from './daAdmin.js';
import { DA_ADMIN_ORIGIN } from '../config.js';

export const STRUCTURED_CONTENT_FOLDER = '/fragments';
export const STRUCTURED_TEASER_BLOCK = 'structured-teaser';
export const STRUCTURED_EDITOR_DEFAULT = 'https://da.live/form#';

function cleanPath(path) {
  return `/${String(path || '').replace(/^\/+/, '').replace(/\.(html|json)$/i, '')}`;
}

function previewUrl(org, repo, path) {
  return `https://da-sc.adobeaem.workers.dev/preview/${org}/${repo}${cleanPath(path)}`;
}

export function resolveAssetUrl(value, org, repo) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const media = raw.match(/^https?:\/\/(?:www\.)?da\.live\/media#(.*)$/i);
  if (media) {
    const path = media[1];
    return `https://content.da.live${path.startsWith('/') ? '' : '/'}${path}`;
  }
  if (/^https?:\/\//i.test(raw)) return raw;
  const prefix = `/${org}/${repo}`;
  const path = raw.startsWith('/') ? raw : `/${raw}`;
  if (path === prefix || path.startsWith(`${prefix}/`)) return `https://content.da.live${path}`;
  return `https://content.da.live${prefix}${path}`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function entryName(entry) {
  return entry?.name || entry?.path?.split('/').filter(Boolean).pop() || '';
}

function childPath(parentPath, entry, org, repo) {
  let raw = entry?.path || entryName(entry);
  if (!raw) return '';
  const prefix = `/${org}/${repo}`;
  if (raw === prefix || raw.startsWith(`${prefix}/`)) {
    raw = raw.slice(prefix.length) || '/';
  }
  return raw.startsWith('/') ? cleanPath(raw) : cleanPath(`${parentPath}/${raw}`);
}

function isLikelyFolder(entry) {
  const type = String(entry?.type || entry?.kind || entry?.[':type'] || '').toLowerCase();
  if (type.includes('folder') || type.includes('directory')) return true;
  if (entry?.isFolder || entry?.directory) return true;
  const name = entryName(entry);
  return Boolean(name && !/\.[a-z0-9]+$/i.test(name) && !entry?.lastModified);
}

function fieldValue(data, exactKeys, fuzzyMatcher) {
  for (const key of exactKeys) {
    if (data?.[key]) return data[key];
  }
  const match = Object.entries(data || {}).find(([key, value]) => value && fuzzyMatcher(key));
  return match ? match[1] : '';
}

export function normalizeStructuredContent(doc, path, org, repo) {
  const data = doc?.data || {};
  const metadata = doc?.metadata || {};
  const title = fieldValue(data, ['title', 'headline', 'name'], (key) => /title|headline|name/i.test(key)) || metadata.title || path.split('/').pop();
  const description = fieldValue(data, ['description', 'subtitle', 'summary', 'body'], (key) => /description|subtitle|summary|body/i.test(key));
  const image = fieldValue(data, ['bannerimage', 'bannerImage', 'image', 'thumbnail'], (key) => /image|thumbnail|media/i.test(key));
  const ctaLink = fieldValue(data, ['ctalink', 'ctaLink', 'link', 'url'], (key) => /link|url/i.test(key));
  const ctaLabel = fieldValue(data, ['ctalabel', 'ctaLabel', 'buttonText', 'label'], (key) => /label|button/i.test(key));

  return {
    path: cleanPath(path),
    url: previewUrl(org, repo, path),
    schemaName: metadata.schemaName || '',
    title: String(title || ''),
    description: String(description || ''),
    image: resolveAssetUrl(image, org, repo),
    ctaLink: String(ctaLink || ''),
    ctaLabel: String(ctaLabel || ''),
    raw: doc,
  };
}

function configRows(json) {
  if (!json || typeof json !== 'object') return [];
  if (json[':type'] === 'multi-sheet' && Array.isArray(json[':names'])) {
    return json[':names'].flatMap((name) => {
      const sheet = json[name];
      return (sheet && Array.isArray(sheet.data)) ? sheet.data : [];
    });
  }
  return Array.isArray(json.data) ? json.data : [];
}

function cell(row, keys) {
  for (const k of keys) {
    if (row && typeof row[k] === 'string' && row[k]) return row[k];
  }
  return '';
}

export async function fetchStructuredFolders({ org, repo, token }) {
  const sitePrefix = `/${org}/${repo}`;
  const map = new Map();
  try {
    const resp = await fetch(`${DA_ADMIN_ORIGIN}/config/${org}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (resp.ok) {
      const json = await resp.json().catch(() => null);
      for (const row of configRows(json)) {
        if (cell(row, ['key', 'Key']) !== 'editor.path') continue;
        const value = cell(row, ['value', 'Text']);
        const eq = value.indexOf('=');
        if (eq === -1) continue;
        const editorBase = value.slice(eq + 1).trim() || STRUCTURED_EDITOR_DEFAULT;
        for (const folder of value.slice(0, eq).split(',')) {
          const abs = cleanPath(folder.trim());
          if (abs !== sitePrefix && !abs.startsWith(`${sitePrefix}/`)) continue;
          const rel = abs.slice(sitePrefix.length) || '/';
          if (!map.has(rel)) map.set(rel, editorBase);
        }
      }
    }
  } catch (_) { /* fall through to the default below */ }

  if (map.size === 0) map.set(STRUCTURED_CONTENT_FOLDER, STRUCTURED_EDITOR_DEFAULT);
  return [...map.entries()].map(([folder, editorBase]) => ({ folder, editorBase }));
}

export async function fetchStructuredContent({ org, repo, path }) {
  const resp = await fetch(previewUrl(org, repo, path));
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`structured content ${path} -> HTTP ${resp.status}`);
  const json = await resp.json().catch(() => null);
  if (!json || !json.data) return null;
  return normalizeStructuredContent(json, path, org, repo);
}

export async function listStructuredContent({ org, repo, token, folders }) {
  const folderList = (folders && folders.length)
    ? folders
    : await fetchStructuredFolders({ org, repo, token });
  const out = [];
  const seen = new Set();

  async function visit(path, folderRoot, editorBase, depth = 0) {
    if (depth > 6 || seen.has(path)) return;
    seen.add(path);
    const entries = await listSource({ org, repo, token, path });
    for (const entry of entries) {
      const nextPath = childPath(path, entry, org, repo);
      if (!nextPath || nextPath.includes('/.')) continue;
      if (isLikelyFolder(entry)) {
        await visit(nextPath, folderRoot, editorBase, depth + 1);
      } else {
        const item = await fetchStructuredContent({ org, repo, path: nextPath }).catch(() => null);
        if (item) {
          item.folder = folderRoot;
          item.editorUrl = `${editorBase}/${org}/${repo}${item.path}`;
          out.push(item);
        }
      }
    }
  }

  for (const { folder, editorBase } of folderList) {
    await visit(folder, folder, editorBase || STRUCTURED_EDITOR_DEFAULT);
  }
  out.sort((a, b) => a.title.localeCompare(b.title));
  return out;
}

const STRUCTURED_TEASER_VARIANTS = new Set(['right', 'top', 'hero']);

function blockName(variant) {
  return STRUCTURED_TEASER_VARIANTS.has(variant)
    ? `${STRUCTURED_TEASER_BLOCK} (${variant})`
    : STRUCTURED_TEASER_BLOCK;
}

export function structuredTeaserBlockHtml(item, variant) {
  const href = cleanPath(item.path);
  return `<table><tbody><tr><td>${blockName(variant)}</td></tr><tr><td>${escapeHtml(href)}</td></tr></tbody></table>`;
}

export function structuredTeaserPlainText(item, variant) {
  return `${blockName(variant)}\n${cleanPath(item.path)}`;
}
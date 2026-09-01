/*
 * daAdmin — thin wrapper around DA's public Admin APIs:
 *   Source API  (https://docs.da.live/developers/api/source) — CRUD for HTML
 *     documents, JSON files, and media, replacing every CRX/JCR node write
 *     the UE extension used to do (update-node, /var/text-storage,
 *     Content Fragments).
 *   List API    — enumerate children of a folder (replaces list-brand-themes'
 *     folder-listing step).
 *
 * All calls are made directly from the browser with the DA SDK's IMS token —
 * per DA's own SDK recipes, admin.da.live is designed to be called this way,
 * no backend action required.
 */

import { DA_ADMIN_ORIGIN, EDS_ADMIN_ORIGIN } from '../config.js';

function sourcePath(org, repo, path) {
  const clean = path.startsWith('/') ? path : `/${path}`;
  return `${DA_ADMIN_ORIGIN}/source/${org}/${repo}${clean}`;
}

function listPath(org, repo, path) {
  const clean = path.startsWith('/') ? path : `/${path}`;
  return `${DA_ADMIN_ORIGIN}/list/${org}/${repo}${clean}`;
}

/**
 * GET a source file. Returns parsed JSON for `.json` paths, raw text
 * otherwise, or `null` on a 404 ("doesn't exist yet" — never throws for that
 * case so callers don't need a try/catch on first run).
 */
export async function getSource({
  org, repo, path, token,
}) {
  const resp = await fetch(sourcePath(org, repo, path), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`getSource ${path} -> HTTP ${resp.status}`);
  const contentType = resp.headers.get('content-type') || '';
  if (path.endsWith('.json') || contentType.includes('json')) {
    const text = await resp.text();
    return text ? JSON.parse(text) : null;
  }
  return resp.text();
}

/**
 * Create/overwrite a JSON file via the Source API. `json` is stringified and
 * posted as multipart/form-data, per the Source API's file-create contract.
 */
export async function putJsonSource({
  org, repo, path, token, json,
}) {
  const body = new FormData();
  body.append('data', new Blob([JSON.stringify(json)], { type: 'application/json' }), 'data.json');
  const resp = await fetch(sourcePath(org, repo, path), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`putJsonSource ${path} -> HTTP ${resp.status} ${text.slice(0, 200)}`);
  }
  const text = await resp.text().catch(() => '');
  try { return text ? JSON.parse(text) : null; } catch (_) { return null; }
}

/**
 * Create/overwrite a binary file (e.g. an image) via the Source API, having
 * DA fetch the bytes itself from a remote URL. Used by lib/uploadImages.js
 * to write scraped images into the DA site's own /assets/images folder
 * instead of AEM DAM — fetching server-side (rather than a client-side
 * fetch(sourceUrl) + multipart upload) avoids CORS failures on source sites
 * that don't send CORS headers on their image responses.
 */
export async function putRemoteBinarySource({
  org, repo, path, token, sourceUrl, title, alt, tags,
}) {
  const resp = await fetch(sourcePath(org, repo, path), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      path,
      title,
      source: { type: 'url', url: sourceUrl },
      metadata: { alt, tags },
    }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`putRemoteBinarySource ${path} -> HTTP ${resp.status} ${text.slice(0, 200)}`);
  }
}

/**
 * GET a binary file's raw bytes. A plain <img src> can't hit this endpoint
 * (it requires the Authorization bearer header), so callers build an object
 * URL from the returned Blob for previews, or feed it straight to the
 * clipboard (see lib/clipboard.js).
 */
export async function getBinarySource({
  org, repo, path, token,
}) {
  const resp = await fetch(sourcePath(org, repo, path), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!resp.ok) throw new Error(`getBinarySource ${path} -> HTTP ${resp.status}`);
  return resp.blob();
}

export async function deleteSource({
  org, repo, path, token,
}) {
  const resp = await fetch(sourcePath(org, repo, path), {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok && resp.status !== 204) {
    throw new Error(`deleteSource ${path} -> HTTP ${resp.status}`);
  }
}

/** List the children of a folder. Returns `[]` when the folder doesn't exist. */
export async function listSource({
  org, repo, path, token,
}) {
  const resp = await fetch(listPath(org, repo, path), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (resp.status === 404) return [];
  if (!resp.ok) throw new Error(`listSource ${path} -> HTTP ${resp.status}`);
  const json = await resp.json().catch(() => []);
  return Array.isArray(json) ? json : [];
}

/**
 * Preview + publish a single file through the standard EDS admin pipeline.
 * Used for `/theme.json` only — the one shared, publicly-readable file every
 * page's runtime reads, so "apply to site" never needs to touch individual
 * pages the way the old CF + per-page `theme_cf_reference` fan-out did.
 */
export async function publishSource({
  org, repo, ref = 'main', path, token,
}) {
  const clean = path.replace(/^\/+/, '').replace(/\.json$/, '.json');
  const headers = { Authorization: `Bearer ${token}` };
  const preview = await fetch(`${EDS_ADMIN_ORIGIN}/preview/${org}/${repo}/${ref}/${clean}`, { method: 'POST', headers });
  if (!preview.ok) throw new Error(`preview ${path} -> HTTP ${preview.status}`);
  const live = await fetch(`${EDS_ADMIN_ORIGIN}/live/${org}/${repo}/${ref}/${clean}`, { method: 'POST', headers });
  if (!live.ok) throw new Error(`live ${path} -> HTTP ${live.status}`);
}

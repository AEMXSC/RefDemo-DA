/*
 * uploadImages — writes scraped image URLs directly into the current DA
 * site's own content, under /assets/images/<scraped-site-host>/<file>, via
 * DA's Source API (see lib/daAdmin.js). Replaces the old upload-to-dam flow
 * (lib/uploadAssets.js) which wrote into AEM DAM through a backend Runtime
 * action — images now live in DA itself, no AEM Author/DAM involved.
 *
 * Image bytes are fetched via the `fetch-image` Adobe I/O Runtime action
 * (FETCH_IMAGE_ACTION_URL) rather than a direct browser fetch(sourceUrl) —
 * many scraped sites don't send CORS headers on their image responses
 * (common for hotlinked assets), which a browser blocks outright regardless
 * of what's sent. The action fetches server-side and returns the bytes
 * base64-encoded, same response contract as the existing get-dam-asset
 * action (see lib/clipboard.js). Falls back to a direct client-side fetch
 * when FETCH_IMAGE_ACTION_URL isn't configured yet.
 */

import { putBinarySource, publishSource } from './daAdmin.js';
import { base64ToBlob } from './clipboard.js';
import { ASSETS_FOLDER, FETCH_IMAGE_ACTION_URL } from '../config.js';

function folderForSite(siteUrl) {
  try { return new URL(siteUrl).host.replace(/^www\./, '').replace(/\./g, '-'); } catch (_) { return 'unknown-site'; }
}

function filenameForUrl(url, index) {
  try {
    const { pathname } = new URL(url);
    const base = decodeURIComponent(pathname.split('/').filter(Boolean).pop() || '');
    const safe = base.replace(/[^a-zA-Z0-9._-]/g, '_');
    return safe.includes('.') && safe.length > 1 ? safe : `image-${index}.jpg`;
  } catch (_) {
    return `image-${index}.jpg`;
  }
}

/** Best-effort natural dimensions of an already-fetched image blob. */
function readImageDimensions(blob) {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(blob);
    const img = new Image();
    const done = (dims) => { URL.revokeObjectURL(objectUrl); resolve(dims); };
    img.onload = () => done({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => done({ width: null, height: null });
    img.src = objectUrl;
  });
}

/** Direct client-side fetch — used only when the proxy action isn't configured. */
async function fetchImageBlobDirect(sourceUrl) {
  const resp = await fetch(sourceUrl);
  if (!resp.ok) throw new Error(`image fetch failed: HTTP ${resp.status}`);
  return resp.blob();
}

/**
 * Fetch a scraped image's bytes via the fetch-image Runtime action so the
 * request happens server-side, sidestepping the source site's CORS headers
 * entirely. Same request/response shape as copyDamAssetToClipboard's call
 * to get-dam-asset (see lib/clipboard.js) — POST { url }, get back
 * { body: { contentType, base64 } }.
 */
async function fetchImageBlob(sourceUrl) {
  if (!FETCH_IMAGE_ACTION_URL) return fetchImageBlobDirect(sourceUrl);

  const resp = await fetch(FETCH_IMAGE_ACTION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: sourceUrl }),
  });
  const text = await resp.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch (_) { json = null; }
  if (!resp.ok) {
    const msg = (json && json.error && (json.error.body?.error || json.error)) || `HTTP ${resp.status}`;
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
  const { contentType, base64 } = (json && json.body) || json || {};
  if (!base64) throw new Error('fetch-image: invalid response');
  return base64ToBlob(base64, contentType || 'application/octet-stream');
}

/**
 * Preview+publish the uploaded path so it resolves at the site's live
 * delivery URL — the catalog sheet's `url` column needs a genuinely
 * fetchable address, not the (auth-only) Source API path. Best-effort: a
 * publish failure still leaves the image written and browsable, just
 * without a catalog `url` value.
 */
async function deliveryUrl({
  org, repo, ref, path, token,
}) {
  await publishSource({
    org, repo, ref, path, token,
  });
  return `https://${ref}--${repo}--${org}.aem.live${path}`;
}

/**
 * @param {string[]} sourceUrls
 * @param {object} ctx
 * @param {string} ctx.token   DA SDK bearer token
 * @param {string} ctx.org
 * @param {string} ctx.repo
 * @param {string} ctx.ref     Branch ref to preview/publish onto (default 'main')
 * @param {string} ctx.siteUrl Source page URL the images were scraped from
 * @yields {object} per-image result — { sourceUrl, ok, path?, url?, width?,
 *   height?, brand?, label?, error? }
 */
export async function* uploadImagesToDa(sourceUrls, ctx) {
  const {
    token, org, repo, ref, siteUrl,
  } = ctx || {};
  if (!token) throw new Error('uploadImagesToDa: missing token');
  if (!org || !repo) throw new Error('uploadImagesToDa: missing org/repo');

  const folder = folderForSite(siteUrl);
  const urls = (sourceUrls || []).filter(Boolean);

  for (let i = 0; i < urls.length; i += 1) {
    const sourceUrl = urls[i];
    try {
      // sequential so upload progress can be reported incrementally, same as the DAM flow did
      // eslint-disable-next-line no-await-in-loop
      const blob = await fetchImageBlob(sourceUrl);
      // Guards against SVGs that dodge imagesTab's isSvg() URL check (e.g. a
      // path with no ".svg" extension that actually serves SVG bytes) —
      // without this they'd be written with a raster filename/extension and
      // fail to decode later, at copy time, with no way to tell why.
      if (blob.type === 'image/svg+xml') throw new Error('SVG image — not imported');
      const filename = filenameForUrl(sourceUrl, i);
      const path = `${ASSETS_FOLDER}/${folder}/${filename}`;
      // eslint-disable-next-line no-await-in-loop
      await putBinarySource({
        org, repo, path, token, blob, filename,
      });
      // eslint-disable-next-line no-await-in-loop
      const [{ width, height }, url] = await Promise.all([
        readImageDimensions(blob),
        deliveryUrl({
          org, repo, ref: ref || 'main', path, token,
        }).catch(() => ''),
      ]);
      yield {
        sourceUrl,
        ok: true,
        path,
        url,
        width,
        height,
        brand: folder,
        label: filename.replace(/\.[^./]+$/, ''),
      };
    } catch (err) {
      yield { sourceUrl, ok: false, error: (err && err.message) || String(err) };
    }
  }
}

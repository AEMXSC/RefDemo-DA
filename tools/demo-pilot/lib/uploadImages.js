/*
 * uploadImages — writes scraped image URLs directly into the current DA
 * site's own content, under /assets/images/<scraped-site-host>/<file>, via
 * DA's Source API (see lib/daAdmin.js). Replaces the old upload-to-dam flow
 * (lib/uploadAssets.js) which wrote into AEM DAM through a backend Runtime
 * action — images now live in DA itself, no AEM Author/DAM involved.
 *
 * Image bytes are fetched client-side (fetch(sourceUrl)) with no backend
 * proxy — DA's Source API has no "fetch this remote URL for me" mode (see
 * putBinarySource in lib/daAdmin.js), so there's no way to avoid this fetch.
 * Source sites that don't send CORS headers on their image responses
 * (common for hotlinked assets) will fail per-image — surfaced as a normal
 * { ok: false, error } result rather than aborting the batch.
 */

import { putBinarySource, publishSource } from './daAdmin.js';
import { ASSETS_FOLDER } from '../config.js';

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
      const resp = await fetch(sourceUrl);
      if (!resp.ok) throw new Error(`image fetch failed: HTTP ${resp.status}`);
      // eslint-disable-next-line no-await-in-loop
      const blob = await resp.blob();
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

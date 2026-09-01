/*
 * uploadImages — writes scraped image URLs directly into the current DA
 * site's own content, under /assets/images/<scraped-site-host>/<file>, via
 * DA's Source API (see lib/daAdmin.js). Replaces the old upload-to-dam flow
 * (lib/uploadAssets.js) which wrote into AEM DAM through a backend Runtime
 * action — images now live in DA itself, no AEM Author/DAM involved.
 *
 * The Source API is given the sourceUrl and fetches the bytes itself
 * (putRemoteBinarySource) rather than the plugin fetching them client-side —
 * source sites commonly don't send CORS headers on their image responses,
 * which made a client-side fetch(sourceUrl) fail per-image.
 */

import { putRemoteBinarySource, publishSource } from './daAdmin.js';
import { ASSETS_FOLDER } from '../config.js';

function folderForSite(siteUrl) {
  try { return new URL(siteUrl).host.replace(/^www\./, ''); } catch (_) { return 'unknown-site'; }
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

/**
 * Best-effort natural dimensions of a (possibly cross-origin) image URL.
 * Reading naturalWidth/naturalHeight off a loaded <img> doesn't require CORS
 * headers — only pixel access (canvas, etc.) does — so this works directly
 * against the original sourceUrl.
 */
function readImageDimensions(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: null, height: null });
    img.src = url;
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
      const filename = filenameForUrl(sourceUrl, i);
      const path = `${ASSETS_FOLDER}/${folder}/${filename}`;
      // sequential so upload progress can be reported incrementally, same as the DAM flow did
      // eslint-disable-next-line no-await-in-loop
      await putRemoteBinarySource({
        org, repo, path, token, sourceUrl, title: filename,
      });
      // eslint-disable-next-line no-await-in-loop
      const [{ width, height }, url] = await Promise.all([
        readImageDimensions(sourceUrl),
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

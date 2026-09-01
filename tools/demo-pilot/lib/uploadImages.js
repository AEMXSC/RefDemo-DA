/*
 * uploadImages — writes scraped image URLs directly into the current DA
 * site's own content, under /assets/images/<scraped-site-host>/<file>, via
 * DA's Source API (see lib/daAdmin.js). Replaces the old upload-to-dam flow
 * (lib/uploadAssets.js) which wrote into AEM DAM through a backend Runtime
 * action — images now live in DA itself, no AEM Author/DAM involved.
 *
 * Image bytes are fetched client-side (fetch(sourceUrl)) with no backend
 * proxy. This means source sites that don't send CORS headers on their image
 * responses (common for hotlinked assets) will fail per-image — surfaced as
 * a normal { ok: false, error } result rather than aborting the batch.
 */

import { putBinarySource } from './daAdmin.js';
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
 * @param {string[]} sourceUrls
 * @param {object} ctx
 * @param {string} ctx.token   DA SDK bearer token
 * @param {string} ctx.org
 * @param {string} ctx.repo
 * @param {string} ctx.siteUrl Source page URL the images were scraped from
 * @yields {object} per-image result — { sourceUrl, ok, path?, error? }
 */
export async function* uploadImagesToDa(sourceUrls, ctx) {
  const {
    token, org, repo, siteUrl,
  } = ctx || {};
  if (!token) throw new Error('uploadImagesToDa: missing token');
  if (!org || !repo) throw new Error('uploadImagesToDa: missing org/repo');

  const folder = folderForSite(siteUrl);
  const urls = (sourceUrls || []).filter(Boolean);

  for (let i = 0; i < urls.length; i += 1) {
    const sourceUrl = urls[i];
    try {
      // eslint-disable-next-line no-await-in-loop -- sequential so upload
      // progress can be reported incrementally, same as the DAM flow did
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
      yield { sourceUrl, ok: true, path };
    } catch (err) {
      yield { sourceUrl, ok: false, error: (err && err.message) || String(err) };
    }
  }
}

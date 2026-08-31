/*
 * uploadAssets — batch-upload scraped image URLs into AEM DAM via the kept
 * `upload-to-dam` Adobe I/O Runtime action. Ported from the UE extension
 * unchanged — this action talks to the AEM Assets HTTP API, not CRX/JCR, so
 * it works identically regardless of whether pages are UE/AEM Sites or DA/EDS.
 */

import { UPLOAD_TO_DAM_ACTION_URL } from '../config.js';

// Adobe I/O Runtime web actions (the https://*.adobeioruntime.net/.../web/...
// URL this action is invoked through) sit behind a gateway with a hard,
// non-configurable external timeout for synchronous HTTP responses — well
// under a minute in practice. upload-to-dam processes each image sequentially
// (existence check + optional version checkpoint + initiate + PUT + complete
// against the AEM Assets API), so batches of more than 1-2 images routinely
// exceed it and the whole batch comes back as a 504 with nothing uploaded.
// Smaller batches mean more round trips but each one reliably finishes.
export const UPLOAD_BATCH_SIZE = 1;

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function invokeAction(url, body) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch (_) { json = null; }
  if (!resp.ok) {
    const msg = (json && json.error && (json.error.body?.error || json.error)) || `HTTP ${resp.status}`;
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
  return json;
}

/**
 * @param {string[]} sourceUrls
 * @param {object} ctx
 * @param {string} ctx.imsToken         DA SDK bearer token
 * @param {string} ctx.authorUrl        AEM Author URL (still required by the action)
 * @param {string} ctx.orgId            IMS org id
 * @param {string} ctx.targetFolderPath DAM root folder for imports
 * @param {string} ctx.siteUrl          Source page URL the images were scraped from
 * @yields {object} per-image result — { sourceUrl, ok, path?, error?, fileName? }
 */
export async function* uploadAssetsInBatches(sourceUrls, ctx) {
  const { imsToken, authorUrl, orgId, targetFolderPath, siteUrl } = ctx || {};
  if (!UPLOAD_TO_DAM_ACTION_URL) throw new Error('uploadAssetsInBatches: UPLOAD_TO_DAM_ACTION_URL not configured');
  if (!imsToken) throw new Error('uploadAssetsInBatches: missing imsToken');
  if (!authorUrl) throw new Error('uploadAssetsInBatches: missing authorUrl');
  if (!targetFolderPath) throw new Error('uploadAssetsInBatches: missing targetFolderPath');

  const batches = chunk(sourceUrls.filter(Boolean), UPLOAD_BATCH_SIZE);

  for (const batch of batches) {
    const body = {
      imageUrls: batch,
      authorUrl,
      orgId,
      targetFolderPath,
      siteUrl,
      bearer: imsToken,
    };

    let resp;
    try {
      // eslint-disable-next-line no-await-in-loop -- sequential batches by design, see module doc
      resp = await invokeAction(UPLOAD_TO_DAM_ACTION_URL, body);
    } catch (err) {
      const msg = (err && err.message) || String(err);
      for (const sourceUrl of batch) yield { sourceUrl, ok: false, error: msg };
      continue;
    }

    const results = (resp && Array.isArray(resp.results) && resp.results)
      || (resp && resp.body && Array.isArray(resp.body.results) && resp.body.results)
      || null;

    if (!results) {
      const msg = resp?.error?.body?.error || resp?.error || 'upload-to-dam: invalid response';
      for (const sourceUrl of batch) yield { sourceUrl, ok: false, error: typeof msg === 'string' ? msg : JSON.stringify(msg) };
      continue;
    }

    for (const r of results) yield r;
  }
}

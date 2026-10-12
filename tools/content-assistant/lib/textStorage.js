/*
 * textStorage — persist scraped texts, replacing the old
 * /var/text-storage/{siteSlug} JCR node with a plain JSON file via the DA
 * Source API. One file per repo (site) — org/repo already scope it, so no
 * slug-sanitizing is needed the way the JCR node name required.
 */

import { getSource, putJsonSource } from './daAdmin.js';
import { TEXTS_PATH } from '../config.js';

/** Read the merged, grouped-by-component texts object. `{}` on first run. */
export async function readTexts({ org, repo, token }) {
  const json = await getSource({ org, repo, token, path: TEXTS_PATH });
  return (json && typeof json === 'object' && !Array.isArray(json)) ? json : {};
}

/** Overwrite the stored texts object. Caller merges client-side before calling. */
export async function writeTexts({ org, repo, token, texts }) {
  await putJsonSource({ org, repo, token, path: TEXTS_PATH, json: texts });
}

/*
 * clipboard — "copy" is the entire insertion mechanic for this plugin. DA's
 * plugin SDK only exposes sendHTML/sendText for a *known-good* replace-vs-insert
 * semantic that we haven't validated against an arbitrary selection, so instead
 * we copy the picked image/text to the system clipboard and let the author
 * paste it wherever they want in the open DA document — works identically
 * whether they want to insert fresh or replace a current selection, and needs
 * zero DA SDK selection assumptions.
 */

import { GET_DAM_ASSET_ACTION_URL } from '../config.js';

// Clipboard image writes are commonly restricted to image/png across browsers,
// so any other source mimetype (jpg/webp/svg) is re-encoded via a canvas
// before writing.
async function toPngBlob(sourceBlob) {
  if (sourceBlob.type === 'image/png') return sourceBlob;
  const bitmap = await createImageBitmap(sourceBlob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('canvas.toBlob failed'))), 'image/png');
  });
}

/**
 * Fetch an already-public image URL and place it on the clipboard as PNG.
 * Only usable when the URL is actually browser-fetchable — real DAM repo
 * paths are NOT (see copyDamAssetToClipboard for those). Used for the
 * local-dev fallback path and the debug harness's proxy escape hatch.
 */
export async function copyImageToClipboard(imageUrl) {
  // Local-debug-only escape hatch (see dev/debug.html?proxy=1): scraped
  // images not yet uploaded to DAM live on arbitrary third-party origins that
  // don't send CORS headers for a fetch(), unlike real DAM delivery URLs
  // which do. Route through the local dev proxy's generic /img passthrough
  // in that case. Inert in production — the plugin never sets this global.
  const fetchUrl = (typeof window !== 'undefined' && window.__DEMO_PILOT_IMAGE_PROXY_BASE__)
    ? `${window.__DEMO_PILOT_IMAGE_PROXY_BASE__}/img?url=${encodeURIComponent(imageUrl)}`
    : imageUrl;
  const resp = await fetch(fetchUrl);
  if (!resp.ok) throw new Error(`image fetch failed: HTTP ${resp.status}`);
  const rawBlob = await resp.blob();
  const pngBlob = await toPngBlob(rawBlob);
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
}

function base64ToBlob(base64, contentType) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: contentType });
}

/**
 * Place a real DAM asset (bare repo path, e.g. /content/dam/imported-assets/
 * en/nike-com/foo.png) on the clipboard as PNG. Routes through the
 * `get-dam-asset` action — a plain browser fetch() against the DAM path
 * resolves against the wrong origin (the DA site's delivery domain, not AEM)
 * and, even pointed at the right host, AEM Author generally isn't CORS-open
 * to arbitrary browser origins. The action fetches server-side instead.
 */
export async function copyDamAssetToClipboard({ assetPath, authorUrl, orgId, token }) {
  if (!GET_DAM_ASSET_ACTION_URL) throw new Error('GET_DAM_ASSET_ACTION_URL not configured');
  if (!assetPath) throw new Error('missing assetPath');
  if (!authorUrl) throw new Error('missing authorUrl');
  const resp = await fetch(GET_DAM_ASSET_ACTION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ authorUrl, assetPath, orgId, bearer: token }),
  });
  const text = await resp.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch (_) { json = null; }
  if (!resp.ok) {
    const msg = (json && json.error && (json.error.body?.error || json.error)) || `HTTP ${resp.status}`;
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
  const { contentType, base64 } = (json && json.body) || json || {};
  if (!base64) throw new Error('get-dam-asset: invalid response');
  const rawBlob = base64ToBlob(base64, contentType || 'application/octet-stream');
  const pngBlob = await toPngBlob(rawBlob);
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
}

/** Place plain text on the clipboard. */
export async function copyTextToClipboard(text) {
  await navigator.clipboard.writeText(String(text ?? ''));
}

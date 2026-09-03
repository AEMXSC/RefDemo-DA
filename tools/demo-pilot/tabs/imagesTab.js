/*
 * imagesTab — scrape + upload-to-DA for images, plus a persistent folder
 * browser (lib/assetBrowser.js) for the whole /assets/images folder in this
 * DA site — replaces the UE extension's ImagesTab.js + replaceImage.js:
 * instead of an embedded UE-selection "replace" call, picking an image just
 * copies it to the clipboard so the author can paste it into the open DA
 * document.
 *
 * This tab builds its DOM shell once per container (see `dpBuilt` guard)
 * rather than on every render like the other tabs — re-creating the
 * browser's DOM on every upload-progress tick would be expensive and
 * visibly flickery.
 */

import { uploadImagesToDa } from '../lib/uploadImages.js';
import { copyDaAssetToClipboard } from '../lib/clipboard.js';
import { openScrapeModal } from '../lib/scrapeModal.js';
import { mountAssetBrowser } from '../lib/assetBrowser.js';
import { track, EVENTS } from '../lib/analytics.js';
import { appendCatalogRows } from '../lib/assetsCatalog.js';
import { ASSETS_FOLDER } from '../config.js';

// Most SVGs a scrape turns up are decorative iconography/logos (nav icons,
// social badges, "AdChoices", etc.), not content an author wants to reuse —
// excluded by default rather than uploading dozens of icons alongside the
// handful of real images.
function isSvg(url) {
  // data: URIs (icon sets frequently inline SVGs this way) parse fine as a
  // URL but their .pathname is the encoded payload, never ending in ".svg"
  // — check the declared mime type directly instead.
  if (/^data:image\/svg\+xml/i.test(url || '')) return true;
  try { return new URL(url).pathname.toLowerCase().endsWith('.svg'); } catch (_) { return /\.svg(\?|$)/i.test(url || ''); }
}

async function copyImage(assetPath, ctx, toast) {
  try {
    await copyDaAssetToClipboard({
      assetPath, org: ctx.org, repo: ctx.repo, token: ctx.token,
    });
    track(EVENTS.IMAGE_COPIED);
    toast('Image copied — paste it into your document.');
  } catch (err) {
    toast((err && err.message) || 'Copy failed', true);
  }
}

export function renderImagesTab(container, ctx) {
  const { state, rerender, toast } = ctx;

  if (!container.dataset.dpBuilt) {
    container.dataset.dpBuilt = '1';
    container.innerHTML = `
      <div class="dp-images-tab">
        <div class="dp-row">
          <strong>Images</strong>
        </div>
        <p class="dp-status" id="dp-images-status"></p>
        <div class="dp-row"><p>Browse assets folder</p></div>
        <p class="dp-error" id="dp-selector-error"></p>
        <div id="dp-asset-selector-mount" class="dp-browser-mount"></div>
        <button type="button" id="dp-images-import" class="dp-import-fab" title="Import from URL" aria-label="Import from URL">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M2.5 3.5A1.5 1.5 0 0 1 4 2h4l2.5 2.5V12.5A1.5 1.5 0 0 1 9 14H4a1.5 1.5 0 0 1-1.5-1.5Z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" />
            <path d="M8 2v2.5h2.5" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" />
            <path d="M2.7 8h5.1M5.5 5.8 8 8l-2.5 2.2" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
      </div>
    `;

    container.querySelector('#dp-images-import').addEventListener('click', () => {
      openScrapeModal({
        token: ctx.token,
        mode: 'images',
        onComplete: async ({ images: scrapedImages, siteUrl }) => {
          track(EVENTS.IMPORT_STARTED);
          const allUrls = (scrapedImages || []).map((i) => i.src).filter(Boolean);
          const svgCount = allUrls.filter(isSvg).length;
          const urls = allUrls.filter((u) => !isSvg(u));
          if (svgCount) toast(`Skipped ${svgCount} SVG icon(s) \u2014 not imported.`);

          state.uploadStatus = `Uploading 0/${urls.length}\u2026`;
          rerender();
          let done = 0;
          let failed = 0;
          try {
            for await (const result of uploadImagesToDa(urls, {
              token: ctx.token,
              org: ctx.org,
              repo: ctx.repo,
              ref: ctx.ref,
              siteUrl,
            })) {
              done += 1;
              if (result.ok && result.path) {
                // Record the import in the shared assets-catalog sheet —
                // best-effort, a catalog write failure shouldn't drop an
                // otherwise-successful upload.
                appendCatalogRows({
                  org: ctx.org,
                  repo: ctx.repo,
                  token: ctx.token,
                  rows: [{
                    id: result.path,
                    url: result.url || '',
                    thumb: result.url || '',
                    label: result.label || '',
                    tags: result.brand || '',
                    path: result.path,
                    brand: result.brand || '',
                  }],
                }).catch((err) => toast(`Catalog update failed: ${(err && err.message) || err}`, true));
              } else {
                failed += 1;
              }
              state.uploadStatus = `Uploading ${done}/${urls.length}\u2026${failed ? ` (${failed} failed)` : ''}`;
              rerender();
            }
            track(EVENTS.IMPORT_COMPLETED);
          } catch (err) {
            toast((err && err.message) || 'Upload failed', true);
          } finally {
            state.uploadStatus = '';
            rerender();
          }
        },
      });
    });
  }

  container.querySelector('#dp-images-status').textContent = state.uploadStatus || '';

  // Mount/refresh the folder browser only when its inputs actually change —
  // not on every rerender (see module doc).
  const selectorMount = container.querySelector('#dp-asset-selector-mount');
  const mountKey = `${ctx.token}|${ctx.org}|${ctx.repo}`;
  if (selectorMount.dataset.mountKey !== mountKey && ctx.token && ctx.org && ctx.repo) {
    selectorMount.dataset.mountKey = mountKey;
    mountAssetBrowser(selectorMount, {
      token: ctx.token,
      org: ctx.org,
      repo: ctx.repo,
      rootPath: ASSETS_FOLDER,
      onAssetPick: (assetPath) => copyImage(assetPath, ctx, toast),
    }).catch((err) => {
      container.querySelector('#dp-selector-error').textContent = (err && err.message) || 'Could not load the assets folder.';
    });
  }
}

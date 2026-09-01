/*
 * imagesTab — scrape + upload-to-DA + copy-to-clipboard for images, plus a
 * persistent folder browser (lib/assetBrowser.js) for the whole
 * /assets/images folder in this DA site (not just this session's scraped
 * images) — replaces the UE extension's ImagesTab.js + replaceImage.js:
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
import { copyImageToClipboard, copyDaAssetToClipboard } from '../lib/clipboard.js';
import { openScrapeModal } from '../lib/scrapeModal.js';
import { mountAssetBrowser } from '../lib/assetBrowser.js';
import { track, EVENTS } from '../lib/analytics.js';
import { saveCachedImages } from '../lib/imageCache.js';
import { appendCatalogRows } from '../lib/assetsCatalog.js';
import { ASSETS_FOLDER } from '../config.js';

// Most SVGs a scrape turns up are decorative iconography/logos (nav icons,
// social badges, "AdChoices", etc.), not content an author wants to reuse —
// excluded by default rather than uploading dozens of icons alongside the
// handful of real images.
function isSvg(url) {
  try { return new URL(url).pathname.toLowerCase().endsWith('.svg'); } catch (_) { return /\.svg(\?|$)/i.test(url || ''); }
}

async function copyImage(img, ctx, toast) {
  try {
    if (img.path) {
      await copyDaAssetToClipboard({
        assetPath: img.path, org: ctx.org, repo: ctx.repo, token: ctx.token,
      });
    } else {
      await copyImageToClipboard(img.src);
    }
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
      <div class="dp-row">
        <strong>Images</strong>
        <sl-button id="dp-images-import">Import from URL</sl-button>
      </div>
      <p class="dp-status" id="dp-images-status"></p>
      <div class="dp-grid" id="dp-images-grid"></div>
      <p class="dp-status" id="dp-images-empty"></p>
      <div class="dp-row" style="margin-top:16px;"><strong>Browse assets folder</strong></div>
      <p class="dp-error" id="dp-selector-error"></p>
      <div id="dp-asset-selector-mount" style="height:320px; overflow:auto;"></div>
    `;

    container.querySelector('#dp-images-grid').addEventListener('click', async (e) => {
      const btn = e.target.closest('.dp-copy-btn');
      if (!btn) return;
      const idx = Number(btn.getAttribute('data-idx'));
      const img = (ctx.state.images || [])[idx];
      if (!img) return;
      btn.setAttribute('disabled', 'true');
      await copyImage(img, ctx, toast);
      btn.removeAttribute('disabled');
    });

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
          const srcByUrl = new Map((scrapedImages || []).map((i) => [i.src, i.src]));
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
                // Keep the original scraped URL for immediate <img> preview
                // (plain display never needs the authenticated Source API
                // fetch) alongside the DA source path (needed for Copy, via
                // getBinarySource — see clipboard.js).
                state.images.push({ src: srcByUrl.get(result.sourceUrl) || result.sourceUrl, path: result.path });
                // Persist after every successful item, not just at the end —
                // a failed later item shouldn't lose progress already made.
                saveCachedImages({ org: ctx.org, repo: ctx.repo, images: state.images });
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
                    thumbnail: result.url || '',
                    label: result.label || '',
                    tags: result.brand || '',
                    width: result.width || '',
                    height: result.height || '',
                    brand: result.brand || '',
                    path: result.path,
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

  const images = state.images || [];
  container.querySelector('#dp-images-empty').textContent = images.length === 0 ? 'No images yet. Import from a live URL to get started.' : '';

  const grid = container.querySelector('#dp-images-grid');
  grid.innerHTML = '';
  images.forEach((img, idx) => {
    const card = document.createElement('div');
    card.className = 'dp-card';
    // img.src is always a directly displayable URL (the original scraped
    // source, or a scrape-mode fallback). img.path is a DA Source API path
    // and requires an authenticated fetch — never usable as a plain <img
    // src> (see lib/assetBrowser.js, which fetches it via getBinarySource).
    card.innerHTML = `
      <img src="${img.src}" alt="" loading="lazy" />
      <sl-button class="dp-copy-btn" data-idx="${idx}">Copy</sl-button>
    `;
    grid.appendChild(card);
  });

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
      onAssetPick: (assetPath) => copyImage({ path: assetPath }, ctx, toast),
    }).catch((err) => {
      container.querySelector('#dp-selector-error').textContent = (err && err.message) || 'Could not load the assets folder.';
    });
  }
}

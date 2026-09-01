/*
 * imagesTab — scrape + upload-to-DAM + copy-to-clipboard for images, plus a
 * persistent AEM Assets Selector for browsing the whole imported-assets DAM
 * folder (not just this session's scraped images) — replaces the UE
 * extension's ImagesTab.js + replaceImage.js: instead of an embedded
 * UE-selection "replace" call, picking an image just copies it to the
 * clipboard so the author can paste it into the open DA document.
 *
 * This tab builds its DOM shell once per container (see `dpBuilt` guard)
 * rather than on every render like the other tabs — re-creating the Asset
 * Selector's DOM on every upload-progress tick would tear down and reload
 * Adobe's widget repeatedly, which is expensive and visibly flickery.
 */

import { uploadAssetsInBatches } from '../lib/uploadAssets.js';
import { copyImageToClipboard, copyDamAssetToClipboard } from '../lib/clipboard.js';
import { openScrapeModal } from '../lib/scrapeModal.js';
import { mountAssetSelector, repositoryIdFromAuthorUrl } from '../lib/assetSelector.js';
import { track, EVENTS } from '../lib/analytics.js';
import { saveCachedImages } from '../lib/imageCache.js';
import { UPLOAD_TO_DAM_ACTION_URL } from '../config.js';

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
      await copyDamAssetToClipboard({ assetPath: img.path, authorUrl: ctx.authorUrl, orgId: ctx.orgId, token: ctx.token });
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
      <div class="dp-row" style="margin-top:16px;"><strong>Browse DAM folder</strong></div>
      <p class="dp-error" id="dp-selector-error"></p>
      <div id="dp-asset-selector-mount" style="height:320px;"></div>
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

          // Local-dev fallback: without a deployed upload-to-dam action
          // there's nothing to upload to, so show the scraped (hot-linked)
          // URLs directly — good enough to exercise the copy-to-clipboard
          // flow. Real usage always goes through the DAM upload below.
          if (!UPLOAD_TO_DAM_ACTION_URL) {
            state.images.push(...urls.map((src) => ({ src })));
            saveCachedImages({ org: ctx.org, repo: ctx.repo, images: state.images });
            toast('upload-to-dam not configured — showing scraped URLs directly (not uploaded to DAM).', true);
            track(EVENTS.IMPORT_COMPLETED);
            rerender();
            return;
          }

          state.uploadStatus = `Uploading 0/${urls.length}\u2026`;
          rerender();
          let done = 0;
          let failed = 0;
          const srcByUrl = new Map((scrapedImages || []).map((i) => [i.src, i.src]));
          try {
            for await (const result of uploadAssetsInBatches(urls, {
              imsToken: ctx.token,
              authorUrl: ctx.authorUrl,
              orgId: ctx.orgId,
              targetFolderPath: ctx.damFolderPath,
              siteUrl,
            })) {
              done += 1;
              if (result.ok && result.path) {
                // Keep the original scraped URL for immediate <img> preview
                // (plain display never needs CORS) alongside the real DAM
                // path (needed for Copy, via get-dam-asset — see clipboard.js).
                state.images.push({ src: srcByUrl.get(result.sourceUrl) || result.sourceUrl, path: result.path });
                // Persist after every successful item, not just at the end —
                // a later batch timing out (large imports commonly hit the
                // Runtime web action's ~60s gateway ceiling) shouldn't lose
                // progress already made.
                saveCachedImages({ org: ctx.org, repo: ctx.repo, images: state.images });
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
  container.querySelector('#dp-images-empty').textContent =
    images.length === 0 ? 'No images yet. Import from a live URL to get started.' : '';

  const grid = container.querySelector('#dp-images-grid');
  grid.innerHTML = '';
  images.forEach((img, idx) => {
    const card = document.createElement('div');
    card.className = 'dp-card';
    card.innerHTML = `
      <img src="${img.src || img.path}" alt="" loading="lazy" />
      <sl-button class="dp-copy-btn" data-idx="${idx}">Copy</sl-button>
    `;
    grid.appendChild(card);
  });

  // Mount/refresh the Asset Selector only when its inputs actually change —
  // not on every rerender (see module doc).
  const selectorMount = container.querySelector('#dp-asset-selector-mount');
  const repositoryId = repositoryIdFromAuthorUrl(ctx.authorUrl);
  const mountKey = `${ctx.token}|${ctx.orgId}|${repositoryId}|${ctx.damFolderPath}`;
  if (selectorMount.dataset.mountKey !== mountKey && ctx.token && repositoryId && ctx.damFolderPath) {
    selectorMount.dataset.mountKey = mountKey;
    mountAssetSelector(selectorMount, {
      imsToken: ctx.token,
      imsOrg: ctx.orgId,
      repositoryId,
      path: ctx.damFolderPath,
      onAssetPick: (damPath) => copyImage({ path: damPath }, ctx, toast),
    }).catch((err) => {
      container.querySelector('#dp-selector-error').textContent = (err && err.message) || 'Could not load the AEM Asset Selector.';
    });
  }
}

/*
 * imagesTab — scrape + upload-to-DA or scrape + upload-to-DAM (AEM), with an
 * asset-source switcher. DA uses the site's own /assets/images browser;
 * AEM uses the embedded Asset Selector against a DAM folder. Both flows keep
 * the same clipboard-based insertion model: picking an image copies it so the
 * author can paste it into the open DA document.
 *
 * This tab builds its DOM shell once per container (see `dpBuilt` guard)
 * rather than on every render like the other tabs — re-creating the
 * browser's DOM on every upload-progress tick would be expensive and
 * visibly flickery.
 */

import { uploadImagesToDa } from '../lib/uploadImages.js';
import { uploadAssetsInBatches } from '../lib/uploadAssets.js';
import { copyDaAssetToClipboard, copyDamAssetToClipboard } from '../lib/clipboard.js';
import { openScrapeModal } from '../lib/scrapeModal.js';
import { mountAssetBrowser } from '../lib/assetBrowser.js';
import { mountAssetSelector, repositoryIdFromAuthorUrl } from '../lib/assetSelector.js';
import { track, EVENTS } from '../lib/analytics.js';
import { appendCatalogRows } from '../lib/assetsCatalog.js';
import { ASSETS_FOLDER, UPLOAD_TO_DAM_ACTION_URL } from '../config.js';

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

async function copyDamPath(damPath, ctx, toast) {
  try {
    await copyDamAssetToClipboard({
      assetPath: damPath,
      authorUrl: ctx.authorUrl,
      orgId: ctx.orgId,
      token: ctx.token,
    });
    track(EVENTS.IMAGE_COPIED);
    toast('Image copied — paste it into your document.');
  } catch (err) {
    toast((err && err.message) || 'Copy failed', true);
  }
}

async function consumeAsyncResults(iterable, onResult) {
  const iterator = iterable[Symbol.asyncIterator]();

  async function next() {
    const { value, done } = await iterator.next();
    if (done) return;
    await onResult(value);
    await next();
  }

  await next();
}

async function importImagesToDa(scrapedImages, siteUrl, ctx) {
  const { state, rerender, toast } = ctx;
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
    await consumeAsyncResults(uploadImagesToDa(urls, {
      token: ctx.token,
      org: ctx.org,
      repo: ctx.repo,
      ref: ctx.ref,
      siteUrl,
    }), async (result) => {
      done += 1;
      if (result.ok && result.path) {
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
    });
    track(EVENTS.IMPORT_COMPLETED);
  } catch (err) {
    toast((err && err.message) || 'Upload failed', true);
  } finally {
    state.uploadStatus = '';
    rerender();
  }
}

async function importImagesToAem(scrapedImages, siteUrl, ctx) {
  const { state, rerender, toast } = ctx;
  if (!UPLOAD_TO_DAM_ACTION_URL) {
    toast('upload-to-dam action is not configured — cannot import images.', true);
    return;
  }

  track(EVENTS.IMPORT_STARTED);
  const allUrls = (scrapedImages || []).map((i) => i.src).filter(Boolean);
  const svgCount = allUrls.filter(isSvg).length;
  const urls = allUrls.filter((u) => !isSvg(u));
  if (svgCount) toast(`Skipped ${svgCount} SVG icon(s) \u2014 not imported.`);

  state.uploadStatus = `Uploading 0/${urls.length}\u2026`;
  rerender();
  let done = 0;
  let failed = 0;
  let skipped = 0;
  try {
    await consumeAsyncResults(uploadAssetsInBatches(urls, {
      imsToken: ctx.token,
      authorUrl: ctx.authorUrl,
      orgId: ctx.orgId,
      targetFolderPath: ctx.damFolderPath,
      siteUrl,
    }), async (result) => {
      done += 1;
      if (result.skipped) {
        skipped += 1;
      } else if (!result.ok || !result.path) {
        failed += 1;
      }
      state.uploadStatus = `Uploading ${done}/${urls.length}\u2026${failed ? ` (${failed} failed)` : ''}${skipped ? ` (${skipped} SVG skipped)` : ''}`;
      rerender();
    });
    track(EVENTS.IMPORT_COMPLETED);
    state.selectorRefresh = (state.selectorRefresh || 0) + 1;
  } catch (err) {
    toast((err && err.message) || 'Upload failed', true);
  } finally {
    state.uploadStatus = '';
    rerender();
  }
}

export default function renderImagesTab(container, ctx) {
  const { state, rerender, toast } = ctx;
  if (!state.imageAssetSource) state.imageAssetSource = 'da';

  if (!container.dataset.dpBuilt) {
    container.dataset.dpBuilt = '1';
    container.innerHTML = `
      <div class="dp-images-tab">
        <div class="dp-row">
          <strong>Images</strong>
        </div>
        <div class="dp-row dp-inline-field-row">
          <label class="dp-inline-field-label" for="dp-asset-source">Asset Source</label>
          <select id="dp-asset-source" class="dp-select">
            <option value="da">DA</option>
            <option value="aem">AEM</option>
          </select>
        </div>
        <p class="dp-status" id="dp-images-status"></p>
        <div class="dp-row"><p id="dp-images-browser-label">Browse assets folder</p></div>
        <p class="dp-error" id="dp-selector-error"></p>
        <div id="dp-asset-selector-mount" class="dp-browser-mount"></div>
        <div class="dp-import-footer">
          <button type="button" id="dp-images-import" class="dp-import-fab" title="Import from URL" aria-label="Import from URL">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M2.5 3.5A1.5 1.5 0 0 1 4 2h4l2.5 2.5V12.5A1.5 1.5 0 0 1 9 14H4a1.5 1.5 0 0 1-1.5-1.5Z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" />
              <path d="M8 2v2.5h2.5" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" />
              <path d="M2.7 8h5.1M5.5 5.8 8 8l-2.5 2.2" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
        </div>
      </div>
    `;

    container.querySelector('#dp-asset-source').addEventListener('change', (e) => {
      state.imageAssetSource = e.target.value;
      container.querySelector('#dp-selector-error').textContent = '';
      rerender();
    });

    container.querySelector('#dp-images-import').addEventListener('click', () => {
      openScrapeModal({
        token: ctx.token,
        mode: 'images',
        onComplete: async ({ images: scrapedImages, siteUrl }) => {
          if (state.imageAssetSource === 'aem') {
            await importImagesToAem(scrapedImages, siteUrl, ctx);
            return;
          }
          await importImagesToDa(scrapedImages, siteUrl, ctx);
        },
      });
    });
  }

  container.querySelector('#dp-images-status').textContent = state.uploadStatus || '';
  container.querySelector('#dp-asset-source').value = state.imageAssetSource;
  container.querySelector('#dp-images-browser-label').textContent = state.imageAssetSource === 'aem'
    ? 'Browse AEM assets folder'
    : 'Browse assets folder';

  const selectorMount = container.querySelector('#dp-asset-selector-mount');
  const errorEl = container.querySelector('#dp-selector-error');
  const source = state.imageAssetSource;
  const repositoryId = repositoryIdFromAuthorUrl(ctx.authorUrl);
  const mountKey = source === 'aem'
    ? `${source}|${ctx.token}|${ctx.orgId}|${ctx.assetSelectorApiKey}|${repositoryId}|${ctx.damFolderPath}|${state.selectorRefresh || 0}`
    : `${source}|${ctx.token}|${ctx.org}|${ctx.repo}`;

  if (selectorMount.dataset.mountKey !== mountKey) {
    selectorMount.dataset.mountKey = mountKey;
    selectorMount.innerHTML = '';
    errorEl.textContent = '';

    if (source === 'aem') {
      if (!ctx.token || !repositoryId || !ctx.damFolderPath) {
        errorEl.textContent = 'AEM asset source is not configured for this project.';
        return;
      }

      mountAssetSelector(selectorMount, {
        imsToken: ctx.token,
        imsOrg: ctx.orgId,
        apiKey: ctx.assetSelectorApiKey,
        repositoryId,
        path: ctx.damFolderPath,
        onAssetPick: (selection) => copyDamPath(selection.path, ctx, toast),
      }).catch((err) => {
        errorEl.textContent = (err && err.message) || 'Could not load the AEM Asset Selector.';
      });
      return;
    }

    if (ctx.token && ctx.org && ctx.repo) {
      mountAssetBrowser(selectorMount, {
        token: ctx.token,
        org: ctx.org,
        repo: ctx.repo,
        rootPath: ASSETS_FOLDER,
        onAssetPick: (assetPath) => copyImage(assetPath, ctx, toast),
      }).catch((err) => {
        errorEl.textContent = (err && err.message) || 'Could not load the assets folder.';
      });
    }
  }
}

/*
 * assetSelector — mounts Adobe's official AEM Assets Selector widget (loaded
 * from Adobe's CDN, no npm equivalent) so authors can browse the whole
 * imported-assets DAM folder, not just this session's scraped images. Ported
 * from the UE extension's ImagesTab.js — same widget, same options.
 */

const ASSET_SELECTOR_SRC = 'https://experience.adobe.com/solutions/CQ-assets-selectors/static-assets/resources/assets-selectors.js';

let scriptPromise = null;

function loadAssetSelectorScript() {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.PureJSSelectors) return Promise.resolve(window.PureJSSelectors);
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${ASSET_SELECTOR_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(window.PureJSSelectors));
      existing.addEventListener('error', () => reject(new Error('Failed to load the AEM Asset Selector script.')));
      if (window.PureJSSelectors) resolve(window.PureJSSelectors);
      return;
    }
    const script = document.createElement('script');
    script.src = ASSET_SELECTOR_SRC;
    script.async = true;
    script.onload = () => resolve(window.PureJSSelectors);
    script.onerror = () => reject(new Error('Failed to load the AEM Asset Selector script.'));
    document.head.appendChild(script);
  }).catch((err) => {
    scriptPromise = null;
    throw err;
  });

  return scriptPromise;
}

function isDirectoryAsset(asset) {
  if (!asset) return true;
  if (asset['repo:assetClass'] === 'directory') return true;
  if (asset['dc:format'] === 'application/vnd.adobecloud.directory+json') return true;
  return false;
}

/** `https://author-p123-e456.adobeaemcloud.com` -> `author-p123-e456.adobeaemcloud.com`. */
export function repositoryIdFromAuthorUrl(authorUrl) {
  if (!authorUrl) return '';
  try { return new URL(authorUrl).host; } catch (_) { return authorUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, ''); }
}

export function normalizeSelectedAsset(asset) {
  return {
    id: asset?.['repo:assetId'] ?? asset?.['repo:id'] ?? asset?.id ?? null,
    name: asset?.['repo:name'] ?? asset?.name ?? null,
    path: asset?.['repo:path'] ?? asset?.path ?? null,
    repositoryId: asset?.['repo:repositoryId'] ?? asset?.repositoryId ?? null,
    mimeType: asset?.['dc:format'] ?? asset?.mimetype ?? asset?.format ?? null,
    url: asset?.url ?? asset?.['repo:url'] ?? null,
    thumbnailUrl: asset?.thumbnailUrl ?? asset?.['thumbnail-url'] ?? null,
    raw: asset,
  };
}

/**
 * @param {HTMLElement} mount
 * @param {object} opts
 * @param {string} opts.imsToken
 * @param {string} opts.imsOrg
 * @param {string} opts.repositoryId
 * @param {string} [opts.apiKey]
 * @param {string} opts.path            DAM folder to browse
 * @param {(selection: ReturnType<typeof normalizeSelectedAsset>) => void} opts.onAssetPick
 */
export async function mountAssetSelector(mount, {
  imsToken, imsOrg, repositoryId, apiKey, path, onAssetPick,
}) {
  const missing = [];
  if (!repositoryId) missing.push('aem.repositoryId (DA site config)');
  if (!imsToken) missing.push('IMS token');
  if (missing.length) {
    throw new Error(`AEM Assets is not configured for this DA site — missing: ${missing.join(', ')}.`);
  }

  const PJS = await loadAssetSelectorScript();
  if (!PJS || typeof PJS.renderAssetSelector !== 'function') {
    throw new Error('The AEM Assets picker could not be loaded. Check your network connection or contact your administrator.');
  }
  mount.innerHTML = '';
  const pick = (asset) => {
    if (isDirectoryAsset(asset)) return;
    const selection = normalizeSelectedAsset(asset);
    if (selection.path && typeof onAssetPick === 'function') onAssetPick(selection);
  };
  PJS.renderAssetSelector(mount, {
    imsToken,
    imsOrg,
    ...(apiKey ? { apiKey } : {}),
    repositoryId,
    path,
    rail: true,
    noWrap: true,
    aemTierType: 'author',
    colorScheme: 'light',
    hideTreeNav: true,
    hideFiltersButton: true,
    selectionType: 'single',
    featureSet: ['upload', 'collections', 'detail-panel'],
    acvConfig: { selectionType: 'single' },
    handleAssetSelection: (assets) => pick(assets && assets[0]),
    handleNavigateToAsset: (asset) => pick(asset),
  });

  requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  setTimeout(() => window.dispatchEvent(new Event('resize')), 300);
}

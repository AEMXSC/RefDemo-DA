/*
 * assetSelector — mounts Adobe's official AEM Assets Selector widget (loaded
 * from Adobe's CDN, no npm equivalent) so authors can browse the whole
 * imported-assets DAM folder, not just this session's scraped images. Ported
 * from the UE extension's ImagesTab.js — same widget, same options.
 */

const ASSET_SELECTOR_SRC =
  'https://experience.adobe.com/solutions/CQ-assets-selectors/static-assets/resources/assets-selectors.js';

function loadAssetSelectorScript() {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') { reject(new Error('no window')); return; }
    if (window.PureJSSelectors) { resolve(window.PureJSSelectors); return; }
    const existing = document.querySelector(`script[src="${ASSET_SELECTOR_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(window.PureJSSelectors));
      existing.addEventListener('error', reject);
      if (window.PureJSSelectors) resolve(window.PureJSSelectors);
      return;
    }
    const script = document.createElement('script');
    script.src = ASSET_SELECTOR_SRC;
    script.onload = () => resolve(window.PureJSSelectors);
    script.onerror = reject;
    document.head.appendChild(script);
  });
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

/**
 * @param {HTMLElement} mount
 * @param {object} opts
 * @param {string} opts.imsToken
 * @param {string} opts.imsOrg
 * @param {string} opts.repositoryId
 * @param {string} opts.path            DAM folder to browse
 * @param {(damPath: string, asset: object) => void} opts.onAssetPick
 */
export async function mountAssetSelector(mount, { imsToken, imsOrg, repositoryId, path, onAssetPick }) {
  const PJS = await loadAssetSelectorScript();
  if (!PJS || typeof PJS.renderAssetSelector !== 'function') {
    throw new Error('AEM Asset Selector script did not expose PureJSSelectors.');
  }
  mount.innerHTML = '';
  PJS.renderAssetSelector(mount, {
    imsToken,
    imsOrg,
    repositoryId,
    path,
    rail: true,
    noWrap: true,
    colorScheme: 'light',
    hideTreeNav: true,
    hideFiltersButton: true,
    featureSet: ['upload'],
    acvConfig: { selectionType: 'single' },
    handleAssetSelection: (assets) => {
      const asset = assets && assets[0];
      if (isDirectoryAsset(asset)) return;
      const damPath = asset['repo:path'] || asset.path;
      if (damPath && typeof onAssetPick === 'function') onAssetPick(damPath, asset);
    },
    handleNavigateToAsset: (asset) => {
      if (isDirectoryAsset(asset)) return;
      const damPath = asset['repo:path'] || asset.path;
      if (damPath && typeof onAssetPick === 'function') onAssetPick(damPath, asset);
    },
  });
}

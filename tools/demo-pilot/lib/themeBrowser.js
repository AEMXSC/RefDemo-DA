/*
 * themeBrowser — lists the DA site's /assets/themes folder via DA's List API
 * (lib/daAdmin.js listSource), letting the author navigate into each brand's
 * subfolder and preview/apply one of its saved brand-theme structured
 * content docs. Same breadcrumb + search + tile UI as lib/assetBrowser.js
 * (image import), reusing its folder/breadcrumb primitives, but a file tile
 * here previews the theme's colors as swatches (fetched via getSource,
 * since these are small JSON docs, not binaries) and has an "Apply" action
 * instead of Copy — picking one just records its path, via onApply.
 */

import { getSource, listSource } from './daAdmin.js';
import {
  isFolder, toBarePath, escapeHtml, FOLDER_ICON_LARGE, FOLDER_ICON_SMALL,
} from './assetBrowser.js';

// Matches the "Brand Theme" JSON schema's color properties.
const THEME_COLOR_FIELDS = [
  'brand-theme-color', 'brand-dark-color', 'brand-light-color',
  'brand-link-color', 'brand-link-hover-color', 'brand-text-color', 'brand-light-text-color',
];

function swatchesHtml(fields) {
  return THEME_COLOR_FIELDS
    .map((f) => fields[f])
    .filter(Boolean)
    .map((hex) => `<span class="dp-swatch" style="background:${escapeHtml(hex)}" title="${escapeHtml(hex)}"></span>`)
    .join('');
}

/**
 * @param {HTMLElement} mount
 * @param {object} opts
 * @param {string} opts.org
 * @param {string} opts.repo
 * @param {string} opts.token
 * @param {string} opts.rootPath  Folder to start browsing at (THEMES_ASSETS_FOLDER)
 * @param {(themePath: string, fields: object, item: object) => void} opts.onApply
 */
export async function mountThemeBrowser(mount, {
  org, repo, token, rootPath, onApply,
}) {
  mount.innerHTML = `
    <div class="dp-browser-sticky">
      <input type="text" id="dp-theme-browser-search" class="dp-text-input dp-browser-search" placeholder="Search this folder…" autocomplete="off" />
      <div class="dp-breadcrumb" id="dp-theme-browser-breadcrumb"></div>
    </div>
    <div class="dp-grid dp-tile-grid" id="dp-theme-browser-grid"></div>
  `;
  const searchInput = mount.querySelector('#dp-theme-browser-search');
  const breadcrumbEl = mount.querySelector('#dp-theme-browser-breadcrumb');
  const grid = mount.querySelector('#dp-theme-browser-grid');

  let currentItems = [];
  let renderFolder;

  function renderTiles(items) {
    grid.innerHTML = '';
    if (!items.length) {
      grid.innerHTML = '<p class="dp-status">Empty folder.</p>';
      return;
    }
    items.forEach((item) => {
      const card = document.createElement('div');
      card.className = 'dp-tile';
      if (isFolder(item)) {
        card.innerHTML = `
          <div class="dp-tile-thumb">${FOLDER_ICON_LARGE}</div>
          <div class="dp-tile-label">
            <span class="dp-tile-name">${escapeHtml(item.name)}</span>
            <span class="dp-tile-meta">${FOLDER_ICON_SMALL}FOLDER</span>
          </div>
        `;
        card.addEventListener('click', () => renderFolder(item.path));
      } else {
        card.innerHTML = `
          <div class="dp-tile-thumb">
            <div class="dp-swatches dp-theme-swatches"></div>
            <button type="button" class="dp-apply-theme-btn" title="Apply" aria-label="Apply">Apply</button>
          </div>
          <div class="dp-tile-label">
            <span class="dp-tile-name">${escapeHtml(item.name)}</span>
          </div>
        `;
        const swatchesEl = card.querySelector('.dp-theme-swatches');
        let fields = {};
        getSource({
          org, repo, path: item.path, token,
        })
          .then((json) => {
            fields = (json && typeof json === 'object') ? json : {};
            swatchesEl.innerHTML = swatchesHtml(fields) || '<span class="dp-status">No colors</span>';
          })
          .catch(() => { swatchesEl.innerHTML = '<span class="dp-error">Could not load</span>'; });
        card.querySelector('.dp-apply-theme-btn').addEventListener('click', (e) => {
          e.stopPropagation();
          onApply(item.path, fields, item);
        });
      }
      grid.appendChild(card);
    });
  }

  function renderBreadcrumb(path) {
    const rootSegs = rootPath.split('/').filter(Boolean);
    const pathSegs = path.split('/').filter(Boolean);
    const rootLabel = rootSegs[rootSegs.length - 1] || 'Assets';
    const rel = pathSegs.slice(rootSegs.length);

    const crumbs = [{ label: rootLabel, path: rootPath }];
    let acc = rootPath;
    rel.forEach((seg) => {
      acc = `${acc}/${seg}`;
      crumbs.push({ label: seg, path: acc });
    });

    breadcrumbEl.innerHTML = crumbs.map((c, idx) => {
      const isLast = idx === crumbs.length - 1;
      const sep = isLast ? '' : '<span class="dp-breadcrumb-sep">›</span>';
      return `<span class="dp-breadcrumb-seg${isLast ? ' is-current' : ''}" data-path="${escapeHtml(c.path)}">${escapeHtml(c.label)}</span>${sep}`;
    }).join('');

    breadcrumbEl.querySelectorAll('.dp-breadcrumb-seg:not(.is-current)').forEach((el) => {
      el.addEventListener('click', () => renderFolder(el.getAttribute('data-path')));
    });
  }

  renderFolder = async function loadFolder(path) {
    grid.innerHTML = '<p class="dp-status">Loading…</p>';
    let items;
    try {
      const listed = await listSource({
        org, repo, path, token,
      });
      items = listed.map((item) => ({ ...item, path: toBarePath(item.path, org, repo) }));
    } catch (err) {
      grid.innerHTML = `<p class="dp-error">${(err && err.message) || 'Could not list folder.'}</p>`;
      return;
    }

    currentItems = items;
    renderBreadcrumb(path);
    searchInput.value = '';
    renderTiles(items);
  };

  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim().toLowerCase();
    if (!q) { renderTiles(currentItems); return; }
    renderTiles(currentItems.filter((item) => item.name.toLowerCase().includes(q)));
  });

  await renderFolder(rootPath);
}

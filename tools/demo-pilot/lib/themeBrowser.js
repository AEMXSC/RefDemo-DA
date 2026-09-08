/*
 * themeBrowser — lists the DA site's /assets/themes folder via DA's List API
 * (lib/daAdmin.js listSource), letting the author navigate into each brand's
 * subfolder and preview/apply one of its saved brand-theme structured
 * content docs. Same breadcrumb + search + tile UI as lib/assetBrowser.js
 * (image import), reusing its folder/breadcrumb primitives, but a file tile
 * here previews the theme's colors as swatches — fetched via the DA
 * structured-content preview worker (DA_STRUCTURED_CONTENT_ORIGIN), which
 * resolves a structured-content doc to its rendered JSON values, unlike the
 * Source API's getSource which returns the raw (unresolved) doc — and has
 * an "Apply" action instead of Copy: picking one just records its path,
 * via onApply.
 */

import { listSource } from './daAdmin.js';
import {
  isFolder, toBarePath, escapeHtml, FOLDER_ICON_LARGE, FOLDER_ICON_SMALL,
} from './assetBrowser.js';
import { DA_STRUCTURED_CONTENT_ORIGIN } from '../config.js';

// Matches the "Brand Theme" JSON schema's color properties.
const THEME_COLOR_FIELDS = [
  'brand-theme-color', 'brand-dark-color', 'brand-light-color',
  'brand-link-color', 'brand-link-hover-color', 'brand-text-color', 'brand-light-text-color',
];

function themeBandsHtml(fields) {
  const hexes = THEME_COLOR_FIELDS.map((f) => fields[f]).filter(Boolean);
  if (!hexes.length) return '<p class="dp-status">No colors</p>';
  const bands = hexes.map((hex) => `<div class="dp-theme-band" style="background:${escapeHtml(hex)}"></div>`).join('');
  const labels = hexes.map((hex) => `<span class="dp-theme-hex">${escapeHtml(hex.replace(/^#/, '').toUpperCase())}</span>`).join('');
  return `<div class="dp-theme-bands">${bands}</div><div class="dp-theme-hex-row">${labels}</div>`;
}

/** Resolve a structured-content doc's rendered JSON values via the preview worker. */
async function fetchStructuredContent(org, repo, path) {
  const clean = path.startsWith('/') ? path : `/${path}`;
  const resp = await fetch(`${DA_STRUCTURED_CONTENT_ORIGIN}/preview/${org}/${repo}${clean}`);
  if (!resp.ok) throw new Error(`structured content fetch failed: HTTP ${resp.status}`);
  return resp.json();
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
  // Bumped on every renderTiles() call — lets an in-flight fetch from a
  // superseded render (e.g. the search box re-rendering while a previous
  // fetchStructuredContent() is still pending) detect it's stale and skip
  // writing into a tile that's since been replaced.
  let renderGeneration = 0;

  function renderTiles(items) {
    renderGeneration += 1;
    const myGeneration = renderGeneration;
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
          <div class="dp-tile-thumb dp-theme-tile-thumb">
            <div class="dp-theme-preview"><p class="dp-status">Loading…</p></div>
            <button type="button" class="dp-apply-theme-btn" title="Apply" aria-label="Apply">Apply</button>
          </div>
          <div class="dp-tile-label">
            <span class="dp-tile-name">${escapeHtml(item.name)}</span>
          </div>
        `;
        const previewEl = card.querySelector('.dp-theme-preview');
        let fields = {};
        fetchStructuredContent(org, repo, item.path)
          .then((json) => {
            if (myGeneration !== renderGeneration) return; // superseded — discard
            // Structured content comes back as { metadata, data: {...} } —
            // the color fields live under `data`.
            fields = (json && typeof json.data === 'object' && json.data) ? json.data : {};
            previewEl.innerHTML = themeBandsHtml(fields);
          })
          .catch(() => {
            if (myGeneration !== renderGeneration) return;
            previewEl.innerHTML = '<span class="dp-error">Could not load</span>';
          });
        const applyBtn = card.querySelector('.dp-apply-theme-btn');
        applyBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (applyBtn.disabled) return;
          const originalLabel = applyBtn.textContent;
          applyBtn.disabled = true;
          applyBtn.innerHTML = '<span class="dp-btn-spinner" aria-hidden="true"></span><span>Applying…</span>';
          try {
            await onApply(item.path, fields, item);
          } finally {
            applyBtn.disabled = false;
            applyBtn.textContent = originalLabel;
          }
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
      // Theme docs are DA documents, listed with a trailing .html — strip it
      // for files (folders never have it) so both the structured-content
      // preview URL and the value saved to placeholders are the extensionless
      // path DA's preview convention (and placeholders) expect.
      items = listed.map((item) => {
        const bare = toBarePath(item.path, org, repo);
        return { ...item, path: isFolder(item) ? bare : bare.replace(/\.html$/i, '') };
      });
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

/*
 * assetBrowser — lists the DA site's own /assets/images folder via DA's List
 * API (lib/daAdmin.js listSource), letting the author navigate into each
 * scraped site's subfolder and pick an image. Replaces the AEM Assets
 * Selector widget (lib/assetSelector.js) now that images live in DA instead
 * of AEM DAM — there is no AEM repositoryId/DAM path to browse anymore.
 *
 * Thumbnails and picks both go through an authenticated Source API GET
 * (getBinarySource) rather than a plain <img src>, because DA's Source API
 * requires the Authorization bearer header that an <img> tag can't send.
 *
 * UI mirrors AEM's own Assets "Files & Folders" browser: a breadcrumb trail
 * (rootPath down to the current folder, each segment clickable) instead of
 * a single "Up" button, tile cards with a big thumb + name/icon label
 * underneath, and a search box that filters the current folder's items by
 * name — all client-side, since a folder here is at most a few dozen items.
 */

import { listSource, getBinarySource } from './daAdmin.js';

function isFolder(item) {
  return !item.ext;
}

// The List API returns each item's `path` prefixed with /{org}/{repo} (see
// https://docs.da.live/developers/api/list), but every other call here
// (listSource/getBinarySource/onAssetPick -> Source API) takes a bare path
// and prepends org/repo itself. Strip it once, right after listing, so
// folder navigation and thumbnail/copy lookups don't double-prefix.
function toBarePath(path, org, repo) {
  const prefix = `/${org}/${repo}`;
  return path.startsWith(prefix) ? (path.slice(prefix.length) || '/') : path;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// Large gradient folder glyph for a folder tile's thumb area.
const FOLDER_ICON_LARGE = `
  <svg viewBox="0 0 64 52" class="dp-folder-icon" aria-hidden="true">
    <defs>
      <linearGradient id="dp-folder-grad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#7b5cd6" />
        <stop offset="45%" stop-color="#e0607e" />
        <stop offset="100%" stop-color="#4f9bf0" />
      </linearGradient>
    </defs>
    <path d="M2 6a2 2 0 0 1 2-2h14l6 6h34a2 2 0 0 1 2 2v36a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2Z" fill="url(#dp-folder-grad)" />
  </svg>
`;

// Small outline folder glyph for the "FOLDER" meta row.
const FOLDER_ICON_SMALL = `
  <svg viewBox="0 0 20 16" class="dp-tile-meta-icon" aria-hidden="true">
    <path d="M1 3a1 1 0 0 1 1-1h4.5l2 2H18a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" />
  </svg>
`;

const COPY_ICON = `
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3" />
    <path d="M3 10.5V3a1 1 0 0 1 1-1h7.5" fill="none" stroke="currentColor" stroke-width="1.3" />
  </svg>
`;

/**
 * @param {HTMLElement} mount
 * @param {object} opts
 * @param {string} opts.org
 * @param {string} opts.repo
 * @param {string} opts.token
 * @param {string} opts.rootPath   Folder to start browsing at (ASSETS_FOLDER)
 * @param {(assetPath: string, item: object) => void} opts.onAssetPick
 */
export async function mountAssetBrowser(mount, {
  org, repo, token, rootPath, onAssetPick,
}) {
  mount.innerHTML = `
    <div class="dp-browser-sticky">
      <input type="text" id="dp-browser-search" class="dp-text-input dp-browser-search" placeholder="Search this folder…" autocomplete="off" />
      <div class="dp-breadcrumb" id="dp-browser-breadcrumb"></div>
    </div>
    <div class="dp-grid dp-tile-grid" id="dp-browser-grid"></div>
  `;
  const searchInput = mount.querySelector('#dp-browser-search');
  const breadcrumbEl = mount.querySelector('#dp-browser-breadcrumb');
  const grid = mount.querySelector('#dp-browser-grid');

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
            <img alt="${escapeHtml(item.name)}" loading="lazy" />
            <button type="button" class="dp-copy-btn" title="Copy" aria-label="Copy">${COPY_ICON}</button>
          </div>
          <div class="dp-tile-label">
            <span class="dp-tile-name">${escapeHtml(item.name)}</span>
            <span class="dp-tile-meta dp-tile-dims"></span>
          </div>
        `;
        const imgEl = card.querySelector('img');
        const dimsEl = card.querySelector('.dp-tile-dims');
        getBinarySource({
          org, repo, path: item.path, token,
        })
          .then((blob) => {
            const objectUrl = URL.createObjectURL(blob);
            imgEl.src = objectUrl;
            const probe = new Image();
            probe.onload = () => { dimsEl.textContent = `${probe.naturalWidth} x ${probe.naturalHeight}`; };
            probe.src = objectUrl;
          })
          .catch(() => { /* thumbnail/dimensions best-effort only */ });
        const copyBtn = card.querySelector('.dp-copy-btn');
        copyBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          copyBtn.classList.remove('is-copied');
          // Force a reflow so re-triggering the animation on a rapid second
          // click restarts it instead of being a no-op (class already set).
          // eslint-disable-next-line no-void
          void copyBtn.offsetWidth;
          copyBtn.classList.add('is-copied');
          onAssetPick(item.path, item);
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

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
 */

import { listSource, getBinarySource } from './daAdmin.js';

function isFolder(item) {
  return !item.ext;
}

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
  async function renderFolder(path) {
    mount.innerHTML = '<p class="dp-status">Loading…</p>';
    let items;
    try {
      items = await listSource({
        org, repo, path, token,
      });
    } catch (err) {
      mount.innerHTML = `<p class="dp-error">${(err && err.message) || 'Could not list folder.'}</p>`;
      return;
    }

    const canGoUp = path !== rootPath;
    mount.innerHTML = `
      <div class="dp-row">
        ${canGoUp ? '<sl-button id="dp-browser-up">← Up</sl-button>' : ''}
        <span class="dp-status">${path}</span>
      </div>
      <div class="dp-grid" id="dp-browser-grid"></div>
    `;

    if (canGoUp) {
      mount.querySelector('#dp-browser-up').addEventListener('click', () => {
        const parent = path.split('/').slice(0, -1).join('/');
        renderFolder(parent.length >= rootPath.length ? parent : rootPath);
      });
    }

    const grid = mount.querySelector('#dp-browser-grid');
    if (!items.length) {
      grid.innerHTML = '<p class="dp-status">Empty folder.</p>';
      return;
    }

    items.forEach((item) => {
      const card = document.createElement('div');
      card.className = 'dp-card';
      if (isFolder(item)) {
        card.innerHTML = `<div class="dp-folder">📁 ${item.name}</div>`;
        card.addEventListener('click', () => renderFolder(item.path));
      } else {
        card.innerHTML = `
          <img alt="${item.name}" loading="lazy" />
          <sl-button class="dp-copy-btn">Copy</sl-button>
        `;
        const imgEl = card.querySelector('img');
        getBinarySource({
          org, repo, path: item.path, token,
        })
          .then((blob) => { imgEl.src = URL.createObjectURL(blob); })
          .catch(() => { /* thumbnail best-effort only */ });
        card.querySelector('.dp-copy-btn').addEventListener('click', () => onAssetPick(item.path, item));
      }
      grid.appendChild(card);
    });
  }

  await renderFolder(rootPath);
}

/*
 * textsTab — structured-content browser for DA fragments. Folders that hold
 * structured content are discovered from the org config; each item can be
 * inserted into the open document as a structured-teaser block or opened in
 * its editor. A search box + folder filter narrow the list client-side.
 */

import { copyHtmlToClipboard } from '../lib/clipboard.js';
import {
  fetchStructuredFolders,
  listStructuredContent,
  structuredTeaserBlockHtml,
  structuredTeaserPlainText,
} from '../lib/structuredContent.js';
import { track, EVENTS } from '../lib/analytics.js';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderCard(item) {
  const schema = item.schemaName ? ` (${escapeHtml(item.schemaName)})` : '';
  const edit = item.editorUrl
    ? `<a class="dp-fragment-edit" href="${escapeHtml(item.editorUrl)}" target="_blank" rel="noopener" title="Edit fragment" aria-label="Edit fragment">✎</a>`
    : '';
  return `
    <article class="dp-fragment-card">
      ${edit}
      <div class="dp-fragment-media">
        ${item.image ? `<img src="${escapeHtml(item.image)}" alt="">` : '<div class="dp-fragment-placeholder">SC</div>'}
      </div>
      <div class="dp-fragment-text">
        <h3>${escapeHtml(item.title || item.path)}</h3>
        ${item.description ? `<p>${escapeHtml(item.description)}</p>` : ''}
      </div>
      <div class="dp-fragment-actions">
        <span title="${escapeHtml(item.path)}${schema}">${escapeHtml(item.path)}${schema}</span>
        <sl-button class="dp-copy-fragment" data-path="${escapeHtml(item.path)}">Use Content</sl-button>
      </div>
    </article>
  `;
}

function filterItems(items, query, folder) {
  const q = String(query || '').trim().toLowerCase();
  return items.filter((item) => {
    if (folder && item.folder !== folder) return false;
    if (!q) return true;
    return [item.title, item.description, item.path, item.schemaName]
      .some((field) => String(field || '').toLowerCase().includes(q));
  });
}

export default function renderTextsTab(container, ctx) {
  const { state, rerender, toast } = ctx;
  const items = state.structuredContent || [];
  const folders = state.structuredFolders || [];
  const loading = state.structuredContentLoading;
  const error = state.structuredContentError;

  const folderOptions = folders
    .map((f) => `<option value="${escapeHtml(f.folder)}"${f.folder === state.structuredContentFolder ? ' selected' : ''}>${escapeHtml(f.folder)}</option>`)
    .join('');

  container.innerHTML = `
    <div class="dp-row">
      <div><strong>Structured Content</strong></div>
      <button id="dp-texts-refresh" class="dp-icon-btn" title="Refresh" aria-label="Refresh">↻</button>
    </div>
    <div class="dp-fragment-controls">
      <input id="dp-fragment-search" class="dp-fragment-search" type="search" placeholder="Search fragments…" value="${escapeHtml(state.structuredContentQuery || '')}">
      <select id="dp-fragment-folder" class="dp-fragment-folder">
        <option value=""${state.structuredContentFolder ? '' : ' selected'}>All folders</option>
        ${folderOptions}
      </select>
    </div>
    <label class="dp-fragment-variant">Style:
      <select id="dp-fragment-variant">
        ${[
    ['', 'Image left (default)'],
    ['right', 'Image right'],
    ['top', 'Image top'],
    ['hero', 'Hero'],
  ].map(([value, text]) => `<option value="${value}"${(state.structuredTeaserVariant || '') === value ? ' selected' : ''}>${text}</option>`).join('')}
      </select>
    </label>
    ${loading ? '<p class="dp-status">Loading fragments…</p>' : ''}
    ${error ? `<p class="dp-error">${escapeHtml(error)}</p>` : ''}
    <div class="dp-fragment-list" id="dp-fragment-list"></div>
    <p class="dp-status" id="dp-fragment-empty" hidden></p>
  `;

  const listEl = container.querySelector('#dp-fragment-list');
  const emptyEl = container.querySelector('#dp-fragment-empty');

  const applyFilter = () => {
    const filtered = filterItems(
      items,
      state.structuredContentQuery,
      state.structuredContentFolder,
    );
    listEl.innerHTML = filtered.map(renderCard).join('');
    if (!loading && !error && filtered.length === 0) {
      emptyEl.hidden = false;
      emptyEl.textContent = items.length === 0
        ? 'No structured content found.'
        : 'No fragments match your search.';
    } else {
      emptyEl.hidden = true;
    }
  };
  applyFilter();

  container.querySelector('#dp-fragment-search').addEventListener('input', (e) => {
    state.structuredContentQuery = e.target.value;
    applyFilter();
  });
  container.querySelector('#dp-fragment-folder').addEventListener('change', (e) => {
    state.structuredContentFolder = e.target.value;
    applyFilter();
  });
  container.querySelector('#dp-fragment-variant').addEventListener('change', (e) => {
    state.structuredTeaserVariant = e.target.value;
  });

  listEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('.dp-copy-fragment');
    if (!btn) return;
    const item = items.find((fragment) => fragment.path === btn.getAttribute('data-path'));
    if (!item) return;
    try {
      const variant = state.structuredTeaserVariant || '';
      const html = structuredTeaserBlockHtml(item, variant);
      if (ctx.actions?.sendHTML) {
        await ctx.actions.sendHTML(html);
        track(EVENTS.TEXT_COPIED);
        toast('Structured teaser block inserted into your document.');
      } else {
        await copyHtmlToClipboard(html, structuredTeaserPlainText(item, variant));
        track(EVENTS.TEXT_COPIED);
        toast('Structured teaser block copied — paste it into your document.');
      }
    } catch (err) {
      toast((err && err.message) || 'Insert failed', true);
    }
  });

  const load = async () => {
    state.structuredContentLoading = true;
    state.structuredContentError = '';
    rerender();
    try {
      const discovered = await fetchStructuredFolders({
        org: ctx.org,
        repo: ctx.repo,
        token: ctx.token,
      });
      state.structuredFolders = discovered;
      state.structuredContent = await listStructuredContent({
        org: ctx.org, repo: ctx.repo, token: ctx.token, folders: discovered,
      });
    } catch (err) {
      state.structuredContentError = (err && err.message) || 'Could not load structured content.';
    } finally {
      state.structuredContentLoading = false;
      rerender();
    }
  };

  container.querySelector('#dp-texts-refresh').addEventListener('click', load);
  if (!state.structuredContentLoaded && !loading) {
    state.structuredContentLoaded = true;
    load();
  }
}

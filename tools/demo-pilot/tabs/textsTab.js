/*
 * textsTab — scrape + persist + copy-to-clipboard for texts.
 * Replaces the UE extension's TextsTab.js + replaceText.js: no UE-selection
 * "replace" call, picking a text chip just copies it to the clipboard.
 */

import { groupTextsByComponent, mergeTextsByComponent } from '../lib/scrape.js';
import { writeTexts } from '../lib/textStorage.js';
import { copyTextToClipboard } from '../lib/clipboard.js';
import { openScrapeModal } from '../lib/scrapeModal.js';
import { track, EVENTS } from '../lib/analytics.js';

export function renderTextsTab(container, ctx) {
  const { state, rerender, toast } = ctx;
  const groups = state.texts || {};
  const componentNames = Object.keys(groups);

  container.innerHTML = `
    <div class="dp-row">
      <strong>Texts</strong>
      <sl-button id="dp-texts-import">Import from URL</sl-button>
    </div>
    <div id="dp-texts-groups"></div>
    ${componentNames.length === 0 ? '<p class="dp-status">No saved texts yet. Import from a live URL to get started.</p>' : ''}
  `;

  const groupsEl = container.querySelector('#dp-texts-groups');
  for (const component of componentNames) {
    const wrap = document.createElement('div');
    wrap.className = 'dp-chip-group';
    wrap.innerHTML = `<h4>${component}</h4>`;
    for (const text of groups[component]) {
      const chip = document.createElement('div');
      chip.className = 'dp-chip';
      chip.innerHTML = `<span title="${text.replace(/"/g, '&quot;')}">${text}</span><sl-button class="dp-copy-btn" data-text="${encodeURIComponent(text)}">Copy</sl-button>`;
      wrap.appendChild(chip);
    }
    groupsEl.appendChild(wrap);
  }

  groupsEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('.dp-copy-btn');
    if (!btn) return;
    const text = decodeURIComponent(btn.getAttribute('data-text') || '');
    try {
      await copyTextToClipboard(text);
      track(EVENTS.TEXT_COPIED);
      toast('Text copied — paste it into your document.');
    } catch (err) {
      toast((err && err.message) || 'Copy failed', true);
    }
  });

  container.querySelector('#dp-texts-import').addEventListener('click', () => {
    openScrapeModal({
      token: ctx.token,
      mode: 'texts',
      onComplete: async ({ texts: scrapedTexts }) => {
        track(EVENTS.IMPORT_STARTED);
        const incoming = groupTextsByComponent(scrapedTexts || []);
        state.texts = mergeTextsByComponent(state.texts || {}, incoming);
        rerender();
        try {
          await writeTexts({ org: ctx.org, repo: ctx.repo, token: ctx.token, texts: state.texts });
          track(EVENTS.IMPORT_COMPLETED);
        } catch (err) {
          // Texts are still shown locally (state already updated above) even
          // when persistence fails — best-effort, matches imagesTab's fallback.
          toast(`Saved locally only \u2014 persist failed: ${(err && err.message) || 'unknown error'}`, true);
        }
        rerender();
      },
    });
  });
}

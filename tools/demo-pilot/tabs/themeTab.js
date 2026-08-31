/*
 * themeTab — brand-theme scrape, save, and site-wide apply.
 * Replaces the UE extension's ThemesTab.js + brandThemeCF.js +
 * applyBrandTheme(ToPages).js: themes are DA sheets (lib/theme.js), and
 * "apply to site" writes+publishes one shared /theme.json instead of
 * fanning writes out across every page.
 */

import { saveTheme, listThemes, applyThemeToSite } from '../lib/theme.js';
import { openScrapeModal } from '../lib/scrapeModal.js';
import { track, EVENTS } from '../lib/analytics.js';

const COLOR_FIELDS = [
  'backgroundColor', 'themeColor', 'darkColor', 'linkColor', 'linkHoverColor',
  'textColor', 'lightTextColor', 'headerBackgroundColor', 'headerTextColor',
  'footerBackgroundColor', 'footerTextColor',
];

function swatches(fields) {
  return COLOR_FIELDS
    .map((f) => fields[f])
    .filter(Boolean)
    .map((hex) => `<span class="dp-swatch" style="background:${hex}" title="${hex}"></span>`)
    .join('');
}

export async function renderThemeTab(container, ctx) {
  const { state, rerender, toast } = ctx;

  container.innerHTML = `
    <div class="dp-row">
      <strong>Theme</strong>
      <sl-button id="dp-theme-import">Import from URL</sl-button>
    </div>
    <p class="dp-status" id="dp-theme-status">${state.themeStatus || ''}</p>
    <div id="dp-theme-list"></div>
  `;

  const listEl = container.querySelector('#dp-theme-list');

  if (!state.themesLoaded) {
    listEl.innerHTML = '<p class="dp-status">Loading saved themes…</p>';
    try {
      state.themes = await listThemes({ org: ctx.org, repo: ctx.repo, token: ctx.token });
    } catch (err) {
      toast((err && err.message) || 'Failed to list themes', true);
      state.themes = [];
    }
    state.themesLoaded = true;
    rerender();
    return;
  }

  const themes = state.themes || [];
  if (themes.length === 0) {
    listEl.innerHTML = '<p class="dp-status">No saved themes yet. Import from a live URL to create one.</p>';
  } else {
    listEl.innerHTML = '';
    for (const theme of themes) {
      const card = document.createElement('div');
      card.className = 'dp-theme-card';
      card.innerHTML = `
        <strong>${theme.name}</strong>
        <div class="dp-swatches">${swatches(theme.fields)}</div>
        <sl-button class="dp-apply-btn" data-path="${theme.path}">Apply to site</sl-button>
      `;
      listEl.appendChild(card);
    }
  }

  listEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('.dp-apply-btn');
    if (!btn) return;
    const path = btn.getAttribute('data-path');
    const theme = themes.find((t) => t.path === path);
    if (!theme) return;
    btn.setAttribute('disabled', 'true');
    state.themeStatus = 'Applying to site…';
    rerender();
    try {
      await applyThemeToSite({ org: ctx.org, repo: ctx.repo, token: ctx.token, ref: ctx.ref, fields: theme.fields });
      track(EVENTS.THEME_APPLIED);
      state.themeStatus = 'Applied — theme.json published.';
    } catch (err) {
      state.themeStatus = '';
      toast((err && err.message) || 'Apply failed', true);
    }
    rerender();
  });

  container.querySelector('#dp-theme-import').addEventListener('click', () => {
    openScrapeModal({
      token: ctx.token,
      mode: 'theme',
      onComplete: async ({ colors, brandColors, siteUrl }) => {
        track(EVENTS.IMPORT_STARTED);
        state.themeStatus = 'Saving theme…';
        rerender();
        try {
          await saveTheme({ org: ctx.org, repo: ctx.repo, token: ctx.token, siteUrl, colors, brandColors });
          state.themesLoaded = false;
          track(EVENTS.IMPORT_COMPLETED);
        } catch (err) {
          toast((err && err.message) || 'Save theme failed', true);
        }
        state.themeStatus = '';
        rerender();
      },
    });
  });
}

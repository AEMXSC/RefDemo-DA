/*
 * themeTab — brand-theme scrape, save, and site-wide apply, plus a browser
 * for the newer schema-driven brand-theme structured content under
 * /assets/themes (lib/themeBrowser.js). The scrape/save/apply-to-site flow
 * above (lib/theme.js) is the UE-extension-derived CF flow, kept as-is;
 * the browser below is a separate, additive mechanism — picking a theme
 * there only records its path in the placeholders sheet ("theme" key), it
 * doesn't touch /theme.json or the saved-themes list above.
 *
 * Builds its DOM shell once per container (see `dpBuilt` guard), same
 * reasoning as tabs/imagesTab.js — the theme browser mount is a stateful
 * widget (search/breadcrumb) that must not be torn down on every rerender.
 */

import { saveTheme, listThemes, applyThemeToSite } from '../lib/theme.js';
import { setPlaceholder } from '../lib/placeholders.js';
import { mountThemeBrowser } from '../lib/themeBrowser.js';
import { openScrapeModal } from '../lib/scrapeModal.js';
import { track, EVENTS } from '../lib/analytics.js';
import { THEMES_ASSETS_FOLDER } from '../config.js';

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

  if (!container.dataset.dpBuilt) {
    container.dataset.dpBuilt = '1';
    container.innerHTML = `
      <div class="dp-images-tab">
        <div class="dp-row">
          <strong>Theme</strong>
        </div>
        <p class="dp-status" id="dp-theme-status"></p>
        <div id="dp-theme-list"></div>
        <div class="dp-row"><p>Browse brand themes</p></div>
        <p class="dp-error" id="dp-theme-browser-error"></p>
        <div id="dp-theme-browser-mount" class="dp-browser-mount"></div>
        <div class="dp-import-footer">
          <button type="button" id="dp-theme-import" class="dp-import-fab" title="Import from URL" aria-label="Import from URL">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M2.5 3.5A1.5 1.5 0 0 1 4 2h4l2.5 2.5V12.5A1.5 1.5 0 0 1 9 14H4a1.5 1.5 0 0 1-1.5-1.5Z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" />
              <path d="M8 2v2.5h2.5" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" />
              <path d="M2.7 8h5.1M5.5 5.8 8 8l-2.5 2.2" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
        </div>
      </div>
    `;

    container.querySelector('#dp-theme-list').addEventListener('click', async (e) => {
      const btn = e.target.closest('.dp-apply-btn');
      if (!btn) return;
      const path = btn.getAttribute('data-path');
      const theme = (state.themes || []).find((t) => t.path === path);
      if (!theme) return;
      btn.setAttribute('disabled', 'true');
      state.themeStatus = 'Applying to site…';
      rerender();
      try {
        await applyThemeToSite({
          org: ctx.org, repo: ctx.repo, token: ctx.token, ref: ctx.ref, fields: theme.fields,
        });
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
            await saveTheme({
              org: ctx.org, repo: ctx.repo, token: ctx.token, siteUrl, colors, brandColors,
            });
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

  container.querySelector('#dp-theme-status').textContent = state.themeStatus || '';

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
    //listEl.innerHTML = '<p class="dp-status">No saved themes yet. Import from a live URL to create one.</p>';
  } else {
    listEl.innerHTML = '';
    themes.forEach((theme) => {
      const card = document.createElement('div');
      card.className = 'dp-theme-card';
      card.innerHTML = `
        <strong>${theme.name}</strong>
        <div class="dp-swatches">${swatches(theme.fields)}</div>
        <sl-button class="dp-apply-btn" data-path="${theme.path}">Apply to site</sl-button>
      `;
      listEl.appendChild(card);
    });
  }

  // Mount the brand-theme folder browser once.
  const browserMount = container.querySelector('#dp-theme-browser-mount');
  const mountKey = `${ctx.token}|${ctx.org}|${ctx.repo}`;
  if (browserMount.dataset.mountKey !== mountKey && ctx.token && ctx.org && ctx.repo) {
    browserMount.dataset.mountKey = mountKey;
    mountThemeBrowser(browserMount, {
      token: ctx.token,
      org: ctx.org,
      repo: ctx.repo,
      rootPath: THEMES_ASSETS_FOLDER,
      onApply: async (themePath) => {
        try {
          await setPlaceholder({
            org: ctx.org, repo: ctx.repo, token: ctx.token, key: 'theme', value: themePath,
          });
          toast('Theme applied successfully on the site');
        } catch (err) {
          toast('Failed to apply Theme on the site.', true);
        }
      },
    }).catch((err) => {
      container.querySelector('#dp-theme-browser-error').textContent = (err && err.message) || 'Could not load brand themes.';
    });
  }
}

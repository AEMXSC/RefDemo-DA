/*
 * demo-pilot — DA library plugin shell. Boots via the DA App SDK, resolves
 * IMS user email + analytics context, then renders the Images / Texts / Theme
 * tabs. Ported from the UE extension's DemoPilotRail.js — the biggest
 * differences: no `@adobe/uix-guest` polling loop (DA gives context once),
 * and no `editorActions` replace call (see lib/clipboard.js for why).
 */

import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { fetchUserEmail } from './lib/userProfile.js';
import { setAnalyticsContext } from './lib/analytics.js';
import { readTexts } from './lib/textStorage.js';
import { fetchAemConfig } from './lib/aemConfig.js';
import { AEM_ORG_ID } from './config.js';
import { renderImagesTab } from './tabs/imagesTab.js';
import { renderTextsTab } from './tabs/textsTab.js';
import { renderThemeTab } from './tabs/themeTab.js';

const TABS = [
  { id: 'images', label: 'Images', render: renderImagesTab },
  { id: 'texts', label: 'Texts', render: renderTextsTab },
  { id: 'theme', label: 'Theme', render: renderThemeTab },
];

const root = document.getElementById('demo-pilot-root');

const state = {
  activeTab: 'images',
  texts: {},
  themes: [],
  themesLoaded: false,
  uploadStatus: '',
  themeStatus: '',
};

function showToast(message, isError = false) {
  const el = document.createElement('div');
  el.className = isError ? 'dp-error' : 'dp-status';
  el.style.position = 'fixed';
  el.style.bottom = '12px';
  el.style.left = '12px';
  el.style.right = '12px';
  el.style.background = isError ? '#fdecea' : '#eaf6ea';
  el.style.padding = '8px';
  el.style.borderRadius = '4px';
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function render(ctx) {
  root.innerHTML = `
    <div class="dp-tabs">
      ${TABS.map((t) => `<button class="dp-tab ${t.id === state.activeTab ? 'is-active' : ''}" data-tab="${t.id}">${t.label}</button>`).join('')}
    </div>
    <div class="dp-panel" id="dp-panel"></div>
  `;
  root.querySelector('.dp-tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.dp-tab');
    if (!btn) return;
    state.activeTab = btn.getAttribute('data-tab');
    render(ctx);
  });
  const panel = root.querySelector('#dp-panel');
  const active = TABS.find((t) => t.id === state.activeTab);
  active.render(panel, ctx);
}

(async function init() {
  const { context, token } = await DA_SDK;
  const { org, repo, path, ref } = context;

  // aem.repositoryId / imsorg live in the DA site's own config (the same
  // aem.repositoryId key DA's native AEM Assets picker relies on) — read them
  // instead of hardcoding per deployment. AEM_ORG_ID is a manual fallback for
  // sites that haven't added an `imsorg` config row yet.
  const aemConfig = await fetchAemConfig({ org, repo, token }).catch(() => ({ authorUrl: '', imsOrgId: '' }));
  const authorUrl = aemConfig.authorUrl;
  const orgId = aemConfig.imsOrgId || AEM_ORG_ID;

  setAnalyticsContext({ orgId: org, siteName: repo, aemHost: authorUrl });
  fetchUserEmail(token).then((email) => {
    if (email) setAnalyticsContext({ userId: email });
  }).catch(() => { /* analytics must not surface errors */ });

  state.texts = await readTexts({ org, repo, token }).catch(() => ({}));

  const ctx = {
    state,
    rerender: () => render(ctx),
    toast: showToast,
    token,
    org,
    repo,
    ref: ref || 'main',
    path,
    // Reachable only via the kept upload-to-dam action.
    authorUrl,
    orgId,
    damFolderPath: '/content/dam/imported-assets/en',
  };

  render(ctx);
}());

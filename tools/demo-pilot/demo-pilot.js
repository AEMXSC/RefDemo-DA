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
import { AEM_ORG_ID, AEM_ASSET_SELECTOR_API_KEY } from './config.js';
import renderImagesTab from './tabs/imagesTab.js';
import renderTextsTab from './tabs/textsTab.js';
import { renderThemeTab } from './tabs/themeTab.js';

const TABS = [
  { id: 'images', label: 'Images', render: renderImagesTab },
  { id: 'texts', label: 'Fragments', render: renderTextsTab },
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
  selectorRefresh: 0,
  structuredContent: [],
  structuredFolders: [],
  structuredContentQuery: '',
  structuredContentFolder: '',
  structuredTeaserVariant: '',
  structuredContentLoaded: false,
  structuredContentLoading: false,
  structuredContentError: '',
  imageAssetSource: 'da',
};

let tabBarBuilt = false;
let panelEl = null;

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
  if (!tabBarBuilt) {
    tabBarBuilt = true;
    root.innerHTML = `
      <div class="dp-tabs">
        ${TABS.map((t) => `<button class="dp-tab" data-tab="${t.id}">${t.label}</button>`).join('')}
      </div>
      <div class="dp-panel" id="dp-panel"></div>
    `;
    panelEl = root.querySelector('#dp-panel');
    root.querySelector('.dp-tabs').addEventListener('click', (e) => {
      const btn = e.target.closest('.dp-tab');
      if (!btn) return;
      const nextTab = btn.getAttribute('data-tab');
      if (nextTab === state.activeTab) return;
      state.activeTab = nextTab;
      render(ctx);
    });
  }

  root.querySelectorAll('.dp-tab').forEach((btn) => {
    btn.classList.toggle('is-active', btn.getAttribute('data-tab') === state.activeTab);
  });

  if (panelEl.dataset.lastTab !== state.activeTab) {
    panelEl.dataset.lastTab = state.activeTab;
    delete panelEl.dataset.dpBuilt;
    panelEl.innerHTML = '';
  }

  const panel = panelEl;
  const active = TABS.find((t) => t.id === state.activeTab);
  active.render(panel, ctx);
}

(async function init() {
  const { context, token, actions } = await DA_SDK;
  const {
    org,
    repo,
    path,
    ref,
  } = context;

  // aem.repositoryId / imsorg live in the DA site's own config (the same
  // aem.repositoryId key DA's native AEM Assets picker relies on) — read them
  // instead of hardcoding per deployment. AEM_ORG_ID is a manual fallback for
  // sites that haven't added an `imsorg` config row yet.
  const {
    authorUrl,
    imsOrgId,
    assetSelectorApiKey: configuredAssetSelectorApiKey,
  } = await fetchAemConfig({
    org,
    repo,
    token,
  }).catch(() => ({
    authorUrl: '',
    imsOrgId: '',
    assetSelectorApiKey: '',
  }));
  const orgId = imsOrgId || AEM_ORG_ID;
  const assetSelectorApiKey = configuredAssetSelectorApiKey || AEM_ASSET_SELECTOR_API_KEY;

  setAnalyticsContext({ orgId: org, siteName: repo, aemHost: authorUrl });
  fetchUserEmail(token).then((email) => {
    if (email) setAnalyticsContext({ userId: email });
  }).catch(() => { /* analytics must not surface errors */ });

  state.texts = await readTexts({ org, repo, token }).catch(() => ({}));

  const ctx = {
    state,
    rerender: () => render(ctx),
    toast: showToast,
    actions,
    token,
    org,
    repo,
    ref: ref || 'main',
    path,
    // Reachable only via the kept upload-to-dam action.
    authorUrl,
    orgId,
    assetSelectorApiKey,
    damFolderPath: '/content/dam/imported-assets/en',
  };

  render(ctx);
}());

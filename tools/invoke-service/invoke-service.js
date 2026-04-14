// eslint-disable-next-line import/no-unresolved
import DA_SDK from 'https://da.live/nx/utils/sdk.js';

const DEFAULT_SERVICE_URL = 'https://hook.app.workfrontfusion.com/xot9mamgl12su5dteagfw64f6lklf7ge';

/* ── Placeholders config ─────────────────────────────────────────────── */

function buildPlaceholdersUrl(org, repo) {
  return `https://main--${repo}--${org}.aem.live/config/placeholder.json`;
}

async function fetchPlaceholders(org, repo) {
  const url = buildPlaceholdersUrl(org, repo);
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Placeholders fetch failed: ${resp.status}`);
  const json = await resp.json();

  const lookup = {};
  (json.data || []).forEach((row) => {
    if (row.key) lookup[row.key.toLowerCase()] = row.value || '';
  });

  let rawPayload = lookup['external-service-payload'] || '';
  if (rawPayload.startsWith("'") && rawPayload.endsWith("'")) {
    rawPayload = rawPayload.slice(1, -1);
  }

  return {
    externalServiceUrl: lookup['external-service-url'] || '',
    externalServicePayload: rawPayload,
  };
}

/* ── User profile ────────────────────────────────────────────────────── */

async function fetchUserProfile(token) {
  try {
    const resp = await fetch('https://ims-na1.adobelogin.com/ims/profile/v1', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return { userName: '', userEmail: '' };
    const profile = await resp.json();
    return {
      userName: profile.displayName || profile.name || '',
      userEmail: profile.email || '',
    };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[invoke-service] Failed to fetch user profile:', e);
    return { userName: '', userEmail: '' };
  }
}

/* ── External service call ───────────────────────────────────────────── */

function resolveOrgRepo(context) {
  // DA SDK context may provide org/repo directly or via a URL / hash path
  if (context.org && context.repo) {
    return { org: context.org, repo: context.repo, path: context.path || '/' };
  }

  // Attempt to extract from a URL-like value (e.g. "da.live/edit#/{org}/{repo}/…")
  const url = context.url || context.location || context.href || '';
  const hashPath = url.includes('#') ? url.split('#')[1] : '';
  const segments = (hashPath || '').split('/').filter(Boolean);
  if (segments.length >= 2) {
    return { org: segments[0], repo: segments[1], path: `/${segments.slice(2).join('/')}` };
  }

  // Fallback: iterate context values looking for a slash-separated path
  const values = Object.values(context).filter((v) => typeof v === 'string');
  const slashVal = values.find((v) => v.split('/').filter(Boolean).length >= 2);
  if (slashVal) {
    const parts = slashVal.split('/').filter(Boolean);
    return { org: parts[0], repo: parts[1], path: `/${parts.slice(2).join('/')}` };
  }

  throw new Error(`Could not resolve org/repo from context: ${JSON.stringify(context)}`);
}

async function invokeExternalService(token, context) {
  // eslint-disable-next-line no-console
  console.log('[invoke-service] DA SDK context →', JSON.stringify(context, null, 2));

  const { org, repo, path } = resolveOrgRepo(context);
  // eslint-disable-next-line no-console
  console.log('[invoke-service] Resolved →', { org, repo, path });

  const [profile, config] = await Promise.all([
    fetchUserProfile(token),
    fetchPlaceholders(org, repo).catch((err) => {
      // eslint-disable-next-line no-console
      console.warn('[invoke-service] Placeholders fetch failed, using defaults:', err);
      return { externalServiceUrl: '', externalServicePayload: '' };
    }),
  ]);

  const resolvedUrl = config.externalServiceUrl || DEFAULT_SERVICE_URL;

  let resolvedPayload;
  if (config.externalServicePayload) {
    try {
      resolvedPayload = JSON.parse(config.externalServicePayload);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[invoke-service] Failed to parse custom payload, using default:', e);
    }
  }

  if (!resolvedPayload) {
    resolvedPayload = {
      org,
      repo,
      path,
      'user-name': profile.userName,
      'user-email': profile.userEmail,
    };
  }

  // eslint-disable-next-line no-console
  console.log('[invoke-service] Calling service →', resolvedUrl);

  const resp = await fetch(resolvedUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(resolvedPayload),
  });

  if (!resp.ok) {
    const errorBody = await resp.text();
    throw new Error(`External service error: ${resp.status} – ${errorBody}`);
  }

  return resp.json();
}

/* ── UI rendering with Spectrum Web Components ───────────────────────── */

function renderConfirm(root, { onConfirm, onCancel }) {
  root.innerHTML = `
    <div class="invoke-service-panel">
      <p class="invoke-service-message">Invoke the external service for this document?</p>
      <div class="invoke-service-actions">
        <sp-button variant="secondary" id="invoke-cancel">Cancel</sp-button>
        <sp-button variant="accent" id="invoke-confirm">Confirm</sp-button>
      </div>
    </div>`;
  root.querySelector('#invoke-cancel').addEventListener('click', onCancel);
  root.querySelector('#invoke-confirm').addEventListener('click', onConfirm);
}

function renderLoading(root) {
  root.innerHTML = `
    <div class="invoke-service-panel">
      <div class="invoke-service-loading">
        <sp-progress-circle indeterminate size="s" label="Executing…"></sp-progress-circle>
        <p class="invoke-service-message">Executing external service…</p>
      </div>
    </div>`;
}

function renderResult(root, { isSuccess, message, onClose }) {
  const icon = isSuccess
    ? '<sp-icon-checkmark-circle class="invoke-service-icon success"></sp-icon-checkmark-circle>'
    : '<sp-icon-close-circle class="invoke-service-icon failure"></sp-icon-close-circle>';
  const label = isSuccess ? 'Success' : 'Failed';

  root.innerHTML = `
    <div class="invoke-service-panel">
      <div class="invoke-service-result">
        ${icon}
        <p class="invoke-service-label">${label}</p>
        <p class="invoke-service-detail">${message}</p>
      </div>
      <div class="invoke-service-actions">
        <sp-button variant="accent" id="invoke-close">Close</sp-button>
      </div>
    </div>`;
  root.querySelector('#invoke-close').addEventListener('click', onClose);
}

/* ── Init ─────────────────────────────────────────────────────────────── */

(async function init() {
  const { context, token, actions } = await DA_SDK;
  const root = document.getElementById('invoke-service-root');

  const handlers = {
    onCancel: () => actions.closeLibrary(),
    onClose: () => actions.closeLibrary(),
    onConfirm: async () => {
      renderLoading(root);
      let isSuccess = false;
      let message = '';
      try {
        await invokeExternalService(token, context);
        isSuccess = true;
        message = 'The external service executed successfully.';
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[invoke-service] Error:', err);
        isSuccess = false;
        message = err.message || 'An unexpected error occurred.';
      }
      renderResult(root, { isSuccess, message, onClose: handlers.onClose });
    },
  };

  renderConfirm(root, handlers);
}());

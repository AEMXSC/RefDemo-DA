// eslint-disable-next-line import/no-unresolved
import DA_SDK from 'https://da.live/nx/utils/sdk.js';

const DEFAULT_SERVICE_URL = 'https://hook.app.workfrontfusion.com/xot9mamgl12su5dteagfw64f6lklf7ge';

const PHASE = { CONFIRM: 'confirm', LOADING: 'loading', RESULT: 'result' };

function buildPlaceholdersUrl(org, repo) {
  return `https://admin.da.live/source/${org}/${repo}/placeholders.json`;
}

async function fetchPlaceholders(org, repo, token) {
  const url = buildPlaceholdersUrl(org, repo);
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) throw new Error(`Placeholders fetch failed: ${resp.status}`);
  const json = await resp.json();

  const lookup = {};
  const rows = json.data || json[':names']?.flatMap((name) => json[name]?.data) || [];
  rows.forEach((row) => {
    if (row.Key || row.key) lookup[(row.Key || row.key).toLowerCase()] = row.Text || row.text || '';
  });

  return {
    externalServiceUrl: lookup['external-service-url'] || '',
    externalServicePayload: lookup['external-service-payload'] || '',
  };
}

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

async function invokeExternalService(token, context) {
  const { org, repo, path } = context;

  const [profile, config] = await Promise.all([
    fetchUserProfile(token),
    fetchPlaceholders(org, repo, token).catch((err) => {
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

function renderPhase(container, phase, { onConfirm, onCancel, onClose, isSuccess, message }) {
  container.innerHTML = '';

  if (phase === PHASE.CONFIRM) {
    container.innerHTML = `
      <div class="invoke-service-panel">
        <p class="invoke-service-message">Invoke the external service for this document?</p>
        <div class="invoke-service-actions">
          <button class="invoke-service-btn secondary" id="invoke-cancel">Cancel</button>
          <button class="invoke-service-btn primary" id="invoke-confirm">Confirm</button>
        </div>
      </div>`;
    container.querySelector('#invoke-cancel').addEventListener('click', onCancel);
    container.querySelector('#invoke-confirm').addEventListener('click', onConfirm);
  }

  if (phase === PHASE.LOADING) {
    container.innerHTML = `
      <div class="invoke-service-panel">
        <div class="invoke-service-loading">
          <div class="invoke-service-spinner"></div>
          <p class="invoke-service-message">Executing external service…</p>
        </div>
      </div>`;
  }

  if (phase === PHASE.RESULT) {
    const icon = isSuccess
      ? '<span class="invoke-service-icon success">&#10003;</span>'
      : '<span class="invoke-service-icon failure">&#10007;</span>';
    const label = isSuccess ? 'Success' : 'Failed';

    container.innerHTML = `
      <div class="invoke-service-panel">
        <div class="invoke-service-result">
          ${icon}
          <p class="invoke-service-label">${label}</p>
          <p class="invoke-service-detail">${message}</p>
        </div>
        <div class="invoke-service-actions">
          <button class="invoke-service-btn primary" id="invoke-close">Close</button>
        </div>
      </div>`;
    container.querySelector('#invoke-close').addEventListener('click', onClose);
  }
}

(async function init() {
  const { context, token, actions } = await DA_SDK;

  const container = document.createElement('div');
  container.className = 'invoke-service-container';
  document.body.appendChild(container);

  const handlers = {
    onCancel: () => actions.closeLibrary(),
    onClose: () => actions.closeLibrary(),
    onConfirm: async () => {
      renderPhase(container, PHASE.LOADING, handlers);
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
      renderPhase(container, PHASE.RESULT, { ...handlers, isSuccess, message });
    },
    isSuccess: false,
    message: '',
  };

  renderPhase(container, PHASE.CONFIRM, handlers);
}());

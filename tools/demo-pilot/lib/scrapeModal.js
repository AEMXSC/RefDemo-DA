/*
 * scrapeModal — shared "Import from URL" dialog used by the Images, Texts,
 * and Theme tabs. Ported/simplified from the UE extension's
 * ImportAssetsModal.js — same LiveDemos SSE flow, plain DOM instead of React.
 */

import { runScrape } from './scrape.js';

// Accept "adobe.com", "www.adobe.com", "http://adobe.com" or
// "https://adobe.com" alike — prepend https:// when no scheme was typed, then
// validate via the URL constructor so a genuinely malformed value (e.g.
// "not a url") is caught before it ever reaches the scraper.
function normalizeSiteUrl(raw) {
  const trimmed = (raw || '').trim();
  if (!trimmed) return { ok: false, url: '' };
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return { ok: true, url: new URL(withScheme).toString() };
  } catch (_) {
    return { ok: false, url: '' };
  }
}

/**
 * @param {object} opts
 * @param {string} opts.token
 * @param {'images'|'texts'|'theme'} opts.mode
 * @param {(result: {images, texts, colors, brandColors, siteUrl}) => void} opts.onComplete
 */
export function openScrapeModal({ token, mode, onComplete }) {
  const overlay = document.createElement('div');
  overlay.className = 'dp-modal-overlay';

  const title = mode === 'texts' ? 'Import Texts' : mode === 'theme' ? 'Import Theme' : 'Import Images';
  overlay.innerHTML = `
    <div class="dp-modal">
      <h3>${title}</h3>
      <input type="text" id="dp-scrape-url" class="dp-text-input" placeholder="adobe.com or https://adobe.com" autocomplete="off" />
      <p class="dp-status" id="dp-scrape-status"></p>
      <p class="dp-error" id="dp-scrape-error"></p>
      <div class="dp-modal-actions">
        <sl-button id="dp-scrape-cancel">Cancel</sl-button>
        <sl-button id="dp-scrape-go" variant="cta">Scrape</sl-button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const urlInput = overlay.querySelector('#dp-scrape-url');
  const statusEl = overlay.querySelector('#dp-scrape-status');
  const errorEl = overlay.querySelector('#dp-scrape-error');
  const goBtn = overlay.querySelector('#dp-scrape-go');
  const cancelBtn = overlay.querySelector('#dp-scrape-cancel');

  let ctl = null;

  const close = () => {
    if (ctl) { try { ctl.abort(); } catch (_) { /* ignore */ } }
    overlay.remove();
  };

  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  cancelBtn.addEventListener('click', close);

  goBtn.addEventListener('click', async () => {
    const { ok, url } = normalizeSiteUrl(urlInput.value);
    if (!ok) { errorEl.textContent = 'Enter a valid URL first (e.g. adobe.com).'; return; }
    if (!token) { errorEl.textContent = 'No IMS token available — cannot scrape.'; return; }
    errorEl.textContent = '';
    statusEl.textContent = 'Starting…';
    goBtn.setAttribute('disabled', 'true');

    ctl = new AbortController();
    const params = {
      images: mode === 'images',
      colors: mode === 'theme',
      brandColors: mode === 'theme',
      texts: mode === 'texts',
    };

    try {
      const result = await runScrape({
        url,
        params,
        token,
        signal: ctl.signal,
        onProgress: (evt) => { if (evt && typeof evt.message === 'string') statusEl.textContent = evt.message; },
      });
      onComplete({ ...result, siteUrl: url });
      close();
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      // A CORS-blocked request surfaces to page JS as a generic "Failed to
      // fetch" TypeError with no status code — the browser hides the real
      // reason. Since Adobe API gateways commonly only attach CORS headers to
      // authenticated requests (omitting them on a 401), this is usually a
      // bad/expired token rather than a genuine origin allow-list problem —
      // but it can't be told apart from here, so we surface both possibilities.
      const isOpaqueNetworkFailure = err instanceof TypeError;
      errorEl.textContent = isOpaqueNetworkFailure
        ? 'Network/CORS error (see console) — likely an invalid or expired token, but could be an origin allow-list issue.'
        : (err && err.message) || 'Scrape failed';
      statusEl.textContent = '';
      goBtn.removeAttribute('disabled');
    }
  });
}

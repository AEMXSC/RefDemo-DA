/*
 * analytics — Demo Pilot usage tracking → Adobe Analytics. Ported unchanged
 * from the UE extension (host-agnostic: a direct XML POST to the Adobe
 * Analytics Data Insertion API, no SDK).
 *
 * Design: a module-level singleton holds the "global" eVars (org / site / AEM
 * host / user / imported brand) that ride on every event. The plugin shell
 * pushes those in via setAnalyticsContext() as they resolve from the DA SDK
 * context + IMS profile lookup. track(action) merges the global context, logs
 * + buffers for dev visibility, then fires the AA POST. track() never throws
 * and the send is fire-and-forget.
 *
 * eVar / event mapping (create/confirm in the report suite):
 *   eVar3  User ID        (signed-in email)
 *   eVar4  Host name      (AEM host, when applicable — DA sites may leave this empty)
 *   eVar5  Site name      (DA `repo` — the site identifier)
 *   eVar12 AEM program    (parsed from aemHost, when present)
 *   eVar13 AEM env        (parsed from aemHost, when present)
 *   eVar14 IMS org id
 *   eVar16 Extension name (static 'demo-pilot')
 *   eVar17 Imported brand (imported site host, e.g. www.ikea.com)
 *   eVar19 Action         (import-started | import-completed | image-copied |
 *                          text-copied | theme-applied)
 *   events event7         (single usage event, every call)
 */

const REPORT_SUITE_ID = 'aemholreferencedemo';
const ANALYTICS_URL = `https://aemhol0.112.2o7.net/b/ss/${REPORT_SUITE_ID}/6`;
const EXTENSION_NAME = 'demo-pilot';
const PAGE_NAME = 'DemoPilotUsageInfo';
const USAGE_EVENT = 'event7';

const EVAR = {
  userId: 'eVar3',
  siteName: 'eVar5',
  orgId: 'eVar14',
  importedBrand: 'eVar17',
};

export const EVENTS = {
  IMPORT_STARTED: 'import-started',
  IMPORT_COMPLETED: 'import-completed',
  IMAGE_COPIED: 'image-copied',
  TEXT_COPIED: 'text-copied',
  THEME_APPLIED: 'theme-applied',
};

const context = {
  orgId: '',
  userId: '',
  siteName: '',
  importedBrand: '',
  aemHost: '',
};

export function setAnalyticsContext(partial) {
  if (!partial || typeof partial !== 'object') return;
  Object.assign(context, partial);
}

export function hostFromUrl(u) {
  if (!u || typeof u !== 'string') return '';
  try {
    return new URL(u).hostname;
  } catch (_) {
    return '';
  }
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

let cachedIp;
async function getClientIP() {
  if (cachedIp !== undefined) return cachedIp;
  try {
    const resp = await fetch('https://api.ipify.org?format=json');
    const data = await resp.json();
    cachedIp = (data && data.ip) || '';
  } catch (_) {
    cachedIp = '';
  }
  return cachedIp;
}

async function sendToAdobeAnalytics({ action, fields, aemHost }) {
  const elements = [];
  elements.push(`        <eVar16>${EXTENSION_NAME}</eVar16>`);
  elements.push(`        <events>${USAGE_EVENT}</events>`);
  if (action) elements.push(`        <eVar19>${escapeXml(action)}</eVar19>`);

  for (const [key, evar] of Object.entries(EVAR)) {
    const v = fields[key];
    if (v) elements.push(`        <${evar}>${escapeXml(v)}</${evar}>`);
  }

  if (aemHost) {
    let host = '';
    try { host = new URL(aemHost).host; } catch (_) { host = ''; }
    if (host) elements.push(`        <eVar4>${escapeXml(host)}</eVar4>`);
    const p = aemHost.match(/-p(\d+)/);
    const e = aemHost.match(/-e(\d+)/);
    if (p) elements.push(`        <eVar12>${p[1]}</eVar12>`);
    if (e) elements.push(`        <eVar13>${e[1]}</eVar13>`);
  }

  const ip = await getClientIP();
  if (ip) elements.push(`        <ipAddress>${ip}</ipAddress>`);
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  if (ua) elements.push(`        <userAgent>${escapeXml(ua)}</userAgent>`);

  const pageURL = (typeof window !== 'undefined' && window.location.href) || '';
  const xmlBody = `<?xml version="1.0" encoding="UTF-8"?>
<request>
        <pageURL>${escapeXml(pageURL)}</pageURL>
        <pageName>${PAGE_NAME}</pageName>
        <reportSuiteID>${REPORT_SUITE_ID}</reportSuiteID>
${elements.join('\n')}
</request>`;

  const resp = await fetch(ANALYTICS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml' },
    body: xmlBody,
  });
  if (!resp.ok) throw new Error(`Analytics request failed: ${resp.status} ${resp.statusText}`);
  return resp.text();
}

const LOG_LIMIT = 100;
const log = [];

function dispatch(record) {
  log.push(record);
  if (log.length > LOG_LIMIT) log.shift();
  // eslint-disable-next-line no-console
  console.log('[analytics]', record.action, record.fields);
  sendToAdobeAnalytics(record).catch((err) => {
    // eslint-disable-next-line no-console
    console.warn('[analytics] send failed:', err && (err.message || err));
  });
}

export function track(action) {
  if (!action) return;
  try {
    const fields = {
      userId: context.userId || '',
      siteName: context.siteName || '',
      orgId: context.orgId || '',
      importedBrand: context.importedBrand || '',
    };
    dispatch({ action, fields, aemHost: context.aemHost || '', ts: new Date().toISOString() });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[analytics] track failed:', err && (err.message || err));
  }
}

if (typeof window !== 'undefined') {
  window.__demoPilotAnalytics = { log, context, EVENTS };
}

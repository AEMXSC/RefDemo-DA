/*
 * Extension-wide constants for the DA Demo Pilot library plugin.
 */

// Scraper backend — LiveDemos split into two hosts since the original UE
// extension was built: a scraper host (URL-scrape/import, used here) and a
// separate platform host for per-workspace asset storage (not used by this
// plugin — texts persistence goes through DA's own Source API instead, see
// lib/textStorage.js). Confirmed against a sibling team's working UE
// extension update — the `-stage` host was stale/misconfigured for
// cross-origin callers, which is what caused CORS+401 during local testing.
export const LIVEDEMOS_BASE_URL = 'https://livedemos-scraper.adobe.io';
export const LIVEDEMOS_ASSETS_PATH = '/api/assets';

// Deployed Adobe I/O Runtime action URLs — kept/added backend actions (all
// operate on the AEM Assets HTTP API, not CRX/JCR). Deployed via
// `aio app deploy` to the DAdemopilotEXT / Production workspace.
export const UPLOAD_TO_DAM_ACTION_URL = 'https://3635370-966fuchsiacentipede.adobeioruntime.net/api/v1/web/demo-pilot/upload-to-dam';
export const ENSURE_IMPORT_FOLDER_ACTION_URL = 'https://3635370-966fuchsiacentipede.adobeioruntime.net/api/v1/web/demo-pilot/ensure-import-folder';
// Fetches a DAM asset's bytes server-side (Bearer-token auth against AEM
// Author) and returns them base64-encoded with CORS headers — needed because
// browser <img>/fetch() against a bare DAM repo path resolves against the
// wrong origin (the DA site's own delivery domain, not the AEM instance) and,
// even pointed at the right host, Author isn't generally CORS-open to
// arbitrary browser origins. See lib/clipboard.js.
export const GET_DAM_ASSET_ACTION_URL = 'https://3635370-966fuchsiacentipede.adobeioruntime.net/api/v1/web/demo-pilot/get-dam-asset';
// Fetches an arbitrary scraped-site image URL server-side and returns it
// base64-encoded with CORS headers — needed because a browser fetch() of
// that URL is blocked whenever the source site omits CORS headers on its
// image responses (common for hotlinked assets). See lib/uploadImages.js.
// Not yet deployed — fill in after `aio app deploy`; uploadImagesToDa()
// falls back to a direct client-side fetch while this is empty.
export const FETCH_IMAGE_ACTION_URL = 'https://675172-referencedemopartner-stage.adobeioruntime.net/api/v1/web/ref-demo-api-gateway/proxy-ss-cors-fetch';

// IMS Organization ID for the AEM Cloud Service instance behind
// aem.repositoryId (sent as x-gw-ims-org-id on Assets HTTP API calls — see
// actions/upload-to-dam). DA's SDK context has no equivalent field (DA's
// "org" is a GitHub-org-style project namespace, a completely different
// identifier), so unlike authorUrl this can't be derived automatically.
// Find it in Adobe Developer Console for the AEM environment. Optional: the
// kept action only sends the header when this is non-empty.
export const AEM_ORG_ID = '';

// DA Admin API origin (Source / List APIs).
export const DA_ADMIN_ORIGIN = 'https://admin.da.live';

// EDS admin API origin (preview/live publish) for the single shared theme.json.
export const EDS_ADMIN_ORIGIN = 'https://admin.hlx.page';

// DA structured-content preview worker — resolves a structured-content doc
// (e.g. a brand-theme JSON under THEMES_ASSETS_FOLDER) to its rendered JSON
// values, unlike the Source API's getSource which returns the raw doc.
// See lib/themeBrowser.js.
export const DA_STRUCTURED_CONTENT_ORIGIN = 'https://da-sc.adobeaem.workers.dev';

// Canonical site-wide theme file + saved-theme library folder — see
// lib/theme.js. Both are plain DA sheets, no Content Fragments involved.
export const THEME_PATH = '/theme.json';
export const THEMES_FOLDER = '/themes';

// Scraped-texts cache — a plain JSON doc under a hidden project folder
// (mirrors the old /var/text-storage/{slug} JCR node, minus JCR).
export const TEXTS_PATH = '/.da/demo-pilot/texts.json';

// Root folder (in this DA site, via the Source API) that scraped images are
// written into, one subfolder per scraped site's hostname — see
// lib/uploadImages.js. Replaces the old AEM DAM upload flow (uploadAssets.js
// + UPLOAD_TO_DAM_ACTION_URL above): images now live in DA itself.
export const ASSETS_FOLDER = '/assets/images';

// Catalog sheet (DA multi-sheet doc, single tab "data") recording metadata
// for every image imported into ASSETS_FOLDER — id/url/thumbnail/label/tags/
// width/height/brand/path columns. See lib/assetsCatalog.js.
export const CATALOG_PATH = '/config/assets-catalog.json';
export const CATALOG_SHEET_NAME = 'data';

// Root folder for the newer, schema-driven brand-theme structured content —
// one subfolder per brand, each holding one JSON doc per theme (see the
// "Brand Theme" JSON schema: brand-theme-color/brand-dark-color/etc). Browsed
// via lib/themeBrowser.js, distinct from the legacy CF-derived THEME_PATH/
// THEMES_FOLDER flow above (built for the UE-based site, kept as-is here).
export const THEMES_ASSETS_FOLDER = '/assets/themes';

// Site placeholders sheet (key/value rows) — same file tools/invoke-service
// reads for "external-service-url" etc. lib/placeholders.js upserts the
// "theme" key here to point at the brand-theme doc an author picked.
export const PLACEHOLDERS_PATH = '/config/placeholders.json';

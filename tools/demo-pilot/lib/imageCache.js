/*
 * imageCache — persist already-imported image paths in the browser
 * (localStorage), scoped per DA site (org/repo). Reopening the plugin (or
 * navigating within the same DA site) shows previously imported images
 * immediately instead of forcing a full re-scrape + re-upload every time.
 * Purely a client-side convenience cache — cleared only if the user clears
 * their browser storage, no server round trip involved.
 */

const PREFIX = 'demo-pilot:images:';

function keyFor(org, repo) {
  return `${PREFIX}${org}/${repo}`;
}

export function loadCachedImages({ org, repo }) {
  try {
    const raw = localStorage.getItem(keyFor(org, repo));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

export function saveCachedImages({ org, repo, images }) {
  try {
    localStorage.setItem(keyFor(org, repo), JSON.stringify(images || []));
  } catch (_) {
    /* storage full/unavailable — best-effort, never throw into the UI */
  }
}

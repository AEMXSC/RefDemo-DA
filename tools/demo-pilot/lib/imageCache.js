/*
 * imageCache — persist already-imported image paths in the browser
 * (localStorage), scoped per DA site (org/repo). Reopening the plugin (or
 * navigating within the same DA site) shows previously imported images
 * immediately instead of forcing a full re-scrape + re-upload every time.
 * Purely a client-side convenience cache — cleared only if the user clears
 * their browser storage, no server round trip involved.
 *
 * v2: entries are { src, path? } — src is always a directly displayable URL
 * (the original scraped source, safe for a plain <img>), path is the bare
 * AEM DAM repo path used only for Copy (via get-dam-asset). v1 entries were
 * `{ path: bareRepoPath }` with no src, which a plain <img> resolves against
 * the DA site's own origin — producing 404s, not the AEM instance. The
 * version bump abandons old-format entries outright rather than trying to
 * migrate them.
 */

const PREFIX = 'demo-pilot:images:v2:';

function keyFor(org, repo) {
  return `${PREFIX}${org}/${repo}`;
}

// Defends against any malformed/stale entry slipping through regardless of
// version — an item is only worth showing if it has something a plain <img>
// can actually load.
function isDisplayable(img) {
  if (!img) return false;
  if (typeof img.src === 'string' && img.src) return true;
  return typeof img.path === 'string' && /^https?:\/\//i.test(img.path);
}

export function loadCachedImages({ org, repo }) {
  try {
    const raw = localStorage.getItem(keyFor(org, repo));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isDisplayable) : [];
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

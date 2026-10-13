import { createOptimizedPicture } from '../../scripts/aem.js';
import {
  a, div, h2, img, p,
} from '../../scripts/dom-helpers.js';

const SC_DELIVERY = 'https://da-sc.adobeaem.workers.dev';

function currentSite() {
  const host = window.location.hostname;
  const match = host.match(/^(?:[^.]+--)?([^-.]+)--([^.]+)\.aem\.(page|live)$/);
  if (!match) return null;
  return { repo: match[1], org: match[2], env: match[3] === 'live' ? 'live' : 'preview' };
}

// Read the authored "/fragments/..." path ONCE and remember it on the element.
// DA Layout mode re-runs the decorator on a block that a previous pass already
// rendered — at which point the original path text is gone and only the teaser
// markup remains. Persisting it keeps re-decoration idempotent.
function fragmentPath(block) {
  if (block.dataset.fragmentPath) return block.dataset.fragmentPath;
  const link = block.querySelector('a');
  const value = (link?.getAttribute('href') || block.textContent || '').trim();
  if (!value) return '';
  const path = `/${value.replace(/^\/+/, '').replace(/\.(html|json)$/i, '')}`;
  block.dataset.fragmentPath = path;
  return path;
}

// Resolve a structured-content image value to a URL the PUBLISHED page can load.
// DA assets live under the site itself: an origin-relative "/assets/x.jpeg" on
// aem.page/aem.live redirects to the media-bus URL. content.da.live URLs are
// only valid inside DA, so we normalise to an origin-relative path here and let
// the browser resolve it against the current aem.page/live host. External
// absolute delivery URLs are left untouched.
function resolveImage(value, site) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const media = raw.match(/^https?:\/\/(?:www\.)?da\.live\/media#(.*)$/i);
  let path = raw;
  if (media) {
    const [, mediaPath] = media;
    path = mediaPath;
  } else if (/^https?:\/\//i.test(raw)) {
    return raw; // external / already-absolute delivery URL
  }
  path = path.startsWith('/') ? path : `/${path}`;
  if (site) {
    const prefix = `/${site.org}/${site.repo}`;
    if (path === prefix || path.startsWith(`${prefix}/`)) path = path.slice(prefix.length) || '/';
  }
  return path;
}

async function fetchEnv(env, site, path) {
  const url = `${SC_DELIVERY}/${env}/${site.org}/${site.repo}${path}`;
  const resp = await fetch(url).catch(() => null);
  // eslint-disable-next-line no-console
  console.log('[structured-teaser]', {
    path,
    url,
    status: resp && resp.status,
    location: window.location.href,
    dapreview: new URL(window.location.href).searchParams.get('dapreview'),
  });
  if (!resp || !resp.ok) return null;
  const json = await resp.json().catch(() => null);
  if (json && json.data) {
    // eslint-disable-next-line no-console
    console.log('[structured-teaser] data keys:', Object.keys(json.data));
    return json;
  }
  return null;
}

async function fetchFragment(path, site) {
  if (!site || !path) return null;
  // A fragment may be published to only one of preview/live; try the env the
  // host implies first, then the other, so the block renders in DA preview
  // (aem.page), DA Layout, and on the published page (aem.live) alike.
  const [first, second] = site.env === 'live' ? ['live', 'preview'] : ['preview', 'live'];
  return (await fetchEnv(first, site, path)) || fetchEnv(second, site, path);
}

export default async function decorate(block) {
  const path = fragmentPath(block);
  const site = currentSite();
  const json = await fetchFragment(path, site);

  if (!json) {
    // eslint-disable-next-line no-console
    console.warn('[structured-teaser] no structured content for', path, 'site:', site);
    block.dataset.blockStatus = 'error';
    block.replaceChildren(div(
      { class: 'structured-teaser-body' },
      p(`Structured content unavailable: ${path || '(no path)'}`),
    ));
    return;
  }

  const { data } = json;
  const title = data.title || json.metadata?.title || path.split('/').pop();
  const description = data.description || data.subtitle || '';
  const image = resolveImage(data.bannerimage || data.bannerImage || data.image || '', site);
  const link = data.ctalink || data.ctaLink || '';
  const label = data.ctalabel || data.ctaLabel || 'Learn more';

  const media = div(
    { class: 'structured-teaser-media' },
    image ? createOptimizedPicture(image, title, 'lazy', [{ width: '750' }]) : img({ alt: '' }),
  );
  const body = div(
    { class: 'structured-teaser-body' },
    h2(title),
    description ? p(description) : '',
    link ? p({ class: 'button-container' }, a({ class: 'button primary', href: link }, label)) : '',
  );

  block.replaceChildren(media, body);
}

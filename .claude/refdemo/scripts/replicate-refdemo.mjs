#!/usr/bin/env node
/* eslint-disable no-console, no-await-in-loop, no-restricted-syntax, no-continue, max-len */
/**
 * Replicate the RefDemo base Document Authoring (DA) site into another DA site.
 *
 * Copies every document, sheet, fragment, asset, page-embedded image (hidden ".page"
 * folders), structured content schema (.da/forms/schemas), the DA site configuration and
 * the site's editor.path mappings, and the Edge Delivery custom headers. Rewrites every
 * reference to the source org/site so the copy points at itself.
 *
 * Usage:
 *   node .claude/refdemo/scripts/replicate-refdemo.mjs --target <org>/<site> [options]
 *
 * Options:
 *   --source <org>/<site>   Base site (default: aemxsc/refdemo-da)
 *   --target <org>/<site>   Site to replicate into (required)
 *   --dry-run               Read everything, write nothing, print the plan
 *   --on-conflict <mode>    overwrite (default) | skip : files that exist in the target
 *                           with different content
 *   --local-dir <dir>       Mirror pages/sheets locally before upload (default: content,
 *                           "" to disable)
 *   --no-org-config         Do not add editor.path mappings to the target org config
 *   --no-eds-headers        Do not merge Edge Delivery custom headers
 *   --no-preview            Skip the Edge Delivery preview of pages, sheets and assets
 *                           (preview runs by default after copying; never publishes live)
 *   --report <file>         Report location
 *                           (default: migration-work/refdemo-replication/report.json)
 *   --concurrency <n>       Parallel requests (default: 4)
 *   --force-target          Skip the check that the target's content source is this DA site
 *
 * Auth: requests carry no credentials unless DA_TOKEN is set (IMS access token, sent as a
 * Bearer token to admin.da.live and admin.hlx.page). On aemcoder credentials are injected
 * automatically. Tokens are never printed.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const DA = 'https://admin.da.live';
const HLX = 'https://admin.hlx.page';
const API = 'https://api.aem.live';

/* ------------------------------------------------------------------ args */
function parseArgs(argv) {
  const opts = {
    source: 'aemxsc/refdemo-da',
    target: '',
    dryRun: false,
    onConflict: 'overwrite',
    localDir: 'content',
    orgConfig: true,
    edsHeaders: true,
    preview: true,
    report: 'migration-work/refdemo-replication/report.json',
    concurrency: 4,
    forceTarget: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => { i += 1; return argv[i]; };
    if (a === '--source') opts.source = next();
    else if (a === '--target') opts.target = next();
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--on-conflict') opts.onConflict = next();
    else if (a === '--local-dir') opts.localDir = next();
    else if (a === '--no-org-config') opts.orgConfig = false;
    else if (a === '--no-eds-headers') opts.edsHeaders = false;
    else if (a === '--preview') opts.preview = true; // default; kept for compatibility
    else if (a === '--no-preview') opts.preview = false;
    else if (a === '--report') opts.report = next();
    else if (a === '--concurrency') opts.concurrency = Math.max(1, parseInt(next(), 10) || 4);
    else if (a === '--force-target') opts.forceTarget = true;
    else throw new Error(`Unknown option: ${a}`);
  }
  const re = /^[a-z0-9-]+\/[a-z0-9-]+$/;
  opts.source = String(opts.source || '').toLowerCase().replace(/^\/|\/$/g, '');
  opts.target = String(opts.target || '').toLowerCase().replace(/^\/|\/$/g, '');
  if (!re.test(opts.source)) throw new Error('--source must look like org/site');
  if (!re.test(opts.target)) throw new Error('--target must look like org/site');
  if (opts.source === opts.target) throw new Error('Source and target are the same site.');
  if (!['overwrite', 'skip'].includes(opts.onConflict)) throw new Error('--on-conflict must be overwrite or skip');
  return opts;
}

/* ------------------------------------------------------------------ http */
const TOKEN = process.env.DA_TOKEN || '';
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

async function req(url, init = {}, { retries = 4, okStatuses = [] } = {}) {
  const headers = { ...(init.headers || {}) };
  if (TOKEN && !headers.Authorization) headers.Authorization = `Bearer ${TOKEN}`;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(url, { ...init, headers });
      if (res.ok || okStatuses.includes(res.status)) return res;
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`${res.status} ${res.headers.get('x-error') || ''} ${url}`);
        await sleep(500 * 2 ** attempt);
      } else {
        const err = new Error(`${res.status} ${res.headers.get('x-error') || ''} ${init.method || 'GET'} ${url}`.trim());
        err.status = res.status;
        throw err;
      }
    } catch (e) {
      if (e.status) throw e;
      lastErr = e;
      await sleep(500 * 2 ** attempt);
    }
  }
  throw lastErr;
}

async function pool(items, n, fn) {
  const results = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx;
      idx += 1;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

/* ------------------------------------------------------------------ rewrite */
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function makeRewriter(source, target) {
  const [sOrg, sSite] = source.split('/');
  const [tOrg, tSite] = target.split('/');
  const rules = [
    // EDS hosts (main branch). Media bus URLs stay on the source: media is stored per site.
    [new RegExp(`main--${escapeRe(sSite)}--${escapeRe(sOrg)}\\.(aem|hlx)\\.(page|live)(?!/media_)`, 'gi'),
      `main--${tSite}--${tOrg}.$1.$2`],
    // GitHub-style owner/repo with mixed case, e.g. github.com/AEMXSC/RefDemo-da
    [new RegExp(`(github\\.com/)${escapeRe(sOrg)}/${escapeRe(sSite)}(?=[/"'#?\\s<).]|$)`, 'gi'),
      `$1${tOrg}/${tSite}`],
    // DA paths: content.da.live/org/site/, da.live/#/org/site, editor.path=/org/site/...
    [new RegExp(`/${escapeRe(sOrg)}/${escapeRe(sSite)}(?=[/"'#?\\s<=)&]|$)`, 'gi'), `/${tOrg}/${tSite}`],
  ];
  return (text) => {
    let out = text;
    let count = 0;
    for (const [re, rep] of rules) {
      count += (out.match(re) || []).length;
      out = out.replace(re, rep);
    }
    return { text: out, count };
  };
}

const TEXT_EXT = new Set(['html', 'json', 'svg', 'txt', 'md', 'xml', 'css']);
const MIME = {
  html: 'text/html',
  json: 'application/json',
  svg: 'image/svg+xml',
  txt: 'text/plain',
  md: 'text/markdown',
  xml: 'application/xml',
  css: 'text/css',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  pdf: 'application/pdf',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
};

/* ------------------------------------------------------------------ DA list */
// Paths never copied: deleted items and in-flight translation jobs of the source.
const EXCLUDE = [/^\.trash(\/|$)/, /^\.da\/translation(\/|$)/];
const excluded = (rel) => EXCLUDE.some((re) => re.test(rel));

async function listDir(daPath) {
  const items = [];
  let token = '';
  do {
    const headers = token ? { 'da-continuation-token': token } : {};
    const res = await req(`${DA}/list${daPath}`, { headers }, { okStatuses: [404] });
    if (res.status === 404) return items;
    const json = await res.json();
    items.push(...(Array.isArray(json) ? json : []));
    token = res.headers.get('da-continuation-token') || '';
  } while (token);
  return items;
}

/**
 * Walk the site. DA hides dot-folders from listings, so probe the ones DA creates:
 * ".<page>" next to each page (images pasted into that page) and ".da" at the root.
 */
async function walk(root) {
  const files = new Map(); // rel -> { rel, ext }
  const seenDirs = new Set();
  const queue = [''];
  const probe = new Set(['.da']);
  while (queue.length || probe.size) {
    const batch = queue.splice(0, queue.length);
    for (const p of probe) batch.push(p);
    probe.clear();
    const lists = await pool(batch, 6, async (rel) => {
      if (seenDirs.has(rel) || excluded(rel)) return [rel, []];
      seenDirs.add(rel);
      return [rel, await listDir(`/${root}${rel ? `/${rel}` : ''}`)];
    });
    for (const [, items] of lists) {
      for (const item of items) {
        if (!item.name && !item.ext) continue;
        const rel = item.path.replace(`/${root}/`, '').replace(/\/$/, '');
        if (!rel || excluded(rel)) continue;
        if (item.ext) {
          files.set(rel, { rel, ext: item.ext.toLowerCase() });
          if (item.ext === 'html') {
            const dir = path.posix.dirname(rel);
            const hidden = `${dir === '.' ? '' : `${dir}/`}.${item.name}`;
            if (!seenDirs.has(hidden)) probe.add(hidden);
          }
        } else if (!seenDirs.has(rel)) {
          queue.push(rel);
        }
      }
    }
  }
  return [...files.values()].sort((a, b) => a.rel.localeCompare(b.rel));
}

/* ------------------------------------------------------------------ files */
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

async function getSource(site, rel) {
  const res = await req(`${DA}/source/${site}/${rel}`, {}, { okStatuses: [404] });
  if (res.status === 404) return null;
  return Buffer.from(await res.arrayBuffer());
}

const MEDIA_EXT = /\.(jpe?g|png|gif|webp|avif|svg|mp4|webm|mov|pdf)$/i;

/**
 * Identify a media URL by its file name only. When an author opens a page, DA re-saves it and
 * copies external images/videos into the site (".<page>/media-<hash>-<id>.jpg",
 * "shared-media/<name>-<id>.mp4"); the slug ignores host, folder and that trailing id.
 */
function mediaSlug(url) {
  let name;
  try { name = new URL(url.replace(/&amp;/g, '&')).pathname.split('/').pop(); } catch { return null; }
  if (!name || !MEDIA_EXT.test(name)) return null;
  return decodeURIComponent(name).toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/-[0-9a-f]{8}(?=\.[a-z0-9]+$)/, '');
}

/** Compare HTML as DA sees it: main content only, whitespace-insensitive, media by name. */
function normHtml(html) {
  const m = html.match(/<main[^>]*>([\s\S]*)<\/main>/i);
  return (m ? m[1] : html)
    .replace(/https?:\/\/[^\s"'<>]+/g, (u) => {
      const slug = mediaSlug(u);
      return slug ? `media:${slug}` : u;
    })
    .replace(/>\s+</g, '><')
    .replace(/\s+/g, ' ')
    .trim();
}

function sameContent(ext, a, b) {
  if (!a || !b) return false;
  if (sha(a) === sha(b)) return true;
  if (ext === 'json') {
    try { return JSON.stringify(JSON.parse(a)) === JSON.stringify(JSON.parse(b)); } catch { return false; }
  }
  if (ext === 'html') return normHtml(a.toString('utf8')) === normHtml(b.toString('utf8'));
  return false;
}

async function putSource(site, rel, ext, buf) {
  const form = new FormData();
  form.append('data', new Blob([buf], { type: MIME[ext] || 'application/octet-stream' }), path.posix.basename(rel));
  await req(`${DA}/source/${site}/${rel}`, { method: 'POST', body: form });
}

/** Mirror a page or sheet locally, then rebuild the upload body from the local file. */
function mirrorLocal(localDir, rel, ext, text) {
  if (!localDir || (ext !== 'html' && ext !== 'json')) return text;
  if (ext === 'json') {
    const file = path.join(localDir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    return fs.readFileSync(file, 'utf8');
  }
  const m = text.match(/^([\s\S]*?<main[^>]*>)([\s\S]*)(<\/main>[\s\S]*)$/i);
  if (!m) return text;
  const file = path.join(localDir, `${rel.replace(/\.html$/, '')}.plain.html`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, m[2]);
  return `${m[1]}${fs.readFileSync(file, 'utf8')}${m[3]}`;
}

/* ------------------------------------------------------------------ configs */
async function getJson(url) {
  const res = await req(url, {}, { okStatuses: [404] });
  if (res.status === 404) return null;
  return res.json();
}

/** Normalise a DA config (single sheet or multi-sheet) to { sheetName: sheetObj }. */
function toSheets(cfg) {
  if (!cfg) return {};
  if (cfg[':type'] === 'multi-sheet') {
    const out = {};
    for (const n of cfg[':names'] || []) out[n] = cfg[n];
    return out;
  }
  return { [cfg[':sheetname'] || 'data']: cfg };
}

function fromSheets(sheets) {
  const names = Object.keys(sheets);
  const fix = (s) => {
    const sheet = { ...s, data: s.data || [] };
    sheet.total = sheet.data.length;
    sheet.limit = sheet.data.length;
    sheet.offset = 0;
    return sheet;
  };
  if (names.length === 1 && names[0] === 'data') {
    return { ...fix(sheets.data), ':sheetname': 'data', ':type': 'sheet' };
  }
  const out = {};
  for (const n of names) {
    const { ':sheetname': drop1, ':type': drop2, ...rest } = fix(sheets[n]);
    out[n] = rest;
  }
  return {
    ...out, ':names': names, ':version': 3, ':type': 'multi-sheet',
  };
}

const rowKey = (r) => (r.key ?? r.Key ?? '').toString();
const rowVal = (r) => (r.value ?? r.Value ?? '').toString();
const MULTI_KEYS = new Set(['editor.path']);

/** Merge source rows into target rows: target-only rows stay, source wins on shared keys. */
function mergeRows(targetRows, sourceRows, sheetName) {
  const out = [...targetRows];
  const sig = (r) => JSON.stringify(r);
  for (const row of sourceRows) {
    if (out.some((r) => sig(r) === sig(row))) continue;
    if (sheetName === 'library') {
      const i = out.findIndex((r) => r.title === row.title);
      if (i >= 0) out[i] = row; else out.push(row);
      continue;
    }
    const k = rowKey(row);
    if (k && MULTI_KEYS.has(k)) {
      const left = rowVal(row).split('=')[0];
      const i = out.findIndex((r) => rowKey(r) === k && rowVal(r).split('=')[0] === left);
      if (i >= 0) out[i] = row; else out.push(row);
    } else if (k) {
      const i = out.findIndex((r) => rowKey(r) === k);
      if (i >= 0) out[i] = row; else out.push(row);
    } else {
      out.push(row);
    }
  }
  return out;
}

async function postConfig(scope, cfg) {
  const form = new FormData();
  form.append('config', JSON.stringify(cfg));
  await req(`${DA}/config/${scope}/`, { method: 'POST', body: form });
}

/* ------------------------------------------------------------------ preview */
function previewPath(rel, ext) {
  if (ext === 'html') {
    const p = `/${rel.replace(/\.html$/, '')}`;
    return p.endsWith('/index') ? p.slice(0, -5) || '/' : p;
  }
  return `/${rel}`;
}

/**
 * Everything Edge Delivery can serve: pages, sheets (placeholders, tags, library and other
 * configuration sheets) and assets. Hidden folders (.da, .<page> image folders) are not
 * previewable; page images are ingested when their page is previewed.
 * Assets first, then sheets, then pages, so pages resolve their references on first render.
 */
function previewPaths(results) {
  const rank = (r) => {
    if (r.ext === 'html') return 2;
    if (r.ext === 'json') return 1;
    return 0;
  };
  return results
    .filter((r) => ['created', 'updated', 'unchanged'].includes(r.status))
    .filter((r) => !r.rel.split('/').some((seg) => seg.startsWith('.')))
    .sort((a, b) => rank(a) - rank(b) || a.rel.localeCompare(b.rel))
    .map((r) => previewPath(r.rel, r.ext));
}

const PREVIEW_CLIENT_ERRORS = [400, 401, 403, 404, 409, 413, 414, 415, 422];

async function previewOne(org, site, p) {
  try {
    const res = await req(`${HLX}/preview/${org}/${site}/main${p}`, { method: 'POST' }, { okStatuses: PREVIEW_CLIENT_ERRORS });
    return { path: p, status: res.status, error: res.ok ? '' : res.headers.get('x-error') || '' };
  } catch (e) {
    return { path: p, status: e.status || 0, error: e.message };
  }
}

/** Bulk preview job; falls back to (and retries failures with) single-page previews. */
async function previewAll(target, paths, concurrency, log) {
  const [org, site] = target.split('/');
  const status = new Map(paths.map((p) => [p, { path: p, status: 0, error: 'not processed' }]));
  let details = null;
  try {
    const res = await req(`${HLX}/preview/${org}/${site}/main/*`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ forceUpdate: true, paths }),
    });
    const job = await res.json();
    const jobUrl = job?.links?.self || job?.job?.links?.self;
    details = job;
    if (jobUrl) {
      log(`Previewing ${paths.length} paths (bulk job) ...`);
      for (let i = 0; i < 120; i += 1) {
        await sleep(5000);
        const st = await (await req(jobUrl)).json();
        const state = st.state || st.job?.state;
        if (state === 'stopped' || st.stopTime || st.job?.stopTime) {
          details = await (await req(`${jobUrl}/details`)).json();
          break;
        }
      }
    }
    const resources = details?.data?.resources || details?.job?.data?.resources || [];
    for (const r of resources) {
      if (status.has(r.path)) status.set(r.path, { path: r.path, status: r.status, error: r.error || '' });
    }
  } catch (e) {
    details = { error: e.message };
    if (e.status === 401 || e.status === 403) {
      return { details, results: paths.map((p) => ({ path: p, status: e.status, error: e.message })) };
    }
  }
  // Anything not confirmed by the bulk job (or failed with a server error): preview one by one.
  const retry = [...status.values()].filter((r) => !(r.status >= 200 && r.status < 300) && !PREVIEW_CLIENT_ERRORS.includes(r.status));
  if (retry.length) {
    log(`Previewing ${retry.length} paths one by one ...`);
    const again = await pool(retry, Math.min(concurrency, 3), (r) => previewOne(org, site, r.path));
    for (const r of again) status.set(r.path, r);
  }
  return { details, results: [...status.values()] };
}

function editUrlFor(daPath, editorRows) {
  let best = null;
  for (const r of editorRows) {
    const v = rowVal(r);
    const eq = v.indexOf('=');
    if (eq > 0) {
      const left = v.slice(0, eq).replace(/\/$/, '').toLowerCase();
      const right = v.slice(eq + 1);
      if ((daPath === left || daPath.startsWith(`${left}/`)) && (!best || left.length > best.left.length)) {
        best = { left, right };
      }
    }
  }
  return `${best ? best.right : 'https://da.live/edit#'}${daPath}`;
}

/* ------------------------------------------------------------------ main */
async function checkTarget(opts) {
  const [org, site] = opts.target.split('/');
  const expected = `https://content.da.live/${org}/${site}/`;
  let url = '';
  try {
    const sk = await getJson(`${HLX}/sidekick/${org}/${site}/main/config.json`);
    url = sk?.contentSourceUrl || '';
  } catch (e) {
    if (e.status !== 401 && e.status !== 403) throw e;
    const cfg = await getJson(`${API}/${org}/sites/${site}/config.json`);
    url = cfg?.content?.source?.url || '';
  }
  return { url, expected, ok: url.replace(/\/?$/, '/') === expected };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const rewrite = makeRewriter(opts.source, opts.target);
  const report = {
    source: opts.source,
    target: opts.target,
    dryRun: opts.dryRun,
    startedAt: new Date().toISOString(),
    files: {
      total: 0, created: 0, updated: 0, unchanged: 0, skippedConflict: 0, failed: 0,
    },
    conflicts: [],
    failures: [],
    rewrites: 0,
    sourceMediaUrls: 0,
    siteConfig: null,
    orgConfig: null,
    edsHeaders: null,
    verify: null,
  };
  const log = (...a) => console.log(...a);

  // 0. target must be a DA site whose content source is the target itself
  const tgt = await checkTarget(opts);
  report.targetContentSource = tgt.url;
  if (!tgt.ok && !opts.forceTarget) {
    throw new Error(`Target content source is "${tgt.url || 'unknown'}", expected ${tgt.expected}. Not a DA site for ${opts.target}.`);
  }

  // 1. inventory
  log(`Listing ${opts.source} ...`);
  const files = await walk(opts.source);
  report.files.total = files.length;
  log(`Found ${files.length} files.`);

  // 2. copy files
  const results = await pool(files, opts.concurrency, async (f) => {
    try {
      const src = await getSource(opts.source, f.rel);
      if (!src) return { ...f, status: 'missing' };
      let body = src;
      const isText = TEXT_EXT.has(f.ext);
      if (isText) {
        const text = src.toString('utf8');
        const media = text.match(/main--[a-z0-9-]+--[a-z0-9-]+\.(aem|hlx)\.(page|live)\/media_/gi);
        report.sourceMediaUrls += media ? media.length : 0;
        const r = rewrite(text);
        report.rewrites += r.count;
        body = Buffer.from(r.text, 'utf8');
      }
      const existing = await getSource(opts.target, f.rel);
      const unchanged = existing && sameContent(f.ext, existing, body);
      // Same content, saved differently by DA (or with images copied into the site):
      // keep the target's version and mirror that locally.
      if (unchanged) body = existing;
      if (existing && !unchanged && opts.onConflict === 'skip') {
        report.conflicts.push(f.rel);
        return { ...f, status: 'skippedConflict' };
      }
      // Local copy first; the upload is built from the local file.
      if (isText && !opts.dryRun) {
        body = Buffer.from(mirrorLocal(opts.localDir, f.rel, f.ext, body.toString('utf8')), 'utf8');
      }
      if (unchanged) return { ...f, status: 'unchanged', body };
      if (existing) report.conflicts.push(f.rel);
      if (!opts.dryRun) await putSource(opts.target, f.rel, f.ext, body);
      return { ...f, status: existing ? 'updated' : 'created', body };
    } catch (e) {
      report.failures.push({ path: f.rel, error: e.message });
      return { ...f, status: 'failed' };
    }
  });
  for (const r of results) {
    if (report.files[r.status] !== undefined) report.files[r.status] += 1;
  }
  log(`Files: ${JSON.stringify(report.files)}`);

  // 3. DA site configuration (rewritten) + editor.path mappings from the source org config
  const [sOrg] = opts.source.split('/');
  const [tOrg] = opts.target.split('/');
  const srcSiteCfg = await getJson(`${DA}/config/${opts.source}/`);
  const srcOrgCfg = await getJson(`${DA}/config/${sOrg}/`).catch(() => null);
  const sitePrefix = `/${opts.source}`;
  const orgPaths = (toSheets(srcOrgCfg).data?.data || [])
    .filter((r) => {
      const left = rowVal(r).toLowerCase().split('=')[0].replace(/\/$/, '');
      return rowKey(r) === 'editor.path' && (left === sitePrefix || left.startsWith(`${sitePrefix}/`));
    })
    .map((r) => JSON.parse(rewrite(JSON.stringify(r)).text));
  let editorRows = [...orgPaths]; // used to build the "edit home page" link

  if (srcSiteCfg || orgPaths.length) {
    const srcSheets = toSheets(srcSiteCfg ? JSON.parse(rewrite(JSON.stringify(srcSiteCfg)).text) : null);
    if (orgPaths.length) {
      srcSheets.data = srcSheets.data || { data: [] };
      srcSheets.data.data = mergeRows(srcSheets.data.data || [], orgPaths, 'data');
    }
    const tgtCfg = await getJson(`${DA}/config/${opts.target}/`);
    const tgtSheets = toSheets(tgtCfg);
    for (const [name, sheet] of Object.entries(srcSheets)) {
      if (name === 'permissions') continue; // never copy access rules between sites
      const base = tgtSheets[name] || { ...sheet, data: [] };
      tgtSheets[name] = { ...base, data: mergeRows(base.data || [], sheet.data || [], name) };
      if (!base[':colWidths'] && sheet[':colWidths']) tgtSheets[name][':colWidths'] = sheet[':colWidths'];
    }
    editorRows = (tgtSheets.data?.data || []).filter((r) => rowKey(r) === 'editor.path');
    const merged = fromSheets(tgtSheets);
    const changed = JSON.stringify(toSheets(merged)) !== JSON.stringify(toSheets(tgtCfg));
    if (changed && !opts.dryRun) await postConfig(opts.target, merged);
    report.siteConfig = { changed, existedBefore: !!tgtCfg, sheets: Object.keys(tgtSheets) };
  }

  // 4. editor.path mappings in the target org config (additive only; never removes rows)
  if (opts.orgConfig && orgPaths.length) {
    try {
      const tgtOrgCfg = await getJson(`${DA}/config/${tOrg}/`);
      if (!tgtOrgCfg) {
        report.orgConfig = { changed: false, note: 'Target org has no DA config; mappings were added to the site config only.' };
      } else {
        const sheets = toSheets(tgtOrgCfg);
        const rows = sheets.data?.data || [];
        const missing = orgPaths.filter((p) => !rows.some((r) => rowKey(r) === 'editor.path' && rowVal(r) === rowVal(p)));
        if (missing.length && !opts.dryRun) {
          const shape = rows[0] ? Object.keys(rows[0]) : ['key', 'value'];
          const add = missing.map((p) => Object.fromEntries(shape.map((k) => [k, (/^key$/i.test(k) && rowKey(p)) || (/^value$/i.test(k) && rowVal(p)) || ''])));
          sheets.data = { ...(sheets.data || {}), data: [...rows, ...add] };
          await postConfig(tOrg, fromSheets(sheets));
        }
        report.orgConfig = { changed: missing.length > 0, added: missing.map(rowVal) };
      }
    } catch (e) {
      report.orgConfig = { changed: false, error: e.message, note: 'Mappings are in the site config; an org admin can add them to the org config.' };
    }
  }

  // 5. Edge Delivery custom headers (merged, source wins per header key)
  if (opts.edsHeaders) {
    try {
      const [sO, sS] = opts.source.split('/');
      const [tO, tS] = opts.target.split('/');
      const src = await getJson(`${HLX}/config/${sO}/sites/${sS}/headers.json`);
      if (src && Object.keys(src).length) {
        const tgtHeaders = (await getJson(`${HLX}/config/${tO}/sites/${tS}/headers.json`)) || {};
        const merged = { ...tgtHeaders };
        for (const [glob, list] of Object.entries(src)) {
          const cur = [...(merged[glob] || [])];
          for (const h of list) {
            const i = cur.findIndex((x) => x.key.toLowerCase() === h.key.toLowerCase());
            if (i >= 0) cur[i] = h; else cur.push(h);
          }
          merged[glob] = cur;
        }
        const changed = JSON.stringify(merged) !== JSON.stringify(tgtHeaders);
        if (changed && !opts.dryRun) {
          await req(`${HLX}/config/${tO}/sites/${tS}/headers.json`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(merged),
          });
        }
        report.edsHeaders = { changed, headers: merged };
      } else {
        report.edsHeaders = { changed: false, note: 'Source has no custom headers.' };
      }
    } catch (e) {
      report.edsHeaders = { changed: false, error: e.message, note: 'Needs site admin rights on the target Edge Delivery site.' };
    }
  }

  // 6. verify every copied file in the target
  if (!opts.dryRun) {
    const toCheck = results.filter((r) => r.body && ['created', 'updated', 'unchanged'].includes(r.status));
    const bad = [];
    await pool(toCheck, opts.concurrency, async (r) => {
      try {
        const got = await getSource(opts.target, r.rel);
        if (!sameContent(r.ext, got, r.body)) bad.push(r.rel);
      } catch (e) { bad.push(`${r.rel} (${e.message})`); }
    });
    report.verify = { checked: toCheck.length, mismatched: bad };
    log(`Verified ${toCheck.length} files, ${bad.length} mismatched.`);
  }

  // 7. preview pages, sheets and assets on Edge Delivery (default on; --no-preview skips)
  const paths = previewPaths(results);
  if (!opts.preview) {
    report.preview = { skipped: true, planned: paths.length };
  } else if (opts.dryRun) {
    report.preview = { planned: paths.length };
  } else {
    const { details, results: pr } = await previewAll(opts.target, paths, opts.concurrency, log);
    const out = 'migration-work/preview-publish/last-job.json';
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify({ details, results: pr }, null, 2));
    const ok = pr.filter((r) => r.status >= 200 && r.status < 300);
    const count = (re) => ok.filter((r) => re.test(r.path)).length;
    report.preview = {
      requested: paths.length,
      ok: ok.length,
      pages: ok.filter((r) => !/\.[a-z0-9]+$/i.test(r.path)).length,
      sheets: count(/\.json$/i),
      assets: ok.filter((r) => /\.[a-z0-9]+$/i.test(r.path) && !/\.json$/i.test(r.path)).length,
      failed: pr.filter((r) => !(r.status >= 200 && r.status < 300)),
      homePreviewed: ok.some((r) => r.path === '/'),
      jobFile: out,
    };
    log(`Previewed ${ok.length}/${paths.length} paths.`);
  }

  // 8. links for the user
  const [lOrg, lSite] = opts.target.split('/');
  report.links = {
    daSite: `https://da.live/#/${lOrg}/${lSite}`,
    editHome: editUrlFor(`/${lOrg}/${lSite}/index`, editorRows),
    previewHome: `https://main--${lSite}--${lOrg}.aem.page/`,
    liveHome: `https://main--${lSite}--${lOrg}.aem.live/`,
    homePreviewed: !!report.preview?.homePreviewed,
  };

  report.finishedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(opts.report), { recursive: true });
  fs.writeFileSync(opts.report, JSON.stringify(report, null, 2));
  log(JSON.stringify({ ...report, conflicts: report.conflicts.length }, null, 2));
  log('');
  log('=== Links ===');
  log(`Document Authoring site:  ${report.links.daSite}`);
  log(`Edit home page:           ${report.links.editHome}`);
  log(`Preview home page:        ${report.links.previewHome}${report.links.homePreviewed ? '' : '  (not previewed yet)'}`);
  log(`Live home page:           ${report.links.liveHome}  (not published by this script)`);
  const previewFailed = report.preview?.failed?.length;
  if (report.failures.length || report.verify?.mismatched.length || previewFailed) process.exitCode = 2;
}

export {
  makeRewriter, mergeRows, previewPath, previewPaths, editUrlFor,
};

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(`ERROR: ${e.message}`);
    process.exitCode = 1;
  });
}

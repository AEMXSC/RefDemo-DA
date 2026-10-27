import { DA_ADMIN_ORIGIN } from '../config.js';
import { putHtmlSource } from './daAdmin.js';

export const METADATA_FIELDS = ['Title', 'Description', 'Tags'];

export function normalizeTags(value) {
  return [...new Set(value.split(/[,\r\n]+/).map((tag) => tag.trim()).filter(Boolean))].join(', ');
}

function metadataRows(doc) {
  return [...doc.querySelectorAll('main .metadata > div')];
}

export function readMetadata(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const values = { Title: '', Description: '', Tags: '' };
  metadataRows(doc).forEach((row) => {
    const key = row.children[0]?.textContent.trim().toLowerCase();
    const field = METADATA_FIELDS.find((name) => name.toLowerCase() === key);
    if (field) values[field] = row.children[1]?.textContent.trim() || '';
  });
  values.Tags = normalizeTags(values.Tags);
  return values;
}

export function updateMetadata(html, changes) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const main = doc.querySelector('main');
  if (!main) throw new Error('The page does not contain a main content area.');
  let metadata = main.querySelector('.metadata');
  METADATA_FIELDS.filter((field) => Object.hasOwn(changes, field)).forEach((field) => {
    const value = field === 'Tags' ? normalizeTags(changes[field]) : changes[field].trim();
    const rows = metadataRows(doc)
      .filter((row) => row.children[0]?.textContent.trim().toLowerCase() === field.toLowerCase());
    // Clearing a property removes it rather than leaving an empty override.
    if (!value) {
      rows.forEach((row) => row.remove());
      return;
    }
    if (!metadata) {
      metadata = doc.createElement('div');
      metadata.className = 'metadata';
      const section = doc.createElement('div');
      section.append(metadata);
      main.append(section);
    }
    let row = rows[0];
    if (!row) {
      row = doc.createElement('div');
      const key = doc.createElement('div');
      key.textContent = field;
      row.append(key, doc.createElement('div'));
      metadata.append(row);
    }
    if (!row.children[1]) row.append(doc.createElement('div'));
    row.children[1].textContent = value;
    rows.slice(1).forEach((duplicate) => duplicate.remove());
  });
  return `${doc.doctype ? '<!DOCTYPE html>\n' : ''}${doc.documentElement.outerHTML}`;
}

export function metadataSourcePath(path) {
  if (typeof path !== 'string' || /[?#]/.test(path)) {
    throw new Error('The current page path is unavailable or invalid.');
  }
  const absolute = path.startsWith('/') ? path : `/${path}`;
  if (absolute.endsWith('.html')) return absolute;
  return `${absolute.endsWith('/') ? `${absolute}index` : absolute}.html`;
}

export async function loadMetadataSource(ctx) {
  const path = metadataSourcePath(ctx.path);
  const resp = await fetch(`${DA_ADMIN_ORIGIN}/source/${ctx.org}/${ctx.repo}${path}`, {
    headers: { Authorization: `Bearer ${ctx.token}` },
    cache: 'no-store',
  });
  if (!resp.ok) throw new Error(`Could not read page metadata (HTTP ${resp.status}).`);
  return { html: await resp.text(), etag: resp.headers.get('etag'), path };
}

export async function saveMetadata(ctx, changes) {
  if (typeof ctx.actions.saveDocument !== 'function') {
    throw new Error('This DA editor cannot save pending edits. Open the page in DA Canvas.');
  }
  const saved = await ctx.actions.saveDocument();
  if (!saved?.ok) {
    throw new Error(`Could not save pending page edits: ${saved?.error || 'unknown error'}. Metadata was not changed.`);
  }
  const source = await loadMetadataSource(ctx);
  // Refuse an unconditional full-document write if the server cannot guard it.
  if (!source.etag) throw new Error('DA did not return a page version. Metadata was not changed.');
  const html = updateMetadata(source.html, changes);
  await putHtmlSource({
    org: ctx.org, repo: ctx.repo, token: ctx.token, path: source.path, etag: source.etag, html,
  });
}

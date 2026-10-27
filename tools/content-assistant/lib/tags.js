/*
 * Tag taxonomy stored in the site's /config/tags sheet. Each row is one tag
 * ("Tag ID", "Title", "Path"); the hierarchy is rebuilt from path prefixes,
 * e.g. products/electronics/computers is the parent of
 * products/electronics/computers/laptops.
 */

import { getSource, putJsonSource } from './daAdmin.js';
import { TAGS_PATH } from '../config.js';

export const TAG_COLUMNS = ['Tag ID', 'Title', 'Path'];

const STARTER_TAGS = [
  ['products', 'Products', 'products'],
  ['electronics', 'Electronics', 'products/electronics'],
  ['computers', 'Computers', 'products/electronics/computers'],
  ['laptops', 'Laptops', 'products/electronics/computers/laptops'],
  ['gaming', 'Gaming Laptops', 'products/electronics/computers/laptops/gaming'],
  ['topics', 'Topics', 'topics'],
  ['news', 'News', 'topics/news'],
].map((values) => Object.fromEntries(TAG_COLUMNS.map((column, i) => [column, values[i]])));

export function starterTagsSheet() {
  return {
    ':type': 'sheet',
    total: STARTER_TAGS.length,
    limit: STARTER_TAGS.length,
    offset: 0,
    data: STARTER_TAGS.map((row) => ({ ...row })),
    columns: TAG_COLUMNS,
  };
}

function sheetRows(sheet) {
  if (sheet?.[':type'] === 'multi-sheet') {
    const names = sheet[':names'] || [];
    const name = names.includes('tags') ? 'tags' : names[0];
    return sheet[name]?.data || [];
  }
  return sheet?.data || [];
}

function cell(row, column) {
  const wanted = column.replace(/[\s_-]/g, '').toLowerCase();
  const key = Object.keys(row || {}).find((name) => name.replace(/[\s_-]/g, '').toLowerCase() === wanted);
  return key ? String(row[key] ?? '').trim() : '';
}

const cleanPath = (value) => value.split('/').map((part) => part.trim()).filter(Boolean).join('/');

/** Build a flat, sorted tag list with titled breadcrumbs from sheet rows. */
export function parseTags(sheet) {
  const byPath = new Map();
  sheetRows(sheet).forEach((row) => {
    const path = cleanPath(cell(row, 'path') || cell(row, 'tagid') || cell(row, 'id'));
    if (!path || byPath.has(path)) return;
    const id = cell(row, 'tagid') || cell(row, 'id') || path.split('/').pop();
    byPath.set(path, { id, path, title: cell(row, 'title') || path.split('/').pop() });
  });
  const tags = [...byPath.values()].map((tag) => {
    const segments = tag.path.split('/');
    const trail = segments.map((_, i) => {
      const ancestor = segments.slice(0, i + 1).join('/');
      return byPath.get(ancestor)?.title || segments[i];
    });
    return {
      ...tag,
      parent: segments.length > 1 ? segments.slice(0, -1).join('/') : '',
      depth: segments.length - 1,
      breadcrumb: trail.join(' › '),
      label: `${tag.title} (${tag.path})`,
    };
  });
  return tags.sort((a, b) => a.path.localeCompare(b.path));
}

/** Resolve a stored metadata tag value (path, tag ID or title) to a taxonomy tag. */
export function findTag(tags, value) {
  const wanted = String(value || '').trim();
  const lower = wanted.toLowerCase();
  return tags.find((tag) => tag.path === cleanPath(wanted))
    || tags.find((tag) => tag.label === wanted)
    || tags.find((tag) => tag.id.toLowerCase() === lower)
    || tags.find((tag) => tag.title.toLowerCase() === lower);
}

/**
 * Read /config/tags.json. When the sheet does not exist yet, create it with
 * the Tag ID / Title / Path columns and a few starter rows to edit in DA.
 */
export async function loadTags({ org, repo, token }) {
  const sheet = await getSource({
    org, repo, token, path: TAGS_PATH,
  });
  if (sheet) return { tags: parseTags(sheet), created: false };
  const starter = starterTagsSheet();
  await putJsonSource({
    org, repo, token, path: TAGS_PATH, json: starter,
  });
  return { tags: parseTags(starter), created: true };
}

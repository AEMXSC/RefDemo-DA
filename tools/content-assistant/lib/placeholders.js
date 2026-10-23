/*
 * placeholders — read/upsert single key/value rows in the site's
 * /config/placeholders.json sheet (the same file tools/task-management reads
 * for "external-service-url" etc.) via DA's Source API. Used by the Theme
 * tab's brand-theme browser to record which /assets/themes/... structured
 * content the site should use, under the "theme" key.
 */

import { getSource, putJsonSource } from './daAdmin.js';
import { ASSETS_FOLDER, PLACEHOLDERS_PATH } from '../config.js';

export async function fetchImageSettings({ org, repo, token }) {
  const sheet = await getSource({
    org, repo, token, path: PLACEHOLDERS_PATH,
  });
  const rows = sheet?.[':type'] === 'multi-sheet'
    ? (sheet[':names'] || []).flatMap((name) => sheet[name]?.data || [])
    : sheet?.data || [];
  const pathsFor = (key) => rows
    .filter((row) => (row.key || row.Key) === key)
    .flatMap((row) => String(row.value ?? row.Text ?? '').split(/[,\r\n]+/))
    .map((path) => path.trim())
    .filter(Boolean)
    .map((path) => {
      if (!path.startsWith('/') || /[?#\\]|\/{2}|(?:^|\/)\.\.?(?:\/|$)/.test(path)) {
        throw new Error(`Invalid "${key}" folder: ${path}. Use site-relative absolute paths.`);
      }
      return path.replace(/\/+$/, '') || '/';
    });
  const daImageRoots = [...new Set(pathsFor('da-image-roots'))];
  const damImportFolders = pathsFor('aem-import-folder');
  if (damImportFolders.length > 1
    || damImportFolders.some((path) => path !== '/content/dam' && !path.startsWith('/content/dam/'))) {
    throw new Error('"aem-import-folder" must be a single path within /content/dam.');
  }
  return {
    daImageRoots: daImageRoots.length ? daImageRoots : [ASSETS_FOLDER],
    damFolderPath: damImportFolders[0] || '/content/dam/imported-assets/en',
  };
}

function emptySheet() {
  return {
    ':type': 'sheet', total: 0, limit: 0, offset: 0, data: [], columns: ['key', 'value'],
  };
}

/** Upsert a single key/value row, leaving every other row untouched. */
export async function setPlaceholder({
  org, repo, token, key, value,
}) {
  const existing = await getSource({
    org, repo, token, path: PLACEHOLDERS_PATH,
  }).catch(() => null);
  const sheet = existing || emptySheet();
  const rows = Array.isArray(sheet.data) ? sheet.data : [];
  const idx = rows.findIndex((row) => row && row.key === key);
  if (idx === -1) rows.push({ key, value });
  else rows[idx] = { ...rows[idx], value };

  sheet.data = rows;
  sheet.total = rows.length;
  sheet.limit = rows.length;
  sheet.columns = sheet.columns || ['key', 'value'];
  sheet[':type'] = sheet[':type'] || 'sheet';

  await putJsonSource({
    org, repo, token, path: PLACEHOLDERS_PATH, json: sheet,
  });
}

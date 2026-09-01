/*
 * assetsCatalog — appends metadata for each image imported into
 * ASSETS_FOLDER to a DA sheet (/config/assets-catalog, tab "data"), matching
 * the id/url/thumbnail/label/tags/width/height/brand/path schema of that
 * sheet. Read-modify-write via DA's Source API (lib/daAdmin.js) — same
 * pattern as lib/theme.js's saved-theme sheets, just multi-sheet shaped
 * (":type": "multi-sheet") instead of single-sheet, to match the sheet's
 * existing tab structure.
 */

import { getSource, putJsonSource } from './daAdmin.js';
import { CATALOG_PATH, CATALOG_SHEET_NAME } from '../config.js';

const COLUMNS = ['id', 'url', 'thumbnail', 'label', 'tags', 'width', 'height', 'brand', 'path'];

function emptyWorkbook() {
  return {
    ':names': [CATALOG_SHEET_NAME],
    ':type': 'multi-sheet',
    [CATALOG_SHEET_NAME]: {
      total: 0, limit: 0, offset: 0, data: [],
    },
  };
}

function normalizeRow(row) {
  const out = {};
  COLUMNS.forEach((col) => { out[col] = row[col] != null ? String(row[col]) : ''; });
  return out;
}

/** Append one or more rows to the shared assets catalog sheet. */
export async function appendCatalogRows({
  org, repo, token, rows,
}) {
  const entries = (rows || []).filter(Boolean);
  if (!entries.length) return;

  const existing = await getSource({
    org, repo, token, path: CATALOG_PATH,
  }).catch(() => null);
  const workbook = (existing && existing[CATALOG_SHEET_NAME]) ? existing : emptyWorkbook();
  const sheet = workbook[CATALOG_SHEET_NAME];

  sheet.data = [...(sheet.data || []), ...entries.map(normalizeRow)];
  sheet.total = sheet.data.length;
  sheet.limit = sheet.total;
  workbook[':names'] = [CATALOG_SHEET_NAME];
  workbook[':type'] = 'multi-sheet';

  await putJsonSource({
    org, repo, token, path: CATALOG_PATH, json: workbook,
  });
}

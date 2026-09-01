/*
 * assetsCatalog — appends metadata for each image imported into
 * ASSETS_FOLDER to a DA sheet (/config/assets-catalog, tab "data"), matching
 * the id/url/thumb/label/tags/path/brand schema of that sheet. Read-modify-write
 * via DA's Source API (lib/daAdmin.js) — same
 * pattern as lib/theme.js's saved-theme sheets, just multi-sheet shaped
 * (":type": "multi-sheet") instead of single-sheet, to match the sheet's
 * existing tab structure.
 */

import { getSource, putJsonSource } from './daAdmin.js';
import { CATALOG_PATH, CATALOG_SHEET_NAME } from '../config.js';

const COLUMNS = ['id', 'url', 'thumb', 'label', 'tags', 'path', 'brand'];

function emptyWorkbook() {
  return {
    ':names': [CATALOG_SHEET_NAME],
    ':type': 'multi-sheet',
    [CATALOG_SHEET_NAME]: {
      total: 0, limit: 0, offset: 0, data: [], columns: COLUMNS,
    },
  };
}

function normalizeRow(row) {
  const out = {};
  COLUMNS.forEach((col) => { out[col] = row[col] != null ? String(row[col]) : ''; });
  return out;
}

// The sheet's own header lives in `data[0]` as a literal row (column name ->
// column name), not just in the `columns` field — some da.live sheet
// renders derive the header from that first row. Must survive every write,
// including a fallback to emptyWorkbook() when getSource() failed to return
// the real sheet.
function headerRow() {
  const out = {};
  COLUMNS.forEach((col) => { out[col] = col; });
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

  const priorData = sheet.data || [];
  // Retain the header row irrespective of what came back from getSource —
  // insert it if the sheet didn't have one yet (e.g. a fresh/fallback sheet).
  const withHeader = priorData.length && priorData[0].id === 'id' ? priorData : [headerRow(), ...priorData];
  sheet.data = [...withHeader, ...entries.map(normalizeRow)];
  sheet.total = sheet.data.length;
  sheet.limit = sheet.total;
  // Always present, even when appending to a sheet an earlier bug wrote
  // without one — a sheet with no `columns` renders with no header row.
  sheet.columns = COLUMNS;
  workbook[':names'] = [CATALOG_SHEET_NAME];
  workbook[':type'] = 'multi-sheet';

  await putJsonSource({
    org, repo, token, path: CATALOG_PATH, json: workbook,
  });
}

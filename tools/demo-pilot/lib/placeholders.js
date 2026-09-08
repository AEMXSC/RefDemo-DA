/*
 * placeholders — read/upsert single key/value rows in the site's
 * /config/placeholders.json sheet (the same file tools/invoke-service reads
 * for "external-service-url" etc.) via DA's Source API. Used by the Theme
 * tab's brand-theme browser to record which /assets/themes/... structured
 * content the site should use, under the "theme" key.
 */

import { getSource, putJsonSource } from './daAdmin.js';
import { PLACEHOLDERS_PATH } from '../config.js';

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

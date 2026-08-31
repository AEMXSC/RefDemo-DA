/*
 * aemConfig — read the AEM Assets integration settings a DA site already
 * carries in its own DA config (per docs.da.live/administrators/guides/
 * setup-aem-assets — the same `aem.repositoryId` key DA's native asset
 * picker relies on, plus a project-specific `imsorg` key for the IMS
 * Organization ID). Lets authorUrl/orgId be derived automatically instead of
 * hardcoded per deployment.
 *
 * DA's Config API returns either a single-sheet ({ data: [...] }) or a
 * multi-sheet ({ ':names': [...], <name>: { data: [...] } }) document, and
 * key/value column names have varied ('key'/'value' vs 'Key'/'Text' — see
 * lib/placeholders-equivalent usage elsewhere) — this reads defensively
 * across both shapes rather than assuming one.
 */

import { DA_ADMIN_ORIGIN } from '../config.js';

function rowsFromConfig(json) {
  if (!json || typeof json !== 'object') return [];
  if (json[':type'] === 'multi-sheet' && Array.isArray(json[':names'])) {
    return json[':names'].flatMap((name) => {
      const sheet = json[name];
      return (sheet && Array.isArray(sheet.data)) ? sheet.data : [];
    });
  }
  return Array.isArray(json.data) ? json.data : [];
}

function rowValue(row, keyNames) {
  for (const k of keyNames) {
    if (row && typeof row[k] === 'string' && row[k]) return row[k];
  }
  return '';
}

/** Fetch the site's whole DA config once, parsed into a flat { key: value } map. */
async function fetchDaConfigRows({ org, repo, token }) {
  const url = `${DA_ADMIN_ORIGIN}/config/${org}/${repo}`;
  try {
    const resp = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!resp.ok) return {};
    const json = await resp.json().catch(() => null);
    const out = {};
    for (const row of rowsFromConfig(json)) {
      const rowKey = rowValue(row, ['key', 'Key']);
      if (!rowKey) continue;
      out[rowKey] = rowValue(row, ['value', 'Text']);
    }
    return out;
  } catch (_) {
    return {};
  }
}

/** `author-p123-e456.adobeaemcloud.com` (or a full URL) -> `https://...`. */
export function authorUrlFromRepositoryId(repositoryId) {
  if (!repositoryId) return '';
  return repositoryId.startsWith('http') ? repositoryId : `https://${repositoryId}`;
}

/**
 * Fetch the DA site config once and pull out both AEM Assets integration
 * values: `aem.repositoryId` (-> authorUrl) and `imsorg` (-> the IMS
 * Organization ID for the x-gw-ims-org-id header). Both are '' when absent.
 */
export async function fetchAemConfig({ org, repo, token }) {
  const rows = await fetchDaConfigRows({ org, repo, token });
  return {
    authorUrl: authorUrlFromRepositoryId(rows['aem.repositoryId'] || ''),
    imsOrgId: rows.imsorg || '',
  };
}

import { DA_ADMIN_ORIGIN } from '../config.js';

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
  return { html: await resp.text() };
}

export function metadataTableHtml(html, changes) {
  const updated = new DOMParser().parseFromString(updateMetadata(html, changes), 'text/html');
  const metadata = updated.querySelector('main .metadata');
  const table = updated.createElement('table');
  const heading = table.insertRow().insertCell();
  heading.colSpan = 2;
  heading.textContent = 'Metadata';
  [...(metadata?.children || [])].forEach((row) => {
    const cells = table.insertRow();
    [...row.children].forEach((cell) => {
      cells.insertCell().innerHTML = cell.innerHTML;
    });
  });
  return table.outerHTML;
}

export async function saveMetadata(ctx, changes, snapshot) {
  if (!snapshot || snapshot.editable === false) {
    throw new Error('The live page is not editable. Open Content mode and try again.');
  }
  const { actions } = ctx;
  if (!actions.sendHTML || !actions.getSelection || !actions.subscribeLiveDocument
    || !actions.saveDocument) {
    throw new Error('This DA editor does not support live metadata editing. Open the page in DA Canvas.');
  }
  const existing = new DOMParser().parseFromString(snapshot.html, 'text/html')
    .querySelector('main .metadata');
  let selection = '';
  try {
    selection = await actions.getSelection();
  } catch (error) {
    // DA returns this specific response for a collapsed insertion cursor.
    if (error !== 'No selection found') {
      throw new Error(`Could not check the editor selection: ${error.message || error}`);
    }
  }
  if (existing) {
    const selected = new DOMParser().parseFromString(selection, 'text/html');
    const tables = selected.body.querySelectorAll('table');
    if (tables.length !== 1 || selected.body.children.length !== 1
      || tables[0].rows[0]?.cells[0]?.textContent.trim().toLowerCase() !== 'metadata'
      || tables[0].outerHTML !== selected.body.firstElementChild.outerHTML) {
      throw new Error('Select the entire Metadata table using its table selection handle, then click Save metadata.');
    }
  } else if (selection.trim()) {
    throw new Error('Place the cursor on an empty line at the bottom of the page, without selecting content, then click Save metadata.');
  }

  const updated = updateMetadata(snapshot.html, changes);
  const expected = readMetadata(updated);
  const table = metadataTableHtml(snapshot.html, changes);
  // Insertion has no SDK acknowledgement. Require a live-document echo before
  // reporting success, rather than treating postMessage delivery as a save.
  const confirmedHtml = await new Promise((resolve, reject) => {
    let unsubscribe;
    let timer;
    const finish = (error, html) => {
      clearTimeout(timer);
      unsubscribe?.();
      if (error) reject(error);
      else resolve(html);
    };
    timer = setTimeout(() => finish(new Error('DA did not confirm the metadata update. Check the page before retrying.')), 8000);
    unsubscribe = actions.subscribeLiveDocument((live) => {
      if (live.html === snapshot.html) return;
      const actual = readMetadata(live.html);
      const hasTable = new DOMParser().parseFromString(live.html, 'text/html').querySelector('main .metadata');
      if (hasTable && METADATA_FIELDS.every((field) => actual[field] === expected[field])) {
        finish(null, live.html);
      }
    });
    Promise.resolve().then(() => actions.sendHTML(table, existing ? { replace: true } : {}))
      .then((result) => {
        if (existing && !result?.ok) finish(new Error(result?.message || result?.error || 'DA rejected the metadata update.'));
        else if (existing && result?.html) {
          const actual = readMetadata(result.html);
          if (METADATA_FIELDS.every((field) => actual[field] === expected[field])) {
            finish(null, result.html);
          }
        }
      })
      .catch(finish);
  });
  const saved = await actions.saveDocument();
  if (!saved?.ok) {
    throw new Error(`Metadata is in the editor, but saving failed: ${saved?.error || 'unknown error'}. Keep the page open and retry saving.`);
  }
  return confirmedHtml;
}

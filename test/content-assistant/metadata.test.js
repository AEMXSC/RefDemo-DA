import {
  metadataSourcePath, metadataTableHtml, normalizeTags, readMetadata, updateMetadata, saveMetadata,
} from '../../tools/content-assistant/lib/metadata.js';
import renderMetadataTab from '../../tools/content-assistant/tabs/metadataTab.js';

const results = [];
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const test = async (name, run) => {
  try {
    await run();
    results.push(`PASS ${name}`);
  } catch (error) {
    results.push(`FAIL ${name}: ${error.message}`);
  }
};
const parse = (html) => new DOMParser().parseFromString(html, 'text/html');
const empty = '<body><main><div><h1>Page content</h1><p></p></div></main></body>';
const existing = `<body><main><div><h1>Original</h1><div class="metadata">
  <div><div>tItLe</div><div>Existing title</div></div>
  <div><div>Tags</div><div>sample, hello</div></div>
  <div><div>alpha</div><div><a href="/beta">beta</a></div></div>
</div></div></main></body>`;
const fixture = document.querySelector('#fixture');
const tick = () => new Promise((resolve) => { setTimeout(resolve, 0); });
const waitReady = async () => {
  const deadline = Date.now() + 3000;
  while (fixture.querySelector('[role=status]').textContent === 'Loading metadata...') {
    if (Date.now() > deadline) throw new Error('Metadata loading did not finish.');
    // eslint-disable-next-line no-await-in-loop
    await tick();
  }
};
const rejects = async (run, message) => {
  let error;
  try { await run(); } catch (caught) { error = caught; }
  assert(error?.message.includes(message), `Expected "${message}", got "${error?.message}"`);
};

await test('No metadata shows three empty properties', () => {
  assert(JSON.stringify(readMetadata(empty)) === JSON.stringify({ Title: '', Description: '', Tags: '' }), 'unexpected values');
});
await test('Reads existing metadata case-insensitively', () => {
  assert(readMetadata(existing).Title === 'Existing title', 'title missing');
});
await test('Adds missing rows and preserves unrelated metadata', () => {
  const doc = parse(updateMetadata(existing, { Description: 'Added' }));
  assert(doc.querySelector('.metadata a').outerHTML === '<a href="/beta">beta</a>', 'unknown field changed');
  assert(readMetadata(doc.body.outerHTML).Title === 'Existing title', 'untouched title changed');
});
await test('Tags accept commas and new lines and deduplicate', () => {
  assert(normalizeTags('sample,hello\nsample\r\n world,') === 'sample, hello, world', 'wrong tags');
});
await test('Clearing a field removes only its row', () => {
  const doc = parse(updateMetadata(existing, { Title: '', Tags: '' }));
  assert(doc.querySelectorAll('.metadata > div').length === 1, 'wrong remaining rows');
});
await test('Native insertion HTML is a two-column Metadata table, not EDS divs', () => {
  const doc = parse(metadataTableHtml(empty, { Title: 'New', Tags: 'a,b' }));
  const table = doc.querySelector('table');
  assert(table.rows[0].cells[0].textContent === 'Metadata', 'wrong header');
  assert(table.rows[0].cells[0].colSpan === 2, 'header not merged');
  assert(table.rows.length === 3 && table.rows[1].cells[1].textContent === 'New', 'missing rows');
});
await test('Native table retains unknown metadata rows and markup', () => {
  const doc = parse(metadataTableHtml(existing, { Description: 'Added' }));
  assert(doc.querySelector('table a').getAttribute('href') === '/beta', 'lost unknown data');
});
await test('User input is escaped, not treated as HTML', () => {
  assert(!parse(metadataTableHtml(empty, { Title: '<img src=x onerror=alert(1)>' })).querySelector('img'), 'HTML injection');
});
await test('Source paths support root, nested and already suffixed documents', () => {
  assert(metadataSourcePath('/') === '/index.html', 'root');
  assert(metadataSourcePath('/a/b') === '/a/b.html', 'nested');
  assert(metadataSourcePath('/a.html') === '/a.html', 'extension');
});

// Model the SDK/editor boundary: only sendHTML changes the live document.
// Live snapshots omit metadata, just like DA's prose2aem live serializer.
let live;
let selection;
let sends;
let saved;
let flushResult;
let replacementResult;
let listeners;
let unsubscribed;
const stripped = () => {
  const doc = parse(live.html);
  doc.querySelectorAll('.metadata').forEach((node) => node.remove());
  return { ...live, html: doc.body.outerHTML };
};
const realFetch = window.fetch;
const ctx = {
  org: 'test-org',
  repo: 'test-site',
  path: '/test',
  token: 'test-token',
  actions: {
    getSelection: async () => {
      if (!selection) throw 'No selection found'; // eslint-disable-line no-throw-literal
      return selection;
    },
    sendHTML: async (html, options) => {
      sends.push({ html, options });
      if (options.replace && !replacementResult.ok) return replacementResult;
      const doc = parse(live.html);
      const table = parse(html).querySelector('table');
      const block = doc.createElement('div');
      block.className = 'metadata';
      [...table.rows].slice(1).forEach((row) => {
        const entry = doc.createElement('div');
        [...row.cells].forEach((cell) => {
          const value = doc.createElement('div');
          value.innerHTML = cell.innerHTML;
          entry.append(value);
        });
        block.append(entry);
      });
      const old = doc.querySelector('.metadata');
      if (old) old.replaceWith(block);
      else doc.querySelector('main > div:last-child').append(block);
      live = { ...live, html: doc.body.outerHTML };
      setTimeout(() => [...listeners].forEach((callback) => callback(stripped())), 0);
      return options.replace ? { ok: true, html: stripped().html } : undefined;
    },
    saveDocument: async () => {
      if (flushResult.ok || sends.length === 0) {
        saved = live.html;
        return { ok: true };
      }
      return flushResult;
    },
    subscribeLiveDocument: (callback) => {
      listeners.add(callback);
      callback(stripped());
      return () => { unsubscribed += 1; listeners.delete(callback); };
    },
  },
};
function reset(html = empty) {
  fixture.metadataCleanup?.();
  fixture.innerHTML = '';
  delete fixture.dataset.dpBuilt;
  delete fixture.metadataCleanup;
  live = { html, editable: true };
  selection = '';
  sends = [];
  saved = '';
  flushResult = { ok: true };
  replacementResult = { ok: true };
  listeners = new Set();
  unsubscribed = 0;
}
window.fetch = async (url, options = {}) => {
  assert(!options.method || options.method === 'GET', 'Unexpected Source API write');
  return new Response(saved || live.html, { status: 200 });
};
const input = (field, value) => {
  const element = fixture.querySelector(`[name="${field}"]`);
  element.value = value;
  element.dispatchEvent(new Event('input', { bubbles: true }));
};
const submit = async () => {
  fixture.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  const deadline = Date.now() + 3000;
  while (fixture.querySelector('[role=status]').textContent === 'Saving metadata...') {
    if (Date.now() > deadline) throw new Error('Save did not finish.');
    // eslint-disable-next-line no-await-in-loop
    await tick();
  }
};
try {
  await test('Insertion updates the live editor and persists via SDK save', async () => {
    reset();
    await saveMetadata(ctx, { Title: 'Live title' }, live);
    assert(sends.length === 1 && !sends[0].options.replace, 'not native insertion');
    assert(readMetadata(live.html).Title === 'Live title', 'editor not changed');
    assert(readMetadata(saved).Title === 'Live title', 'not persisted');
    assert(listeners.size === 0, 'confirmation listener leaked');
  });
  await test('Selected metadata table is replaced, never duplicated', async () => {
    reset(existing);
    selection = metadataTableHtml(existing, {});
    await saveMetadata(ctx, { Description: 'Added' }, live);
    assert(sends[0].options.replace === true, 'not replacement');
    assert(parse(saved).querySelectorAll('.metadata').length === 1, 'duplicate');
    assert(readMetadata(saved).Title === 'Existing title', 'title lost');
    assert(readMetadata(saved).Description === 'Added', 'new field missing');
  });
  await test('Missing metadata selection refuses to replace other content', async () => {
    reset(existing);
    await rejects(() => saveMetadata(ctx, { Title: 'Bad' }, stripped()), 'Select the entire Metadata table');
    assert(sends.length === 0, 'unsafe replacement');
  });
  await test('Retry after insertion cannot insert a duplicate table', async () => {
    reset();
    await saveMetadata(ctx, { Title: 'One' }, stripped());
    await rejects(() => saveMetadata(ctx, { Title: 'Two' }, stripped()), 'Select the entire Metadata table');
    assert(sends.length === 1 && parse(live.html).querySelectorAll('.metadata').length === 1, 'duplicate inserted');
  });
  await test('Raw Metadata tables in source prefill fields too', () => {
    const table = metadataTableHtml(existing, {});
    const values = readMetadata(`<body><main><div>${table}</div></main></body>`);
    assert(values.Title === 'Existing title' && values.Tags === 'sample, hello', 'raw table not recognized');
  });
  await test('Pre-existing duplicate tables block updates without inserting anything', async () => {
    const doc = parse(existing);
    doc.querySelector('main > div').append(doc.querySelector('.metadata').cloneNode(true));
    reset(doc.body.outerHTML);
    await rejects(() => saveMetadata(ctx, { Title: 'Bad' }, stripped()), 'multiple Metadata tables');
    assert(sends.length === 0, 'modified ambiguous metadata');
  });
  await test('Unrelated selected table is never replaced', async () => {
    reset(existing);
    selection = '<table><tr><th>Cards</th></tr><tr><td>Keep me</td></tr></table>';
    await rejects(() => saveMetadata(ctx, { Title: 'Bad' }, live), 'Select the entire Metadata table');
    assert(sends.length === 0, 'wrong table replaced');
  });
  await test('Insertion refuses to overwrite a text selection', async () => {
    reset();
    selection = '<p>Keep this content</p>';
    await rejects(() => saveMetadata(ctx, { Title: 'Bad' }, live), 'without selecting content');
    assert(sends.length === 0, 'selection overwritten');
  });
  await test('Read-only or missing live document refuses writes', async () => {
    reset();
    await rejects(() => saveMetadata(ctx, { Title: 'Bad' }, { ...live, editable: false }), 'not editable');
    await rejects(() => saveMetadata(ctx, { Title: 'Bad' }), 'not editable');
    assert(sends.length === 0, 'read-only write');
  });
  await test('Rejected SDK replacement surfaces error', async () => {
    reset(existing);
    selection = metadataTableHtml(existing, {});
    replacementResult = { ok: false, error: 'unsupported' };
    await rejects(() => saveMetadata(ctx, { Title: 'Bad' }, live), 'unsupported');
    assert(readMetadata(saved).Title === 'Existing title', 'rejected edit persisted');
  });
  await test('Persistence failure says metadata is only in the editor', async () => {
    reset();
    flushResult = { ok: false, error: 'disconnected' };
    await rejects(() => saveMetadata(ctx, { Title: 'New' }, live), 'saving failed');
    assert(readMetadata(live.html).Title === 'New' && !readMetadata(saved).Title, 'incorrect save state');
  });
  await test('Unacknowledged insertion never reports success or saves a stale page', async () => {
    reset();
    const originalSend = ctx.actions.sendHTML;
    ctx.actions.sendHTML = () => undefined;
    try {
      await rejects(() => saveMetadata(ctx, { Title: 'Not inserted' }, live), 'did not persist');
      assert(!readMetadata(saved).Title && listeners.size === 0, 'false success or listener leaked');
    } finally {
      ctx.actions.sendHTML = originalSend;
    }
  });
  await test('Empty sidebar fields still display when no table exists', async () => {
    reset();
    renderMetadataTab(fixture, ctx);
    await waitReady();
    assert(fixture.querySelectorAll('input,textarea').length === 3, 'missing properties');
    assert([...fixture.querySelectorAll('input,textarea')].every((field) => !field.value), 'unexpected field values');
  });
  await test('Sidebar saves and prefills on reopen despite metadata-free live snapshots', async () => {
    reset();
    renderMetadataTab(fixture, ctx);
    await waitReady();
    input('Title', 'Voting Tonight');
    input('Description', '10 states will be voting');
    input('Tags', 'usa,election,2026');
    await submit();
    assert(fixture.querySelector('[role=status]').textContent === 'Metadata updated in the page and saved.', 'false success');
    assert(readMetadata(saved).Title === 'Voting Tonight', 'lost title');
    fixture.metadataCleanup();
    delete fixture.dataset.dpBuilt;
    renderMetadataTab(fixture, ctx);
    await waitReady();
    assert(fixture.querySelector('[name=Title]').value === 'Voting Tonight', 'reopened metadata missing');
    assert(fixture.querySelector('[name=Tags]').value === 'usa, election, 2026', 'tags missing');
  });
  await test('Metadata-free live updates never clear source values or dirty drafts', async () => {
    reset(existing);
    renderMetadataTab(fixture, ctx);
    await waitReady();
    input('Title', 'Draft');
    live.html = updateMetadata(existing, { Title: 'Other', Description: 'New description' });
    [...listeners].forEach((callback) => callback(stripped()));
    assert(fixture.querySelector('[name=Title]').value === 'Draft', 'draft lost');
    assert(fixture.querySelector('[name=Tags]').value === 'sample, hello', 'source metadata cleared');
  });
  await test('Save failure retains drafts and enables retry', async () => {
    reset(existing);
    renderMetadataTab(fixture, ctx);
    await waitReady();
    input('Title', 'Keep me');
    await submit();
    assert(fixture.querySelector('[role=status]').classList.contains('dp-error'), 'error hidden');
    assert(fixture.querySelector('[name=Title]').value === 'Keep me', 'draft lost');
    assert(!fixture.querySelector('button').disabled, 'retry unavailable');
  });
  await test('Leaving tab releases the live document subscription', () => {
    reset();
    renderMetadataTab(fixture, ctx);
    fixture.metadataCleanup();
    assert(unsubscribed === 1, 'subscription leaked');
  });
} finally {
  window.fetch = realFetch;
  fixture.metadataCleanup?.();
}
document.querySelector('#results').textContent = results.join('\n');
document.body.dataset.testResult = results.some((line) => line.startsWith('FAIL')) ? 'failed' : 'passed';

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
// Source API reads are deliberately stale; writes are forbidden.
let live;
let selection;
let sends;
let saved;
let flushResult;
let replacementResult;
let listeners;
let unsubscribed;
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
      setTimeout(() => [...listeners].forEach((callback) => callback(live)), 0);
      return options.replace ? { ok: true, html: live.html } : undefined;
    },
    saveDocument: async () => {
      if (flushResult.ok) saved = live.html;
      return flushResult;
    },
    subscribeLiveDocument: (callback) => {
      listeners.add(callback);
      callback(live);
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
  return new Response(empty, { status: 200 });
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
    await rejects(() => saveMetadata(ctx, { Title: 'Bad' }, live), 'Select the entire Metadata table');
    assert(sends.length === 0, 'unsafe replacement');
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
    assert(!saved, 'failure reported saved');
  });
  await test('Persistence failure says metadata is only in the editor', async () => {
    reset();
    flushResult = { ok: false, error: 'disconnected' };
    await rejects(() => saveMetadata(ctx, { Title: 'New' }, live), 'saving failed');
    assert(readMetadata(live.html).Title === 'New' && !saved, 'incorrect save state');
  });
  await test('Unacknowledged insertion never reports success or saves a stale page', async () => {
    reset();
    const originalSend = ctx.actions.sendHTML;
    const originalTimer = window.setTimeout;
    ctx.actions.sendHTML = () => undefined;
    window.setTimeout = (callback, delay, ...args) => {
      const duration = delay === 8000 ? 10 : delay;
      return originalTimer(callback, duration, ...args);
    };
    try {
      await rejects(() => saveMetadata(ctx, { Title: 'Not inserted' }, live), 'did not confirm');
      assert(!saved && listeners.size === 0, 'unconfirmed update saved or listener leaked');
    } finally {
      ctx.actions.sendHTML = originalSend;
      window.setTimeout = originalTimer;
    }
  });
  await test('Empty sidebar fields still display when no table exists', async () => {
    reset();
    renderMetadataTab(fixture, ctx);
    await tick();
    assert(fixture.querySelectorAll('input,textarea').length === 3, 'missing properties');
    assert([...fixture.querySelectorAll('input,textarea')].every((field) => !field.value), 'unexpected field values');
  });
  await test('Sidebar save uses live editor, not stale source, and survives reopen', async () => {
    reset();
    renderMetadataTab(fixture, ctx);
    input('Title', 'Voting Tonight');
    input('Description', '10 states will be voting');
    input('Tags', 'usa,election,2026');
    await submit();
    assert(fixture.querySelector('[role=status]').textContent === 'Metadata updated in the page and saved.', 'false success');
    assert(readMetadata(saved).Title === 'Voting Tonight', 'lost title');
    fixture.metadataCleanup();
    delete fixture.dataset.dpBuilt;
    renderMetadataTab(fixture, ctx);
    await tick();
    assert(fixture.querySelector('[name=Title]').value === 'Voting Tonight', 'reopened metadata missing');
    assert(fixture.querySelector('[name=Tags]').value === 'usa, election, 2026', 'tags missing');
  });
  await test('Live updates preserve dirty drafts while refreshing clean fields', () => {
    reset(existing);
    renderMetadataTab(fixture, ctx);
    input('Title', 'Draft');
    live.html = updateMetadata(existing, { Title: 'Other', Description: 'New description' });
    [...listeners].forEach((callback) => callback(live));
    assert(fixture.querySelector('[name=Title]').value === 'Draft', 'draft lost');
    assert(fixture.querySelector('[name=Description]').value === 'New description', 'clean field stale');
  });
  await test('Save failure retains drafts and enables retry', async () => {
    reset(existing);
    renderMetadataTab(fixture, ctx);
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

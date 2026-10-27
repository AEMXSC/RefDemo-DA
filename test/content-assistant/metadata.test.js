import {
  metadataSourcePath, normalizeTags, readMetadata, updateMetadata, saveMetadata,
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
const empty = '<body><header></header><main><div><h1>Page content</h1></div></main><footer></footer></body>';
const existing = `<body><main><div><h1>Original</h1><div class="metadata">
  <div><div>tItLe</div><div>Existing title</div></div>
  <div><div>Tags</div><div>sample, hello</div></div>
  <div><div>alpha</div><div><a href="/beta">beta</a></div></div>
</div></div></main></body>`;
const fixture = document.querySelector('#fixture');
const tick = () => new Promise((resolve) => { setTimeout(resolve, 0); });

await test('Empty page always has three empty properties', () => {
  assert(JSON.stringify(readMetadata(empty)) === JSON.stringify({ Title: '', Description: '', Tags: '' }), 'unexpected empty values');
});
await test('Reads existing metadata case-insensitively', () => {
  assert(readMetadata(existing).Title === 'Existing title', 'title missing');
  assert(readMetadata(existing).Tags === 'sample, hello', 'tags missing');
});
await test('Creates one metadata block at the bottom, without replacing page content', () => {
  const doc = parse(updateMetadata(empty, { Title: 'New', Description: 'Description', Tags: 'a,b\nc' }));
  assert(doc.querySelectorAll('.metadata').length === 1, 'wrong block count');
  assert(doc.querySelector('main > div:last-child > .metadata'), 'not at bottom');
  assert(doc.querySelector('h1').textContent === 'Page content', 'body changed');
  assert(doc.querySelector('header') && doc.querySelector('footer'), 'page shell lost');
});
await test('Adds missing rows and preserves unrelated metadata and content', () => {
  const doc = parse(updateMetadata(existing, { Description: 'Added' }));
  assert(readMetadata(doc.documentElement.outerHTML).Title === 'Existing title', 'untouched title changed');
  assert(readMetadata(doc.documentElement.outerHTML).Description === 'Added', 'description missing');
  assert(doc.querySelector('.metadata a').outerHTML === '<a href="/beta">beta</a>', 'unknown field changed');
  assert(doc.querySelector('h1').textContent === 'Original', 'page content changed');
});
await test('Tags allow multiple values and deduplicate, preserving order', () => {
  assert(normalizeTags(' sample, hello\nsample\r\n world, ') === 'sample, hello, world', 'wrong tags');
});
await test('Clearing a field removes its row, not unrelated rows', () => {
  const html = updateMetadata(existing, { Title: '', Tags: '' });
  assert(readMetadata(html).Title === '' && readMetadata(html).Tags === '', 'fields not cleared');
  assert(parse(html).querySelectorAll('.metadata > div').length === 1, 'unknown row removed');
});
await test('Empty fields do not create an empty table', () => {
  assert(!parse(updateMetadata(empty, { Title: ' ', Tags: '' })).querySelector('.metadata'), 'empty table created');
});
await test('Values are text, not executable markup', () => {
  const doc = parse(updateMetadata(empty, { Title: '<img src=x onerror=alert(1)>', Description: 'A & B' }));
  assert(!doc.querySelector('img'), 'HTML injection');
  assert(readMetadata(doc.documentElement.outerHTML).Description === 'A & B', 'text changed');
});
await test('Repeated saves do not duplicate blocks or properties', () => {
  let html = updateMetadata(empty, { Title: 'One' });
  html = updateMetadata(html, { Title: 'Two' });
  assert(parse(html).querySelectorAll('.metadata > div').length === 1, 'duplicate title');
  assert(readMetadata(html).Title === 'Two', 'title not updated');
});
await test('Source paths support root, nested and already suffixed documents', () => {
  assert(metadataSourcePath('/') === '/index.html', 'root path');
  assert(metadataSourcePath('/blog/page') === '/blog/page.html', 'nested path');
  assert(metadataSourcePath('/blog/page.html') === '/blog/page.html', 'duplicate extension');
  assert(metadataSourcePath('page') === '/page.html', 'relative path');
});

const realFetch = window.fetch;
let stored;
let postCount;
let postStatus;
let getStatus;
let etag;
let listener;
let unsubscribed;
let flushResult;
let onFlush;
let requests;
const ctx = {
  org: 'test-org',
  repo: 'test-site',
  path: '/nested/page',
  token: 'test-token',
  actions: {
    saveDocument: async () => {
      onFlush?.();
      return flushResult;
    },
    subscribeLiveDocument: (callback) => {
      listener = callback;
      callback({ html: stored, editable: true });
      return () => { unsubscribed = true; listener = undefined; };
    },
  },
};
function reset(html = empty) {
  fixture.metadataCleanup?.();
  fixture.innerHTML = '';
  delete fixture.dataset.dpBuilt;
  delete fixture.metadataCleanup;
  stored = html;
  postCount = 0;
  postStatus = 201;
  getStatus = 200;
  etag = '"v1"';
  flushResult = { ok: true };
  onFlush = undefined;
  unsubscribed = false;
  requests = [];
}
window.fetch = async (url, options = {}) => {
  assert(url === 'https://admin.da.live/source/test-org/test-site/nested/page.html', 'wrong site or path');
  requests.push({ url, options });
  if (options.method === 'POST') {
    postCount += 1;
    if (postStatus !== 201) return new Response('Error', { status: postStatus });
    stored = await options.body.get('data').text();
    listener?.({ html: stored, editable: true });
    return new Response('{}', { status: 201 });
  }
  return new Response(stored, { status: getStatus, headers: etag ? { ETag: etag } : {} });
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
const rejects = async (run, message) => {
  let error;
  try { await run(); } catch (caught) { error = caught; }
  assert(error?.message.includes(message), `Expected error containing "${message}"`);
};

try {
  await test('Save flushes pending edits, reads fresh source and sends If-Match', async () => {
    reset(existing);
    onFlush = () => { stored = stored.replace('Original', 'Unsaved page edits'); };
    await saveMetadata(ctx, { Description: 'Updated' });
    assert(stored.includes('Unsaved page edits'), 'pending edits lost');
    assert(readMetadata(stored).Description === 'Updated', 'not saved');
    const post = requests.find(({ options }) => options.method === 'POST');
    assert(post.options.headers['If-Match'] === '"v1"', 'missing conditional write');
    assert(post.options.headers.Authorization === 'Bearer test-token', 'missing authentication');
  });
  await test('Failed editor save never writes source', async () => {
    reset();
    flushResult = { ok: false, error: 'read-only' };
    await rejects(() => saveMetadata(ctx, { Title: 'Bad' }), 'read-only');
    assert(postCount === 0, 'wrote despite flush failure');
  });
  await test('Conflict is surfaced without overwriting the page', async () => {
    reset();
    postStatus = 412;
    await rejects(() => saveMetadata(ctx, { Title: 'Bad' }), 'page changed');
    assert(stored === empty, 'conflicting source replaced');
  });
  await test('No ETag means no unconditional write', async () => {
    reset();
    etag = '';
    await rejects(() => saveMetadata(ctx, { Title: 'Bad' }), 'page version');
    assert(postCount === 0, 'unguarded write');
  });
  await test('Missing source is an error, never a new page', async () => {
    reset();
    getStatus = 404;
    await rejects(() => saveMetadata(ctx, { Title: 'Bad' }), '404');
    assert(postCount === 0, 'created missing page');
  });
  await test('Sidebar displays empty properties with no metadata block', async () => {
    reset();
    renderMetadataTab(fixture, ctx);
    await tick();
    assert(fixture.querySelectorAll('input,textarea').length === 3, 'missing properties');
    assert([...fixture.querySelectorAll('input,textarea')].every((field) => field.value === ''), 'nonempty field');
    assert(fixture.querySelector('button').disabled, 'enabled without changes');
  });
  await test('Sidebar edits missing description and preserves existing title', async () => {
    reset(existing);
    renderMetadataTab(fixture, ctx);
    await tick();
    input('Description', 'Sidebar description');
    await submit();
    assert(readMetadata(stored).Description === 'Sidebar description', 'description not saved');
    assert(readMetadata(stored).Title === 'Existing title', 'title lost');
    assert(fixture.querySelector('[role=status]').textContent === 'Metadata saved.', 'no success status');
  });
  await test('Live page changes update clean fields, not dirty drafts', async () => {
    reset(existing);
    renderMetadataTab(fixture, ctx);
    input('Title', 'My draft');
    listener({ html: updateMetadata(existing, { Title: 'Other title', Description: 'Other description' }), editable: true });
    assert(fixture.querySelector('[name=Title]').value === 'My draft', 'draft overwritten');
    assert(fixture.querySelector('[name=Description]').value === 'Other description', 'clean field stale');
  });
  await test('Read-only editor disables metadata controls and save', async () => {
    reset(existing);
    renderMetadataTab(fixture, ctx);
    listener({ html: stored, editable: false });
    assert([...fixture.querySelectorAll('input,textarea,button')].every((field) => field.disabled), 'read-only editable');
  });
  await test('Save error remains visible and keeps draft for retry', async () => {
    reset();
    renderMetadataTab(fixture, ctx);
    input('Title', 'Keep me');
    postStatus = 403;
    await submit();
    assert(fixture.querySelector('[role=status]').classList.contains('dp-error'), 'error hidden');
    assert(fixture.querySelector('[name=Title]').value === 'Keep me', 'draft lost');
    assert(!fixture.querySelector('button').disabled, 'cannot retry');
  });
  await test('Leaving Metadata unsubscribes from the live document', () => {
    reset();
    renderMetadataTab(fixture, ctx);
    fixture.metadataCleanup();
    assert(unsubscribed, 'subscription leaked');
  });
} finally {
  window.fetch = realFetch;
  fixture.metadataCleanup?.();
}
document.querySelector('#results').textContent = results.join('\n');
document.body.dataset.testResult = results.some((line) => line.startsWith('FAIL')) ? 'failed' : 'passed';

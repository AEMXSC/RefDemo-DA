import { generateImages, saveGeneratedImage } from '../../tools/content-assistant/lib/generateImages.js';
import openGenerateImageModal from '../../tools/content-assistant/lib/generateImageModal.js';
import renderImagesTab from '../../tools/content-assistant/tabs/imagesTab.js';
import { fetchImageSettings } from '../../tools/content-assistant/lib/placeholders.js';
import { FETCH_IMAGE_ACTION_URL } from '../../tools/content-assistant/config.js';

const results = [];
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const test = async (name, run) => {
  try {
    await run();
    results.push(`PASS ${name}`);
  } catch (error) {
    results.push(`FAIL ${name}: ${error.message}`);
  }
};
const tick = () => new Promise((resolve) => { setTimeout(resolve, 0); });
const waitFor = async (check) => {
  const deadline = Date.now() + 3000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for UI.');
    // eslint-disable-next-line no-await-in-loop
    await tick();
  }
};
const rejects = async (run, message) => {
  let error;
  try { await run(); } catch (caught) { error = caught; }
  assert(error?.message.includes(message), `Expected "${message}", got "${error?.message}"`);
};
const endpoint = 'https://generation.example.test/api/v1/web/universal-editor-ui-1/generate-image';
const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=';
const fixture = document.querySelector('#fixture');
const realFetch = window.fetch;
let calls;
let writes;
let listingCount;
let generationResponse;
let generationHttp;
let uploadFailures;
let proxyType;
let proxyFailure;
let holdGeneration;
let settings;
const ctx = {
  org: 'test-org',
  repo: 'test-repo',
  token: 'test-da-token',
  fireflyGenerateUrl: endpoint,
  state: { activeTab: 'images' },
  toast: () => {},
  rerender: () => renderImagesTab(fixture, ctx),
};
function reset() {
  document.querySelectorAll('dialog').forEach((dialog) => { dialog.close(); dialog.remove(); });
  fixture.innerHTML = '';
  delete fixture.dataset.dpBuilt;
  calls = [];
  writes = [];
  listingCount = 0;
  generationHttp = 200;
  generationResponse = {
    images: [1, 2, 3].map((id) => ({
      id: `img-${id}`, url: `https://images.example.test/${id}.png`,
    })),
  };
  uploadFailures = 0;
  proxyType = 'image/png';
  proxyFailure = false;
  holdGeneration = false;
  settings = { data: [{ key: 'firefly-generate-url', value: endpoint }] };
  ctx.state = { activeTab: 'images', imageAssetSource: 'da' };
  delete ctx.daImageRoots;
}
window.fetch = async (url, options = {}) => {
  const path = String(url);
  calls.push({ path, options });
  if (path === endpoint) {
    if (holdGeneration) {
      return new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      });
    }
    return new Response(JSON.stringify(generationResponse), { status: generationHttp });
  }
  if (path === FETCH_IMAGE_ACTION_URL) {
    return new Response(JSON.stringify(proxyFailure ? { error: 'Image download failed' }
      : { body: { contentType: proxyType, base64: pixel } }), { status: proxyFailure ? 502 : 200 });
  }
  if (path.endsWith('/config/placeholders.json')) {
    return new Response(JSON.stringify(settings));
  }
  if (path.includes('/list/test-org/test-repo/')) {
    listingCount += 1;
    return new Response(JSON.stringify(writes.map((entry) => ({
      name: entry.filename, ext: 'png', path: `/test-org/test-repo${entry.path}`,
    }))));
  }
  if (path.includes('/source/test-org/test-repo/assets/images/')) {
    if (options.method === 'POST') {
      if (uploadFailures) {
        uploadFailures -= 1;
        return new Response('Upload unavailable', { status: 503 });
      }
      assert(options.headers.Authorization === 'Bearer test-da-token', 'Missing DA auth');
      const file = options.body.get('data');
      writes.push({ path: path.split('/test-repo')[1], filename: file.name, type: file.type });
      return new Response('', { status: 201 });
    }
    return new Response(Uint8Array.from(atob(pixel), (c) => c.charCodeAt(0)), { headers: { 'Content-Type': 'image/png' } });
  }
  throw new Error(`Unexpected fetch ${path}`);
};
const submit = () => {
  const dialog = document.querySelector('dialog');
  dialog.querySelector('textarea').value = 'Mountain sunrise';
  dialog.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
};
const generated = () => document.querySelectorAll('.dp-generation-results input').length === 3;
const select = (index) => {
  const box = document.querySelectorAll('.dp-generation-results input')[index];
  box.checked = true;
  box.dispatchEvent(new Event('change'));
};
try {
  await test('Reads the existing deployed action URL from site placeholders', async () => {
    reset();
    const config = await fetchImageSettings(ctx);
    assert(config.fireflyGenerateUrl === endpoint, 'Endpoint not loaded');
    assert(config.daImageRoots[0] === '/assets/images', 'Default folder changed');
    settings = { data: [] };
    assert((await fetchImageSettings(ctx)).fireflyGenerateUrl === '', 'Missing setting should remain explicit');
  });
  await test('Reuses the Universal Editor POST contract without DA credentials', async () => {
    reset();
    const images = await generateImages({
      endpoint, prompt: ' Mountains ', width: 2688, height: 1512,
    });
    const request = calls[0];
    assert(request.options.method === 'POST', 'Not POST');
    assert(JSON.stringify(JSON.parse(request.options.body)) === JSON.stringify({
      prompt: 'Mountains', width: 2688, height: 1512,
    }), 'Wrong request');
    assert(!request.options.headers.Authorization, 'DA token leaked to generation endpoint');
    assert(images.length === 3, 'Wrong variation count');
  });
  await test('Supports two URL variations and Runtime body wrappers', async () => {
    reset();
    generationResponse = {
      body: JSON.stringify({
        images: [
          'https://images.example.test/a.png', 'https://images.example.test/b.png',
        ],
      }),
    };
    assert((await generateImages({ endpoint, prompt: 'Forest' })).length === 2, 'Wrapper not supported');
  });
  await test('Missing configuration and invalid prompts never make a generation call', async () => {
    reset();
    await rejects(() => generateImages({ endpoint: '', prompt: 'Forest' }), 'firefly-generate-url');
    await rejects(() => generateImages({ endpoint: 'http://example.test', prompt: 'Forest' }), 'HTTPS');
    await rejects(() => generateImages({ endpoint, prompt: ' ' }), 'prompt');
    assert(calls.length === 0, 'Invalid request sent');
  });
  await test('HTTP, service, invalid URLs and variation-count errors are explicit', async () => {
    reset();
    generationHttp = 500;
    await rejects(() => generateImages({ endpoint, prompt: 'Forest' }), 'HTTP 500');
    generationHttp = 200;
    generationResponse = { error: 'Prompt rejected' };
    await rejects(() => generateImages({ endpoint, prompt: 'Forest' }), 'Prompt rejected');
    generationResponse = { images: [] };
    await rejects(() => generateImages({ endpoint, prompt: 'Forest' }), '2-3');
    generationResponse = { images: ['http://images.example.test/a.png', 'https://images.example.test/b.png'] };
    await rejects(() => generateImages({ endpoint, prompt: 'Forest' }), 'invalid image URL');
  });
  await test('Saves real raster bytes directly in /assets/images with unique names', async () => {
    reset();
    const image = generationResponse.images[0];
    const first = await saveGeneratedImage(image, 'Forest / mountains', ctx);
    const second = await saveGeneratedImage(image, 'Forest / mountains', ctx);
    assert(first !== second, 'Overwriting existing variation');
    assert(/^\/assets\/images\/firefly-forest-mountains-.*\.png$/.test(first), 'Wrong destination');
    assert(writes.length === 2 && writes.every((file) => file.type === 'image/png'), 'Invalid upload');
  });
  await test('Download failures and non-raster content are never saved', async () => {
    reset();
    proxyFailure = true;
    await rejects(() => saveGeneratedImage(generationResponse.images[0], 'Forest', ctx), 'Image download failed');
    proxyFailure = false;
    proxyType = 'text/html';
    await rejects(() => saveGeneratedImage(generationResponse.images[0], 'Forest', ctx), 'JPEG, PNG or WebP');
    assert(writes.length === 0, 'Invalid bytes uploaded');
  });
  await test('Generate button opens a labelled dialog and missing config is visible', async () => {
    reset();
    renderImagesTab(fixture, ctx);
    fixture.querySelector('#dp-images-generate').click();
    const dialog = document.querySelector('dialog');
    assert(dialog.open && dialog.getAttribute('aria-labelledby'), 'Inaccessible dialog');
    const original = ctx.fireflyGenerateUrl;
    ctx.fireflyGenerateUrl = '';
    submit();
    await waitFor(() => dialog.querySelector('.dp-error'));
    assert(dialog.textContent.includes('firefly-generate-url'), 'Missing config hidden');
    ctx.fireflyGenerateUrl = original;
  });
  await test('Saves only selected variations, refreshes DA and cannot duplicate saved picks', async () => {
    reset();
    ctx.daImageRoots = ['/custom-images'];
    renderImagesTab(fixture, ctx);
    await waitFor(() => !fixture.querySelector('#dp-images-refresh').disabled);
    fixture.querySelector('#dp-images-generate').click();
    submit();
    await waitFor(generated);
    select(0);
    select(2);
    const dialog = document.querySelector('dialog');
    dialog.querySelector('.dp-generation-save').click();
    await waitFor(() => writes.length === 2 && !dialog.querySelector('.dp-generation-close').disabled);
    const downloads = calls.filter((call) => call.path === FETCH_IMAGE_ACTION_URL)
      .map((call) => JSON.parse(call.options.body).url);
    assert(downloads.join() === 'https://images.example.test/1.png,https://images.example.test/3.png', 'Wrong variations saved');
    assert(dialog.querySelector('.dp-generation-save').disabled, 'Saved picks can be duplicated');
    await waitFor(() => fixture.querySelectorAll('.dp-tile').length === 2);
    assert(ctx.state.imageAssetSource === 'da', 'DA source not selected');
    assert(fixture.querySelector('#dp-browser-root').value === '/assets/images', 'Generated folder not shown');
    assert(dialog.querySelectorAll('input:disabled').length === 2, 'Successful picks not marked');
  });
  await test('Partial failures keep successful saves and retry only the failed selection', async () => {
    reset();
    let refreshed = 0;
    openGenerateImageModal(ctx, () => { refreshed += 1; });
    submit();
    await waitFor(generated);
    select(0);
    select(1);
    uploadFailures = 1;
    const dialog = document.querySelector('dialog');
    const save = dialog.querySelector('.dp-generation-save');
    save.click();
    await waitFor(() => dialog.querySelector('.dp-error') && !save.disabled);
    assert(writes.length === 1 && refreshed === 1, 'Partial success not retained');
    save.click();
    await waitFor(() => writes.length === 2 && !dialog.querySelector('.dp-generation-close').disabled);
    assert(refreshed === 2 && save.disabled, 'Retry failed or saved twice');
  });
  await test('Closing a pending generation aborts it and restores focus', async () => {
    reset();
    renderImagesTab(fixture, ctx);
    const opener = fixture.querySelector('#dp-images-generate');
    opener.focus();
    opener.click();
    holdGeneration = true;
    submit();
    const request = calls.find((call) => call.path === endpoint);
    document.querySelector('.dp-generation-close').click();
    await waitFor(() => !document.querySelector('dialog'));
    assert(request.options.signal.aborted, 'Generation not cancelled');
    assert(document.activeElement === opener, 'Focus not restored');
  });
  await test('Whitespace prompts show an error without starting generation', async () => {
    reset();
    openGenerateImageModal(ctx, () => {});
    const dialog = document.querySelector('dialog');
    dialog.querySelector('textarea').value = '   ';
    dialog.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
    assert(dialog.querySelector('.dp-error').textContent.includes('prompt'), 'Validation error missing');
    assert(!calls.some((call) => call.path === endpoint), 'Whitespace prompt sent');
  });
  await test('AEM source can generate and saving switches the finder to DA', async () => {
    reset();
    ctx.state.imageAssetSource = 'aem';
    renderImagesTab(fixture, ctx);
    fixture.querySelector('#dp-images-generate').click();
    submit();
    await waitFor(generated);
    select(1);
    const dialog = document.querySelector('dialog');
    dialog.querySelector('.dp-generation-save').click();
    await waitFor(() => writes.length === 1 && ctx.state.imageAssetSource === 'da');
    await waitFor(() => fixture.querySelectorAll('.dp-tile').length === 1);
    assert(fixture.querySelector('#dp-aem-asset-mount').hidden, 'AEM mount still visible');
  });
  await test('Top-right refresh fetches new DA assets', async () => {
    reset();
    renderImagesTab(fixture, ctx);
    await waitFor(() => !fixture.querySelector('#dp-images-refresh').disabled);
    const before = listingCount;
    writes.push({ filename: 'new-image.png', path: '/assets/images/new-image.png' });
    fixture.querySelector('#dp-images-refresh').click();
    await waitFor(() => fixture.querySelectorAll('.dp-tile').length === 1);
    assert(listingCount === before + 1, 'Refresh did not refetch');
    assert(fixture.querySelector('.dp-tile-name').textContent === 'new-image.png', 'New image not shown');
  });
} finally {
  document.querySelector('dialog')?.close();
  window.fetch = realFetch;
}
document.querySelector('#results').textContent = results.join('\n');
document.body.dataset.testResult = results.some((line) => line.startsWith('FAIL')) ? 'failed' : 'passed';

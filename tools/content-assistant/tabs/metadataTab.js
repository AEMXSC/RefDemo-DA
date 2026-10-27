import {
  METADATA_FIELDS, loadMetadataSource, readMetadata, saveMetadata,
} from '../lib/metadata.js';

export default function renderMetadataTab(container, ctx) {
  if (container.dataset.dpBuilt) return;
  container.dataset.dpBuilt = '1';
  container.innerHTML = `
    <form class="dp-metadata">
      <strong>Metadata</strong>
      <p class="dp-subtle">Page properties. Save to update the page's metadata table.</p>
      <label for="dp-metadata-title">Title</label>
      <input id="dp-metadata-title" name="Title" type="text">
      <label for="dp-metadata-description">Description</label>
      <textarea id="dp-metadata-description" name="Description" rows="4"></textarea>
      <label for="dp-metadata-tags">Tags</label>
      <textarea id="dp-metadata-tags" name="Tags" rows="3" aria-describedby="dp-metadata-tags-help"></textarea>
      <p id="dp-metadata-tags-help" class="dp-subtle">Separate tags with commas or new lines.</p>
      <p class="dp-metadata-status" role="status" aria-live="polite">Loading metadata...</p>
      <button type="submit" disabled>Save metadata</button>
    </form>
  `;
  const form = container.querySelector('form');
  const button = form.querySelector('button');
  const status = form.querySelector('[role="status"]');
  const dirty = new Set();
  let ready = false;
  let saving = false;
  let editable = true;
  let disposed = false;
  let liveReceived = false;
  let unsubscribe;

  const updateButton = () => {
    button.disabled = !ready || saving || !editable || dirty.size === 0;
  };
  const setStatus = (message, error = false) => {
    status.textContent = message;
    status.classList.toggle('dp-error', error);
  };
  const populate = (html) => {
    const values = readMetadata(html);
    METADATA_FIELDS.forEach((field) => {
      if (!dirty.has(field)) form.elements.namedItem(field).value = values[field];
    });
    ready = true;
    updateButton();
  };
  form.addEventListener('input', (event) => {
    if (!METADATA_FIELDS.includes(event.target.name)) return;
    dirty.add(event.target.name);
    setStatus('Unsaved metadata changes.');
    updateButton();
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (button.disabled) return;
    const changes = Object.fromEntries([...dirty]
      .map((field) => [field, form.elements.namedItem(field).value]));
    saving = true;
    form.querySelectorAll('input, textarea').forEach((input) => { input.disabled = true; });
    setStatus('Saving metadata...');
    updateButton();
    try {
      await saveMetadata(ctx, changes);
      dirty.clear();
      if (!disposed) {
        populate((await loadMetadataSource(ctx)).html);
        setStatus('Metadata saved.');
      }
    } catch (error) {
      if (!disposed) setStatus(error.message || 'Could not save metadata.', true);
    } finally {
      saving = false;
      form.querySelectorAll('input, textarea').forEach((input) => { input.disabled = !editable; });
      updateButton();
    }
  });
  container.metadataCleanup = () => {
    disposed = true;
    unsubscribe?.();
  };
  if (typeof ctx.actions.subscribeLiveDocument === 'function') {
    unsubscribe = ctx.actions.subscribeLiveDocument((snapshot) => {
      if (disposed) return;
      liveReceived = true;
      editable = snapshot.editable !== false;
      populate(snapshot.html);
      form.querySelectorAll('input, textarea').forEach((input) => {
        input.disabled = saving || !editable;
      });
      if (!editable) setStatus('This page is read-only.');
      else if (!dirty.size && !saving) setStatus('');
    });
  }
  loadMetadataSource(ctx).then(({ html }) => {
    if (disposed || liveReceived) return;
    populate(html);
    setStatus('');
  }).catch((error) => {
    if (!disposed && !liveReceived) setStatus(error.message, true);
  });
}

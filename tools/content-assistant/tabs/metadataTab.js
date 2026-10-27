import {
  METADATA_FIELDS, loadMetadataSource, readMetadata, saveMetadata,
} from '../lib/metadata.js';
import { findTag, loadTags } from '../lib/tags.js';

export default function renderMetadataTab(container, ctx) {
  if (container.dataset.dpBuilt) return;
  container.dataset.dpBuilt = '1';
  container.innerHTML = `
    <form class="dp-metadata">
      <strong>Metadata</strong>
      <p class="dp-subtle">To add metadata, place the cursor on an empty line at the page bottom.
        To update metadata, select the entire Metadata table using its table selection handle.</p>
      <label for="dp-metadata-title">Title</label>
      <input id="dp-metadata-title" name="Title" type="text">
      <label for="dp-metadata-description">Description</label>
      <textarea id="dp-metadata-description" name="Description" rows="4"></textarea>
      <label for="dp-metadata-tag-search">Tags</label>
      <ul class="dp-metadata-tags" aria-label="Selected tags"></ul>
      <input id="dp-metadata-tag-search" type="text" list="dp-metadata-tag-options"
        autocomplete="off" placeholder="Search tags..." aria-describedby="dp-metadata-tags-help">
      <datalist id="dp-metadata-tag-options"></datalist>
      <input type="hidden" name="Tags">
      <p id="dp-metadata-tags-help" class="dp-subtle">Loading tags...</p>
      <p class="dp-metadata-status" role="status" aria-live="polite">Loading metadata...</p>
      <button type="submit" disabled>Save metadata</button>
    </form>
  `;
  const form = container.querySelector('form');
  const button = form.querySelector('button[type="submit"]');
  const status = form.querySelector('[role="status"]');
  const tagSearch = form.querySelector('#dp-metadata-tag-search');
  const tagList = form.querySelector('.dp-metadata-tags');
  const tagOptions = form.querySelector('datalist');
  const tagsHelp = form.querySelector('#dp-metadata-tags-help');
  const tagsField = form.elements.namedItem('Tags');
  let tags = [];
  let selectedTags = [];
  const dirty = new Set();
  let ready = false;
  let saving = false;
  let editable = true;
  let disposed = false;
  let unsubscribe;
  let snapshot;

  const updateButton = () => {
    button.disabled = !ready || saving || !editable || dirty.size === 0;
  };
  const setStatus = (message, error = false) => {
    status.textContent = message;
    status.classList.toggle('dp-error', error);
  };
  const markDirty = (field) => {
    dirty.add(field);
    setStatus('Unsaved metadata changes.');
    updateButton();
  };
  const setControlsDisabled = () => {
    form.querySelectorAll('input, textarea, .dp-metadata-tags button').forEach((input) => {
      input.disabled = saving || !editable;
    });
    tagSearch.disabled = saving || !editable || !tags.length;
  };
  const renderTags = () => {
    tagsField.value = selectedTags.map((value) => findTag(tags, value)?.title || value).join(', ');
    tagList.replaceChildren(...selectedTags.map((value) => {
      const tag = findTag(tags, value);
      const item = document.createElement('li');
      item.className = 'dp-metadata-tag';
      item.title = tag ? tag.breadcrumb : `${value} is not in the tag taxonomy`;
      const text = document.createElement('span');
      text.className = 'dp-metadata-tag-label';
      text.textContent = tag ? tag.title : value;
      if (!tag && tags.length) item.classList.add('dp-metadata-tag-unknown');
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `Remove tag ${text.textContent}`);
      remove.addEventListener('click', () => {
        selectedTags = selectedTags.filter((selected) => selected !== value);
        markDirty('Tags');
        renderTags();
        tagSearch.focus();
      });
      item.append(text, remove);
      return item;
    }));
    tagOptions.replaceChildren(...tags
      .filter((tag) => !selectedTags.some((value) => findTag(tags, value) === tag))
      .map((tag) => {
        const option = document.createElement('option');
        option.value = tag.label;
        option.textContent = tag.breadcrumb;
        return option;
      }));
    setControlsDisabled();
  };
  const addTag = (query) => {
    const tag = tags.find((item) => item.label === query)
      || (query.trim() && findTag(tags, query));
    if (!tag) return false;
    if (!selectedTags.some((value) => findTag(tags, value) === tag)) {
      selectedTags = [...selectedTags, tag.title];
      markDirty('Tags');
    }
    tagSearch.value = '';
    renderTags();
    return true;
  };
  const populate = (html) => {
    const values = readMetadata(html);
    METADATA_FIELDS.forEach((field) => {
      if (dirty.has(field)) return;
      if (field === 'Tags') selectedTags = values.Tags ? values.Tags.split(/\s*,\s*/) : [];
      else form.elements.namedItem(field).value = values[field];
    });
    renderTags();
    ready = true;
    updateButton();
  };
  form.addEventListener('input', (event) => {
    if (!METADATA_FIELDS.includes(event.target.name)) return;
    markDirty(event.target.name);
  });
  tagSearch.addEventListener('input', () => {
    const query = tagSearch.value;
    if (tags.some((tag) => tag.label === query)) addTag(query);
  });
  tagSearch.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (tagSearch.value.trim() && !addTag(tagSearch.value)) {
      setStatus(`"${tagSearch.value.trim()}" is not in the tag taxonomy.`, true);
    }
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (button.disabled) return;
    const changes = Object.fromEntries([...dirty]
      .map((field) => [field, form.elements.namedItem(field).value]));
    saving = true;
    setControlsDisabled();
    setStatus('Saving metadata...');
    updateButton();
    try {
      const html = await saveMetadata(ctx, changes, snapshot);
      dirty.clear();
      if (!disposed) {
        populate(html);
        setStatus('Metadata updated in the page and saved.');
      }
    } catch (error) {
      if (!disposed) setStatus(error.message || 'Could not save metadata.', true);
    } finally {
      saving = false;
      setControlsDisabled();
      updateButton();
    }
  });
  container.metadataCleanup = () => {
    disposed = true;
    unsubscribe?.();
  };
  if (typeof ctx.actions.subscribeLiveDocument === 'function') {
    unsubscribe = ctx.actions.subscribeLiveDocument((live) => {
      if (disposed) return;
      snapshot = live;
      editable = live.editable !== false;
      setControlsDisabled();
      if (!editable) setStatus('This page is read-only.');
    });
  }
  loadTags(ctx).then((result) => {
    if (disposed) return;
    tags = result.tags;
    if (result.created) {
      tagsHelp.textContent = 'Created /config/tags with starter tags. Edit that sheet in DA to manage the taxonomy.';
    } else if (!tags.length) {
      tagsHelp.textContent = 'No tags found. Add Tag ID, Title and Path rows to /config/tags.';
    } else {
      tagsHelp.textContent = 'Search by tag title or path, then pick a tag from the list.';
    }
    renderTags();
  }).catch((error) => {
    if (disposed) return;
    tagsHelp.textContent = `Could not load /config/tags: ${error.message}`;
    tagsHelp.classList.add('dp-error');
    renderTags();
  });
  loadMetadataSource(ctx).then(({ html }) => {
    if (disposed) return;
    populate(html);
    setStatus('');
  }).catch((error) => {
    if (!disposed) setStatus(error.message, true);
  });
}

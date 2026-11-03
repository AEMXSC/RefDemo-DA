import { generateImages, saveGeneratedImage } from './generateImages.js';

export default function openGenerateImageModal(ctx, onSaved) {
  const dialog = document.createElement('dialog');
  dialog.className = 'dp-generation';
  dialog.setAttribute('aria-labelledby', 'dp-generation-title');
  dialog.innerHTML = `
    <h3 id="dp-generation-title">Generate Image</h3>
    <form>
      <label for="dp-generation-prompt">Describe the image</label>
      <textarea id="dp-generation-prompt" class="dp-text-input" rows="4" required maxlength="2000"
        placeholder="Describe the subject, setting and style..."></textarea>
      <label for="dp-generation-size">Image shape</label>
      <select id="dp-generation-size" class="dp-select">
        <option value="1024x1024">Square</option>
        <option value="2688x1512">Banner (2688 x 1512)</option>
        <option value="1152x896">Teaser (1152 x 896)</option>
      </select>
      <button type="submit" class="dp-generation-button">Generate variations</button>
    </form>
    <p class="dp-status" role="status" aria-live="polite"></p>
    <div class="dp-generation-results"></div>
    <div class="dp-modal-actions">
      <button type="button" class="dp-generation-button dp-generation-close">Close</button>
      <button type="button" class="dp-generation-button dp-generation-save" disabled>Save selected to DA</button>
    </div>
  `;
  const opener = document.activeElement;
  document.body.append(dialog);
  const form = dialog.querySelector('form');
  const prompt = form.querySelector('textarea');
  const status = dialog.querySelector('[role="status"]');
  const results = dialog.querySelector('.dp-generation-results');
  const save = dialog.querySelector('.dp-generation-save');
  const close = dialog.querySelector('.dp-generation-close');
  let controller;
  let saving = false;
  let generatedPrompt = '';
  let variations = [];
  const setStatus = (message, error = false) => {
    status.textContent = message;
    status.classList.toggle('dp-error', error);
  };
  const updateSave = () => {
    save.disabled = saving || !variations.some((item) => item.checkbox.checked && !item.path);
  };
  dialog.addEventListener('close', () => {
    controller?.abort();
    dialog.remove();
    if (opener?.isConnected) opener.focus();
  });
  dialog.addEventListener('cancel', (event) => {
    if (saving) event.preventDefault();
  });
  close.addEventListener('click', () => dialog.close());
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (controller || saving) return;
    if (!prompt.value.trim()) {
      setStatus('Enter an image prompt.', true);
      prompt.focus();
      return;
    }
    controller = new AbortController();
    const [width, height] = form.querySelector('select').value.split('x').map(Number);
    generatedPrompt = prompt.value.trim();
    variations = [];
    results.replaceChildren();
    updateSave();
    form.querySelectorAll('input, textarea, select, button').forEach((el) => { el.disabled = true; });
    setStatus('Generating three image variations...');
    try {
      const images = await generateImages({
        endpoint: ctx.fireflyGenerateUrl,
        prompt: generatedPrompt,
        width,
        height,
        signal: controller.signal,
      });
      if (!dialog.open) return;
      variations = images.map((image) => {
        const label = document.createElement('label');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.addEventListener('change', updateSave);
        const preview = document.createElement('img');
        preview.className = 'dp-generation-preview';
        preview.src = image.url;
        preview.alt = `${image.label}: ${generatedPrompt}`;
        preview.addEventListener('error', () => setStatus('A variation could not be previewed. Try generating again.', true));
        label.append(preview, checkbox, document.createTextNode(image.label));
        results.append(label);
        return { ...image, checkbox };
      });
      setStatus('Choose the variations to save in /assets/images.');
    } catch (error) {
      if (error.name !== 'AbortError') setStatus(error.message || 'Image generation failed.', true);
    } finally {
      controller = null;
      form.querySelectorAll('input, textarea, select, button').forEach((el) => { el.disabled = false; });
    }
  });
  save.addEventListener('click', async () => {
    if (saving || save.disabled) return;
    saving = true;
    close.disabled = true;
    form.querySelectorAll('textarea, select, button').forEach((el) => { el.disabled = true; });
    variations.forEach((item) => { item.checkbox.disabled = true; });
    updateSave();
    const selected = variations.filter((item) => item.checkbox.checked && !item.path);
    let saved = 0;
    const errors = [];
    setStatus('Saving selected images to DA...');
    // Keep successful saves marked so retrying a partial failure cannot duplicate them.
    for (let index = 0; index < selected.length; index += 1) {
      const item = selected[index];
      try {
        // eslint-disable-next-line no-await-in-loop
        item.path = await saveGeneratedImage(item, generatedPrompt, ctx);
        item.checkbox.checked = false;
        item.checkbox.parentElement.append(document.createTextNode(' - Saved'));
        saved += 1;
      } catch (error) {
        errors.push(`${item.label}: ${error.message}`);
      }
    }
    saving = false;
    close.disabled = false;
    form.querySelectorAll('textarea, select, button').forEach((el) => { el.disabled = false; });
    variations.forEach((item) => { item.checkbox.disabled = !!item.path; });
    setStatus(`${saved} image(s) saved in /assets/images.${errors.length ? ` ${errors.join(' ')}` : ''}`, errors.length > 0);
    updateSave();
    if (saved) onSaved();
  });
  dialog.showModal();
  prompt.focus();
}

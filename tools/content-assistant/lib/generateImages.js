import { fetchImageBlob } from './uploadImages.js';
import { putBinarySource } from './daAdmin.js';
import { ASSETS_FOLDER } from '../config.js';

export async function generateImages({
  endpoint, prompt, width = 1024, height = 1024, signal,
}) {
  if (!endpoint) {
    throw new Error('Set firefly-generate-url in /config/placeholders to the deployed Universal Editor generate-image action URL.');
  }
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('The Firefly generation endpoint must be an HTTPS URL without credentials.');
  }
  if (!prompt.trim()) throw new Error('Enter an image prompt.');
  const response = await fetch(url.href, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: prompt.trim(), width, height }),
    signal,
  });
  if (!response.ok) throw new Error(`Image generation failed (HTTP ${response.status}).`);
  const json = await response.json();
  const result = typeof json.body === 'string' ? JSON.parse(json.body) : json.body || json;
  if (result.error) {
    throw new Error(typeof result.error === 'string' ? result.error : 'The image generation service returned an error.');
  }
  if (!Array.isArray(result.images) || result.images.length < 2 || result.images.length > 3) {
    throw new Error('The image generation service must return 2-3 variations. Please try again.');
  }
  return result.images.map((image, index) => {
    const value = typeof image === 'string' ? image : image?.url;
    if (typeof value !== 'string' || new URL(value).protocol !== 'https:') {
      throw new Error('The image generation service returned an invalid image URL.');
    }
    return { url: value, label: `Variation ${index + 1}` };
  });
}

export async function saveGeneratedImage(image, prompt, ctx) {
  if (!ctx.org || !ctx.repo || !ctx.token) throw new Error('DA site or authentication is unavailable.');
  const blob = await fetchImageBlob(image.url);
  const extension = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  }[blob.type];
  if (!extension) throw new Error('The generated image must be JPEG, PNG or WebP.');
  const slug = prompt.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'image';
  const filename = `firefly-${slug}-${crypto.randomUUID()}.${extension}`;
  const path = `${ASSETS_FOLDER}/${filename}`;
  await putBinarySource({
    org: ctx.org, repo: ctx.repo, token: ctx.token, path, filename, blob,
  });
  return path;
}

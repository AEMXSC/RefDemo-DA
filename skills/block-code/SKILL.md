---
name: block-code
description: Write the JS decorate function and scoped CSS for an AEM EDS block. Runs lint and previews locally using a temporary draft page.
---

# Block Code — JS + CSS

Your job is to write `blocks/{blockname}/{blockname}.js` and `blocks/{blockname}/{blockname}.css` based on the author contract from `block-html`. Then lint and preview locally.

## Step 1: Read Before Writing

Before writing any code:
1. Read the author contract from the previous skill — understand every row, column, data type, and config field
2. Read `blocks/cards/cards.js`, `blocks/hero/hero.js`, and `blocks/accordion/accordion.js` to understand existing patterns
3. Read `styles/styles.css` to know what CSS variables are available

## Step 2: Write `blocks/{blockname}/{blockname}.js`

Create the directory and file. The file must:

```javascript
import { createOptimizedPicture } from '../../scripts/aem.js';
import { moveInstrumentation } from '../../scripts/scripts.js';

/**
 * loads and decorates the {blockname} block
 * @param {Element} block The block element
 */
export default function decorate(block) {
  // Implementation following the author contract
}
```

Only import what is actually used. Available imports:
- `createOptimizedPicture` from `../../scripts/aem.js` — optimizes images with WebP + responsive srcset
- `moveInstrumentation` from `../../scripts/scripts.js` — preserves AEM UE editing attributes when replacing elements
- `moveAttributes` from `../../scripts/scripts.js` — moves arbitrary attributes between elements

### DOM Structure at Decoration Time

When `decorate(block)` is called, the block has this structure (matching the author contract):
```html
<div class="{blockname} block" data-block-name="{blockname}">
  <div>                    <!-- row 1 -->
    <div>col 1 content</div>
    <div>col 2 content</div>
  </div>
  <div>                    <!-- row 2 -->
    <div>col 1 content</div>
  </div>
</div>
```

### Key Patterns

**Reading config values:**
```javascript
const variant = block.querySelector(':scope > div:nth-child(3) > div')?.textContent?.trim() || 'default';
```

**Iterating rows (for repeating blocks):**
```javascript
[...block.children].forEach((row) => {
  const col1 = row.children[0];
  const col2 = row.children[1];
  // ...
});
```

**Transforming to semantic list:**
```javascript
const ul = document.createElement('ul');
[...block.children].forEach((row) => {
  const li = document.createElement('li');
  moveInstrumentation(row, li);
  while (row.firstElementChild) li.append(row.firstElementChild);
  ul.append(li);
});
block.textContent = '';
block.append(ul);
```

**Optimizing images:**
```javascript
ul.querySelectorAll('picture > img').forEach((img) => {
  const optimized = createOptimizedPicture(img.src, img.alt, false, [{ width: '750' }]);
  moveInstrumentation(img, optimized.querySelector('img'));
  img.closest('picture').replaceWith(optimized);
});
```

**Hiding config rows:**
```javascript
const configRow = block.querySelector(':scope > div:nth-child(3)');
if (configRow) configRow.style.display = 'none';
```

**Adding variant classes:**
```javascript
if (variant && variant !== 'default') block.classList.add(variant);
```

Always use optional chaining (`?.`) when accessing DOM nodes that may not exist — authors may omit optional fields.

## Step 3: Write `blocks/{blockname}/{blockname}.css`

### Hard Rules
- **Every selector must be scoped under `.{blockname}`** — no bare element selectors anywhere
- **Never use `.{blockname}-container` or `.{blockname}-wrapper`** — those are added by the framework to parent elements
- Mobile-first: write base styles for mobile, then override at larger breakpoints

### Breakpoints
```css
/* Mobile (default) */
.{blockname} { }

/* Tablet */
@media (min-width: 600px) { .{blockname} { } }

/* Desktop */
@media (min-width: 900px) { .{blockname} { } }

/* Wide */
@media (min-width: 1200px) { .{blockname} { } }
```

### CSS Variables (from `styles/styles.css`)
Colors: `--background-color`, `--dark-color`, `--light-color`, `--text-color`, `--text-light`, `--main-accent-color`, `--link-color`, `--link-hover-color`

Fonts: `--body-font-family`, `--heading-font-family`, `--light-font-family`, `--black-font-family`

Font sizes: `--body-font-size-m`, `--body-font-size-s`, `--body-font-size-xs`, `--heading-font-size-xxl`, `--heading-font-size-xl`, `--heading-font-size-l`, `--heading-font-size-m`, `--heading-font-size-s`, `--heading-font-size-xs`

Spacing: `--spacing-none`, `--spacing-xsmall`, `--spacing-small`, `--spacing-medium`, `--spacing-large`, `--spacing-xlarge`, `--spacing-xxlarge`, `--spacing-huge`, `--spacing-xhuge`

Border radius: `--border-radius-small`, `--border-radius-base`, `--border-radius-medium`, `--border-radius-large`

## Step 4: Lint

```bash
npm run lint:fix
npm run lint
```

If errors remain after `lint:fix`, read each error and fix manually. Common issues:
- Missing `.js` extension on imports — always include it
- `no-param-reassign` — don't reassign `block` directly; operate on its children
- CSS descending specificity — add `/* stylelint-disable no-descending-specificity */` at top of file only if truly unavoidable

Retry up to 3 times. If lint still fails after 3 attempts, show the remaining errors to the user and ask for guidance.

## Step 5: Create Temporary Draft and Preview

Create `drafts/{blockname}.html` (this is temporary — do NOT commit it):

```html
<!DOCTYPE html>
<html>
<head><title>{blockname} draft</title></head>
<body>
<header></header>
<main>
  <div>
    <div class="{blockname}">
      <!-- Populate rows/cols matching the author contract exactly -->
      <!-- For repeating blocks: include at least 3 items -->
      <!-- Use https://placehold.co/800x400 for placeholder images -->
    </div>
  </div>
</main>
<footer></footer>
</body>
</html>
```

Start the dev server:
```bash
npx @adobe/aem-cli up --no-open --html-folder drafts --forward-browser-logs
```

Open `http://localhost:3000/drafts/{blockname}` and visually compare against the original screenshot. Iterate on the CSS and JS until the output matches the design.

Check the browser console for JS errors — fix any that appear.

## Step 6: Confirm

Once the local preview matches the design and lint is clean, report:
- Files created: `blocks/{blockname}/{blockname}.js` and `blocks/{blockname}/{blockname}.css`
- Lint status: clean
- Any design decisions or trade-offs made (e.g. "used `<details>/<summary>` for the expand/collapse interaction")

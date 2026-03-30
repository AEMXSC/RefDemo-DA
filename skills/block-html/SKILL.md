---
name: block-html
description: Analyze a block screenshot or description and produce the author contract — the row/column structure that defines how authors create the block in DA and how the JS decorator will read it.
---

# Block HTML — Author Contract

Your job is to analyze the provided screenshot or description and define the block's row/column structure. **No files are written in this skill.** The output is a documented author contract that all subsequent skills depend on.

## Step 1: Analyze the Design

Study the screenshot and/or description carefully. Identify:

- **Is this a single content unit, or a repeating list of items?**
  - Single unit: one hero image + text, one banner, one promo — fixed structure
  - Repeating: cards, list items, accordion panels, tabs — same structure repeated N times

- **What content types are present per item?**
  - Images, headings (h1–h6), body paragraphs, CTA links/buttons, icons, labels, tags, metadata

- **What configuration/variant options exist?**
  - Visual variants (dark/light theme, layout direction, image position)
  - Behavior options (autoplay, speed, expandable)
  - These become config columns/rows with plain text values, read by JS and hidden after decoration

## Step 2: Define the Row/Column Structure

Map the design to a table structure. There are no fixed rules — reason from the design:

- Each logical "row" of content becomes one `<tr>` row in the DA table (and one child `<div>` in the delivered HTML)
- Each piece of data within a row becomes one `<td>` column
- A row can have any number of columns — 1, 2, 3, 4, 5, 6, or more — whatever the design requires
- Config/option values are just cells containing plain text (e.g. `"dark"`, `"image-left"`, `"true"`)
- For **repeating blocks**: one row = one item. Each item has the same column structure.
- For **single blocks**: each row is a named field (e.g. row 1 = image, row 2 = text content, row 3 = config)

Look at existing blocks for inspiration but do not force the new block into their patterns:
- `blocks/hero/hero.js` — reads config from rows 3–6 via `:scope div:nth-child(N) > div`
- `blocks/cards/cards.js` — each row = one card, columns = image / body / card-style / cta-style
- `blocks/accordion/accordion.js` — each row = label (col 1) + body (col 2)

## Step 3: Output the Author Contract

Produce a clear markdown table documenting the structure:

```
## Author Contract: {blockname}

| Row | Col 1 | Col 2 | Col 3 | Notes |
|-----|-------|-------|-------|-------|
| 1 (per item) | Image | Heading + body text | CTA link | Repeating row for each item |
| Config row | layout-style value | — | — | Hidden by JS after reading |
```

For each cell document:
- **Label** — what it represents
- **Data type** — `image`, `richtext`, `text`, `link`, `config value`
- **Required/optional**
- **Default value** if optional

Also state clearly:
- Whether this is a **repeating block** (container + items) or a **single-structure block**
- Which rows/columns are **config-only** (will be hidden by JS via `el.style.display = 'none'`)
- The **maximum number of columns** in any row (needed for DA table `colspan` on the header)

## Step 4: Confirm with Context

Before completing, briefly confirm:
- The structure makes sense for the visual design shown
- Authors will be able to intuitively fill in the table following this contract
- The JS decorator will be able to reliably read values using `block.querySelector(':scope div:nth-child(N) > div')` or by iterating `[...block.children]`

Output the final author contract and pass it forward to the next skill.

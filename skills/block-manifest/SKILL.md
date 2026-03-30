---
name: block-manifest
description: Create the Universal Editor model JSON for a new AEM EDS block and run npm run build:json to merge it into the project manifests.
---

# Block Manifest — UE Model JSON

Your job is to create `ue/models/blocks/{blockname}.json` defining the Universal Editor field model for the block, then run `npm run build:json` to merge it into the project's root manifests.

## Step 1: Study Existing Models

Before writing anything, read these files to understand the exact format:
- `ue/models/blocks/hero.json` — single-structure block pattern
- `ue/models/blocks/accordion.json` — repeating/container block pattern
- `ue/models/blocks/cards.json` — container block with select field and options

Do not assume — read and understand the actual structure.

## Step 2: Determine the Model Pattern

Based on the author contract from `block-html`:

**Single-structure block** (fixed set of rows/fields, no repeating items):
- One `definitions` entry with the block's `rows` and `columns` counts and `fields` array
- One `models` entry with all field definitions
- Empty `filters` array

**Repeating/container block** (holds N identical child items):
- Two `definitions` entries:
  1. The container: `"rows": 0, "columns": 0` (no direct fields), with `"filter": "{blockname}"`
  2. The item: actual `rows` and `columns` from the author contract, with `fields`
- One `models` entry for the item (not the container)
- One `filters` entry: `{ "id": "{blockname}", "components": ["{blockname}-item"] }`

## Step 3: Write the Model File

```json
{
  "definitions": [
    {
      "title": "{Block Display Name}",
      "id": "{blockname}",
      "model": "{blockname}",
      "plugins": {
        "da": {
          "rows": {R},
          "columns": {C},
          "fields": [
            { "name": "{fieldname}", "selector": "{css-selector}" }
          ]
        }
      }
    }
  ],
  "models": [
    {
      "id": "{blockname}",
      "fields": [
        {
          "component": "{type}",
          "valueType": "string",
          "name": "{fieldname}",
          "label": "{Display Label}",
          "value": ""
        }
      ]
    }
  ],
  "filters": []
}
```

### `rows` and `columns` values
Derive directly from the author contract:
- `rows` = number of content rows per item (not counting the header row; for non-repeating blocks, total rows)
- `columns` = maximum number of columns in any single row

### CSS Selectors for `fields`

The selectors target elements within the delivered div structure (after DA converts tables to divs). Each row becomes `div:nth-child(N)`, each column within a row is a child `div`.

Common patterns:
- Image src attribute: `"div:nth-child(1)>div>picture>img[src]"`
- Image alt attribute: `"div:nth-child(1)>div>picture>img[alt]"`
- Rich text container: `"div:nth-child(2)>div"`
- Specific paragraph: `"div:nth-child(2)>p:nth-child(1)"`
- Config value text: `"div:nth-child(3)>div"` or `"div:nth-child(3)>:first-child"`

### Field Component Types

Full reference: https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/developing/universal-editor/field-types

Most commonly used:
- `"reference"` — image/asset picker (use with `"multi": false`)
- `"text"` — single line text input
- `"textarea"` — multi-line plain text
- `"richtext"` — rich text editor
- `"select"` — dropdown; requires `"options": [{ "name": "Label", "value": "css-class" }]`
- `"boolean"` — toggle true/false
- `"number"` — numeric input

Choose the component type that matches the data type from the author contract.

## Step 4: Run the Build

```bash
npm run build:json
```

This merges `ue/models/blocks/*.json` into:
- `component-definition.json`
- `component-models.json`
- `component-filters.json`

If the command fails, read the error output, fix the JSON in `ue/models/blocks/{blockname}.json`, and retry.

## Step 5: Verify

Confirm:
- `ue/models/blocks/{blockname}.json` is valid JSON (no syntax errors)
- `npm run build:json` completed without errors
- The block name appears in `component-definition.json`

Report the model structure created and any decisions made (e.g. "used `select` for the variant field with options: default, dark, wide").

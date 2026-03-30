---
name: block-author
description: Create a live content page in DA (Document Authoring) with the block's sample content, using HTML table markup via the da-mcp tool.
---

# Block Author — DA Content Page

Your job is to create a content page in DA containing the block with realistic sample content. DA stores and displays blocks as HTML `<table>` elements. The DA framework converts these tables to nested div HTML when rendering the page.

## DA Table Format

Blocks in DA are authored as HTML tables:
- **Header row**: `<tr><th colspan="N">{blockname}</th></tr>` — block name, colspan = max columns
- **Content rows**: `<tr><td>col 1</td><td>col 2</td>...</tr>` — one `<td>` per column in the author contract
- **Full-width row**: `<tr><td colspan="N">value</td></tr>` — for config rows or single-column rows
- Any number of columns per row is valid — determined purely by the author contract

Example for a 2-column repeating block:
```html
<body><header></header><main>
<table>
  <tr><th colspan="2">my-block</th></tr>
  <tr><td><img src="https://placehold.co/800x400" alt="Item 1"></td><td><h2>Heading One</h2><p>Body text for item one.</p></td></tr>
  <tr><td><img src="https://placehold.co/800x400" alt="Item 2"></td><td><h2>Heading Two</h2><p>Body text for item two.</p></td></tr>
  <tr><td><img src="https://placehold.co/800x400" alt="Item 3"></td><td><h2>Heading Three</h2><p>Body text for item three.</p></td></tr>
</table>
</main><footer></footer></body>
```

## Step 1: Confirm DA Org and Repo

Call `mcp__da-admin-mcp__da_list_sources` (with no path) to list the available content. Show the listing to the user and ask them to confirm which org and repo to use.

Do not assume or hardcode the org/repo — always confirm.

## Step 2: Handle Images

**If the user pasted an image in the conversation:**
1. Read the image as base64-encoded data
2. Call `mcp__da-admin-mcp__da_upload_media` with:
   - `org`: confirmed org
   - `repo`: confirmed repo
   - `path`: `drafts/.{blockname}/{original-filename}`
   - `base64Data`: the base64-encoded image content
   - `mimeType`: the image MIME type (e.g. `image/png`, `image/jpeg`)
   - `fileName`: the original filename
3. The image will be available at: `https://content.da.live/{org}/{repo}/drafts/.{blockname}/{filename}`
4. Use this URL in the `<img src>` within the table cell

**If no image was provided:**
Use `https://placehold.co/800x400` as a placeholder image URL.

For blocks with multiple items needing different images, either reuse the user-provided image or use different placeholder sizes/colors (e.g. `https://placehold.co/800x400/333/fff`).

## Step 3: Compose the Page HTML

Build the full page HTML using the author contract from `block-html`:

```html
<body><header></header><main>
<table>
  <tr><th colspan="{max-cols}">{blockname}</th></tr>
  {content rows following author contract}
</table>
</main><footer></footer></body>
```

Guidelines for sample content:
- Use realistic, meaningful text (not "text goes here") — match the block's purpose
- For repeating blocks: include at least 3 items
- For image cells: use `<img src="{url}" alt="{descriptive alt text}">`
- For rich text cells: use appropriate heading and paragraph tags (`<h2>`, `<h3>`, `<p>`)
- For CTA/link cells: use `<a href="#">{CTA Text}</a>`
- For config value cells: use the plain text value (e.g. `dark`, `image-left`, `true`)

## Step 4: Create the Page in DA

Call `mcp__da-admin-mcp__da_create_source`:
- `org`: confirmed org
- `repo`: confirmed repo
- `path`: `drafts/{blockname}.html`
- `content`: the full page HTML composed above
- `contentType`: `text/html`

If the page already exists, use `mcp__da-admin-mcp__da_update_source` instead.

## Step 5: Construct and Verify the Preview URL

Get the current branch name:
```bash
git branch --show-current
```

Construct the preview URL:
- Replace all `/` in the branch name with `-`
- Format: `https://{branch-dashes}--{repo}--{org}.aem.page/drafts/{blockname}`

Example: branch `block/feature-grid` → `https://block-feature-grid--refdemo-da--aemxsc.aem.page/drafts/feature-grid`

Verify the URL is accessible:
```bash
curl -s -o /dev/null -w "%{http_code}" "{preview-url}"
```

## Step 6: Report

Return:
- The DA editor URL (from the `editUrl` in the `da_create_source` response)
- The preview URL
- A summary of the sample content authored

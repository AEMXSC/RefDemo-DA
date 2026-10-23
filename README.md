# Your Project's Title...
Your project's description...

## Environments
- Preview: https://main--{repo}--{owner}.aem.page/
- Live: https://main--{repo}--{owner}.aem.live/

## Documentation

Before using the aem-boilerplate, we recommand you to go through the documentation on https://www.aem.live/docs/ and more specifically:
1. [Developer Tutorial](https://www.aem.live/developer/tutorial)
2. [The Anatomy of a Project](https://www.aem.live/developer/anatomy-of-a-project)
3. [Web Performance](https://www.aem.live/developer/keeping-it-100)
4. [Markup, Sections, Blocks, and Auto Blocking](https://www.aem.live/developer/markup-sections-blocks)

## Installation

```sh
npm i
```

## Linting

```sh
npm run lint
```

## Local development

1. Create a new repository based on the `aem-boilerplate` template
1. Add the [AEM Code Sync GitHub App](https://github.com/apps/aem-code-sync) to the repository
1. Install the [AEM CLI](https://github.com/adobe/helix-cli): `npm install -g @adobe/aem-cli`
1. Start AEM Proxy: `aem up` (opens your browser at `http://localhost:3000`)
1. Open the `{repo}` directory in your favorite IDE and start coding :)

## Header and footer in DA Layout

The header stays sticky while retaining its space above the page content.
Repeated page loads in DA Layout reuse existing header/footer blocks instead
of appending duplicates; a newly replaced page body loads fresh blocks.

## Task Management DA plugin

Both Task Management HTML entry points require the `da-lit` import map.
The plugin reads its existing `/config/placeholders.json` sheet from the
plugin's own origin to avoid cross-origin requests from DA preview to live EDS.
Preview the sheet for preview testing and publish it for live use.
Do not store credentials in this publicly served sheet.

Review submissions link to the page's `main` branch preview URL on `aem.page`.

## Content Assistant image folders

Optional rows in the DA site's `/config/placeholders.json` sheet:

| key | value example |
| --- | --- |
| `da-image-roots` | `/assets/images, /library/photos, /campaigns/assets` |
| `aem-import-folder` | `/content/dam/my-project/imports` |

`da-image-roots` accepts comma-separated or newline-separated site-relative
absolute folder paths. Repeated rows are also supported. With multiple roots,
the DA image browser provides an **Image folder** selector. Imports use the first
root, followed by `<source-host>/<filename>`. With no configured roots, browsing
starts at `/assets/images` and imports retain
`/assets/images/<source-host>/<filename>`.

The plugin reads this sheet through the authenticated DA Source API for the
current site; publishing the sheet is not required for these image settings.
Both `key/value` and `Key/Text` columns and multi-sheet documents are supported.
Missing settings use defaults; read errors or invalid paths display a warning.

AEM browsing always starts at `/content/dam` with folder navigation enabled,
independently of the import destination. `aem-import-folder` is a single DAM
folder used only for imports; it defaults to `/content/dam/imported-assets/en`.
Authors still need permission to browse assets and write to the import folder.

## Content Assistant structured content

The Fragments tab reads org-level `editor.path` rows but uses only DA form-editor
mappings within the current `/{org}/{repo}` site, for example:

```text
editor.path | /aemxsc/refdemo-da/fragments=https://da.live/form#
editor.path | /aemxsc/refdemo-da/data=https://da.live/form#
```

Canvas mappings (including a site-wide canvas default) and mappings for other
sites are ignored. If no matching form mappings exist, `/fragments` is used.
Only HTML/JSON documents within these roots are checked, with up to four
document requests at a time and duplicate requests removed for overlapping
roots. Empty structured-content responses are excluded; request failures other
than missing documents are shown as errors rather than silently omitted.

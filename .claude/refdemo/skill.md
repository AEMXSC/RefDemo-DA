---
name: refdemo
description: Set up or refresh a DA demo site by copying the RefDemo base Document Authoring site (aemxsc/refdemo-da) into the user's site - pages, fragments, sheets, assets, page images, structured content schemas, DA site configuration, editor mappings and headers - then preview it and return the DA and preview links. Use whenever the user mentions RefDemo / ref demo / refdemo-da. Also use (after one confirmation question) when the user wants to set up, create, build, bootstrap, populate or get started with a DA demo site, DA site, demo site or their site's demo content, e.g. "set up my DA demo site", "create my demo site", "get my DA site working", "add the demo content to my site", "copy the latest DA demo content", "refresh my demo site", "check what the demo setup would change".
---

# RefDemo site replication (DA demo site setup)

Copies the RefDemo base site into the user's current site in one pass, with at most one
question. The code base is https://github.com/AEMXSC/RefDemo-da; the content and
configuration come from Document Authoring `aemxsc/refdemo-da`
(https://da.live/#/aemxsc/refdemo-da). Users call the result a **DA demo site**; use that
term (and "DA demo content") in everything you tell them.

## When this skill applies

| The user's message | What to do |
|---|---|
| Mentions **RefDemo** in any form ("refdemo", "ref demo", "RefDemo-da", "the refdemo skill") | Use this skill directly. Its explicit wording counts as the confirmation in step 3. |
| Asks to set up, create, build, bootstrap, populate, refresh, re-sync or get started with a **DA demo site, DA site, demo site, demo content**, or "my site" when the repository is RefDemo-based, **without** mentioning RefDemo | Use this skill, but confirm first. The step 3 question also asks whether to use the RefDemo setup (see "Confirming the skill"). Never start copying on an assumption. |
| Anything else about a DA site (edit a page, fix a block, migrate a website, publish a page, style changes) | Not this skill. |

"RefDemo-based repository" means `tools/content-assistant/` and `tools/task-management/`
exist. If they don't and RefDemo wasn't mentioned, still ask, and say in the question that
the site's code isn't from the DA demo template.

A dry-run request ("check what the demo setup would change", "what would be copied") runs
steps 1 and 2 only, reports the result, and asks nothing.

All work is done by `scripts/replicate-refdemo.mjs` (next to this file). Run it from the
repository root. Do not copy files by hand, do not write your own copy loop, and do not
generate pages with an importer for this task.

## What is copied

| Item | Where it lives | How |
|---|---|---|
| Pages, nav, footer, fragments, data documents, block library docs | DA source | exact copy, links rewritten |
| Sheets (`config/placeholders`, `config/tags`, `config/mobile`, `docs/library/*.json`) | DA source | exact copy, links rewritten |
| Assets (`assets/**`: images, theme documents) | DA source | byte-for-byte |
| Images pasted into pages (hidden `.<page>/` folders, e.g. `.index/`, `.nav/`) | DA source | byte-for-byte |
| Structured content schemas (`.da/forms/schemas/*`) | DA source | exact copy |
| DA library settings (`.da/config.json`) | DA source | exact copy |
| DA site configuration (`data` and `library` sheets: AEM Assets repository, IMS org, editor paths, library entries, tools) | DA config API | merged into the target, links rewritten |
| Editor mappings for the base site (`editor.path` rows in the aemxsc org config: canvas for the site, form editor for `/fragments` and `/data`) | DA config API | rewritten, added to the target site config and appended to the target org config |
| Custom response headers (for example `access-control-allow-origin: *`) | Edge Delivery site config | merged into the target |

Never copied: `.trash/`, `.da/translation/` (the base site's in-flight translation jobs),
permission sheets, the rest of the aemxsc org configuration, and the Edge Delivery code or
content-source settings.

Link rewriting (in every HTML/JSON file and in the site configuration):
- `/aemxsc/refdemo-da/...` (content.da.live, da.live, editor paths) → `/<org>/<site>/...`
- `main--refdemo-da--aemxsc.aem.page|live` → `main--<site>--<org>.aem.page|live`, so library tools
  (Task Management, Content Assistant) open from the new site's own code
- `github.com/aemxsc/refdemo-da` → `github.com/<org>/<site>`
- **Kept on the base site:** `main--refdemo-da--aemxsc.aem.live/media_*` image URLs. Edge Delivery
  stores media per site, so these only resolve on the base site. They keep working as long as
  the base site stays published.

When an author opens a copied page, DA re-saves it in its own format and copies those external
images and videos into the new site (`.<page>/media-<hash>-<id>.jpg`, `shared-media/…`). The
script compares pages by their main content, ignoring formatting and treating a media file as
the same when its file name matches. So these re-saved pages count as `unchanged`, are never
overwritten by a rerun, and the local copy is taken from the target.

## What is previewed

After copying, the script previews on Edge Delivery (`aem.page`) every page, sheet
(placeholders, tags, mobile, block library and other configuration sheets) and asset it
copied. Assets go first, then sheets, then pages. Structured content schemas, `.da/` settings
and the hidden page-image folders are not previewable. Page images are picked up when their
page is previewed. Nothing is ever published live.

## Workflow

Run the steps in order without stopping between them. Ask nothing except the single
question in step 3, and only when that step says to.

### 1. Find the target site

1. If the user named a target DA site (for example `https://da.live/#/acme/demo` or `acme/demo`),
   use it.
2. Otherwise use the repository: `git remote get-url origin` → `github.com/<owner>/<repo>` →
   target `<owner>/<repo>`, lowercased.
3. Refuse if the target is `aemxsc/refdemo-da`. The base site is never written to.

Check that the site's code is RefDemo-based: `tools/content-assistant/` and
`tools/task-management/` should exist in the repository. If they are missing, say once that
library tools such as Content Assistant and Task Management won't load until the code is
based on AEMXSC/RefDemo-da, and continue.

### 2. Dry run (read-only)

```bash
node .claude/refdemo/scripts/replicate-refdemo.mjs --target <org>/<site> --dry-run --report migration-work/refdemo-replication/dry-run.json
```

The script first checks that the target's content source (from the site configuration) is
`https://content.da.live/<org>/<site>/`. If it stops with "Target content source is …", tell
the user the site isn't connected to its own Document Authoring folder, so it can't be
replicated into. An org admin has to fix the site configuration. Stop there. Use
`--force-target` only if the user explicitly asks for it.

Read the report: `files` (created / updated / unchanged), `conflicts` (target files that
exist and differ), `siteConfig`, `orgConfig.added` and `edsHeaders`.

### 3. Approval (at most one question)

Writing to Document Authoring and Edge Delivery configuration, and previewing on Edge
Delivery, changes the user's remote site, so it needs explicit approval.

- **No question** only when all of these are true:
  - the user's message mentions RefDemo;
  - it explicitly asks to copy, replicate, set up or upload into their DA / Document
    Authoring site **and to preview it** (for example "use refdemo to copy everything into my
    Document Authoring site and preview it");
  - the dry run shows no conflicts, or every conflict is one of the blank starter pages
    (`index.html`, `nav.html`, `footer.html`) of a new site.

  Go to step 4 with `--on-conflict overwrite`.
- **Otherwise** ask exactly one question. It confirms the skill, if needed, and approves the
  changes together. Include the counts from the dry run (files, and the `preview.planned`
  paths) and list up to 10 conflicting paths. Options (with no conflicts, drop option 2 and
  leave "replacing …" out of option 1):
  1. **Set up with RefDemo and preview (Recommended)**. Description: "Use the RefDemo skill
     to copy all DA demo content and configuration (N files, site configuration, editor
     mappings, custom headers) into DA site <org>/<site>, replacing the M existing files that
     differ, then preview P pages, sheets and assets on main--<site>--<org>.aem.page. Nothing
     is published live."
  2. **Set up with RefDemo, keep my changes**. Description: "Same, but leave the M existing
     files that differ untouched (and don't preview them). Nothing is published live."
  3. **Set up with RefDemo, no preview**. Description: "Copy everything into DA site
     <org>/<site>, replacing the M existing files that differ. Nothing is previewed or
     published."
  4. **No, something else**. Description: "Don't use the RefDemo setup. Change nothing; I'll
     say what I need."

  The chosen option approves the remote writes, including the preview, for the rest of this
  turn. If the user picks "No, something else", stop and help with what they describe
  instead.

### Confirming the skill

When RefDemo wasn't mentioned, phrase the question so a solution consultant who has never
heard of RefDemo understands it. For example: "Do you want me to set up your DA demo site
with the RefDemo skill? It copies the standard DA demo content (N pages and files, images,
block library, structured content and settings) into <org>/<site> and previews it." Ask it
after the dry run, so the counts are real. The dry run is read-only and safe to run before
confirming.

If a write is blocked by the platform's remote-content safety guard, do not retry it and do
not work around it. Tell the user the copy was blocked because their message didn't
explicitly ask for it (it's not a permission error), and give them the exact wording from
the guard's message to send.

### 4. Replicate

```bash
node .claude/refdemo/scripts/replicate-refdemo.mjs --target <org>/<site> --on-conflict <overwrite|skip>
```

Preview runs by default. Add `--no-preview` when the user chose "Replicate only, no preview",
or said not to preview. Never publish (go live) as part of this skill. Publishing is a
separate, explicit request.

Before each upload, the script saves pages locally as `content/<path>.plain.html` and sheets
as `content/<path>.json`, so the local preview matches Document Authoring. It then uploads
from those files, reads every file back from the target and compares it, and then previews
everything. Timeout: allow up to 10 minutes.

The run ends with a `=== Links ===` block, also saved as `links` in the report:
- `daSite`: `https://da.live/#/<org>/<site>`, the site in Document Authoring
- `editHome`: the home page in the editor its `editor.path` mapping selects (for example
  `https://da.live/canvas#/<org>/<site>/index`)
- `previewHome`: `https://main--<site>--<org>.aem.page/`, and `homePreviewed` says whether
  the preview succeeded
- `liveHome`: `https://main--<site>--<org>.aem.live/`, which stays unpublished

Exit codes: `0` success; `2` some files failed, didn't match on read-back, or failed to
preview (listed in `failures`, `verify.mismatched` and `preview.failed`); `1` fatal error.

### 5. Handle partial failures

- **401 or 403 from admin.da.live or admin.hlx.page on everything**: credentials aren't reaching
  the services. Tell the user to open **Settings → LLM Permissions** and turn on "Allow LLM to
  use my Adobe credentials for admin.hlx.page and Document Authoring uploads". Never ask for a
  token in chat. After they confirm, rerun step 4. The script is idempotent: identical files
  are reported as `unchanged` and not uploaded again.
- **Some files failed**: rerun step 4 once. Report any that still fail.
- **`orgConfig.error`** (no CONFIG write on the org): not fatal. The editor mappings are already
  in the site configuration. Tell the user an org admin can add the rows listed in the report
  to the org configuration.
- **`edsHeaders.error`** (not a site admin): not fatal. Tell the user a site admin needs to add
  the listed headers.
- **Preview failures** (`preview.failed`): read `migration-work/preview-publish/last-job.json`
  before explaining. The script already retried anything that failed with a server error, one
  path at a time. A 401 or 403 on every path means the user can't preview this site: they need
  the publish or author role on the Edge Delivery site. The content is still in Document
  Authoring. A 502 `AEM_BACKEND_FETCH_FAILED` means Edge Delivery couldn't fetch from the
  content source in the site configuration. To retry only the preview, rerun step 4. Copied
  files are `unchanged`, so only the preview runs again.

### 6. Report to the user

Keep it short and plain; the readers are mostly Adobe solution consultants, not developers.
Say "DA demo site" and "DA demo content". Don't mention scripts, file paths, localhost, tool
names, dry runs or report fields. Start with "Your DA demo site is ready" (or what went
wrong) and the links from the `links` block, as clickable URLs:

- **Open in Document Authoring:** `links.daSite`
- **Edit the home page:** `links.editHome`
- **Preview the home page:** `links.previewHome` (if `homePreviewed` is false, say the preview
  didn't succeed instead of presenting it as working)

Then cover:

- what was copied: number of pages and documents, assets, schemas, and the configuration
  items, with any files skipped or failed
- what was previewed: `preview.pages` pages, `preview.sheets` sheets, `preview.assets` assets,
  and any that failed
- which surfaces changed: **local workspace** (pages and sheets), **Document Authoring**
  (content, site configuration, org editor mappings if added), **Edge Delivery site
  configuration** (headers, if changed), **Edge Delivery preview** (unless `--no-preview`),
  **live** (never; publishing is a separate request)
- that images published on the base site still load from it (see link rewriting above)
- that the AEM Assets repository and IMS org in the site configuration were copied as-is, so
  authors need access to that AEM author to use the asset picker

## Options reference

| Option | Default | Purpose |
|---|---|---|
| `--target <org>/<site>` | required | Site to replicate into |
| `--source <org>/<site>` | `aemxsc/refdemo-da` | Base site |
| `--dry-run` | off | Read-only plan |
| `--on-conflict overwrite\|skip` | `overwrite` | Existing target files that differ |
| `--local-dir <dir>` | `content` | Local mirror of pages and sheets (`""` to disable) |
| `--no-org-config` | off | Don't append editor mappings to the target org config |
| `--no-eds-headers` | off | Don't merge Edge Delivery custom headers |
| `--no-preview` | preview on | Skip previewing pages, sheets and assets on `aem.page` |
| `--report <file>` | `migration-work/refdemo-replication/report.json` | Report location |
| `--concurrency <n>` | `4` | Parallel requests |
| `--force-target` | off | Skip the content-source check (explicit request only) |

Auth: on aemcoder, credentials are injected automatically once the user enables the opt-in.
Outside aemcoder, the script sends `DA_TOKEN` (IMS access token) from the environment, if set,
as a Bearer token. Never print or log it.

## Guarantees

- Read-only on the base site. Refuses to run with the base site as the target.
- Idempotent: rerunning uploads only what differs.
- Merges configuration and never replaces it: target-only rows, sheets and permissions are
  kept. The org configuration only ever gets `editor.path` rows appended.
- Every uploaded file is read back and compared.
- Previews, never publishes.

## Limitations

- Sites whose content source is the Helix 6 source API (`https://api.aem.live/<org>/sites/<site>/source`)
  aren't supported. The script stops at the content-source check.
- Version history of the base site isn't copied, only current content.
- Hidden page-image folders are found by probing `.<page>` next to each page (DA hides
  dot-folders from listings). Images stored in other hidden folders aren't found.

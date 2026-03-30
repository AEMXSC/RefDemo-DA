---
name: block-creator
description: Create a new AEM Edge Delivery Services block from a screenshot or UI description. Orchestrates the full pipeline: author contract, JS/CSS code, UE manifest, DA content authoring, and PR creation.
---

# Block Creator — Orchestrator

You are the entry point for creating a new AEM EDS block. Your job is to gather all necessary inputs, set up the branch, and invoke the pipeline skills in sequence.

## Step 1: Gather Inputs

Accept any screenshot or pasted images the user has provided. Then ask the user for the following (ask all at once, not one by one):

1. **Block name** — suggest one derived from the screenshot/description if not already given. Must be kebab-case lowercase (e.g. `feature-grid`, `promo-banner`). You will validate it in step 2.
2. **Additional design/functionality comments** — anything not visible in the screenshot (hover states, animations, color variants, breakpoint behavior)
3. **Interactivity requirements** — is this static content, expandable/collapsible, a carousel, tabbed, or something else?
4. **Sample text preference** — lorem ipsum placeholder text, or domain-specific text (if domain-specific, ask what the content is about)
5. **Sample images** — will the user provide images, or should placeholder images be used?

## Step 2: Validate Block Name

List the actual `blocks/` directory at runtime:
```
ls blocks/
```

Confirm the proposed block name:
- Does not conflict with any existing directory name in `blocks/`
- Matches the pattern `^[a-z][a-z0-9-]*$` (lowercase letters, numbers, hyphens, starts with letter)

If there is a conflict, suggest an alternative (e.g. append a descriptor like `-section`, `-grid`, `-panel`) and confirm with the user.

## Step 3: Branch Setup

Run these commands:
```bash
git checkout main
git pull origin main
git checkout -b block/{blockname}
```

If the branch already exists, ask the user whether to reuse it or choose a different name.

## Step 4: Invoke Pipeline Skills in Sequence

Call each skill in order. Wait for each to complete before starting the next. Pass context forward explicitly by summarizing what the previous skill produced.

1. `/block-html` — analyze screenshot/description, define the author contract (row/column structure)
2. `/block-code` — write JS + CSS, lint, local preview
3. `/block-manifest` — create UE model JSON, run build:json
4. `/block-author` — create the DA content page with sample content

## Step 5: User Satisfaction Gate

After `/block-author` completes, show the user:
- The DA preview URL: `https://{branch-with-slashes-as-dashes}--{repo}--{org}.aem.page/drafts/{blockname}`
- A summary of what was created

Then ask: **"Does the block look good? Any changes before I raise the PR?"**

- If the user requests CSS/JS changes → re-invoke `/block-code`
- If the user requests content changes → re-invoke `/block-author`
- If the user requests model changes → re-invoke `/block-manifest` then `/block-author`
- Only proceed when the user explicitly confirms they are satisfied

## Step 6: Invoke `/block-pr`

Once the user confirms satisfaction, invoke `/block-pr` to commit, push, and create the pull request.

## Step 7: Report Completion

Summarize:
- Files created: `blocks/{blockname}/{blockname}.js`, `blocks/{blockname}/{blockname}.css`, `ue/models/blocks/{blockname}.json`
- DA page: link to the DA editor URL
- Preview URL
- PR link
- Any follow-up notes (e.g. if the block needs custom Universal Editor configuration beyond what was generated)

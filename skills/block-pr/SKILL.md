---
name: block-pr
description: Run final lint, commit all block files and manifests, push to the feature branch, and create a GitHub PR with the mandatory preview link.
---

# Block PR — Commit, Push, and Pull Request

Your job is to finalize the block, commit all files, push to the feature branch, and create a GitHub pull request. This skill is only invoked after the user has confirmed they are satisfied with the block.

## Step 1: Final Lint Check

```bash
npm run lint
```

This must pass cleanly before committing. If there are errors, fix them first — do not commit with lint failures.

## Step 2: Review What Will Be Committed

```bash
git status
git diff --stat
```

Expected files to stage:
- `blocks/{blockname}/{blockname}.js`
- `blocks/{blockname}/{blockname}.css`
- `ue/models/blocks/{blockname}.json`
- `component-definition.json`
- `component-models.json`
- `component-filters.json`

Do NOT stage:
- `drafts/{blockname}.html` — this is temporary test content, not to be committed
- Any other unrelated files

If you see unexpected changes, investigate before staging.

## Step 3: Stage and Commit

Stage only the block and manifest files:
```bash
git add blocks/{blockname}/
git add ue/models/blocks/{blockname}.json
git add component-definition.json component-models.json component-filters.json
```

Commit:
```bash
git commit -m "$(cat <<'EOF'
feat: add {blockname} block

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

## Step 4: Push

```bash
git push -u origin block/{blockname}
```

## Step 5: Get Repo Info for the Preview URL

```bash
gh repo view --json nameWithOwner
git branch --show-current
```

Construct the preview URL:
- Replace `/` with `-` in the branch name
- Format: `https://{branch-dashes}--{repo}--{owner}.aem.page/drafts/{blockname}`

## Step 6: Create the Pull Request

**The PR will be rejected without a preview link.** This is a hard requirement per AGENTS.md.

```bash
gh pr create --title "feat: add {blockname} block" --body "$(cat <<'EOF'
## Summary
- New `{blockname}` block: {one-line description of what this block does}
- {key feature or behavior}
- {any notable design decision}

## Author Contract
| Row | Col 1 | Col 2 | ... |
|-----|-------|-------|-----|
{author contract table rows}

## Preview
https://{branch-dashes}--{repo}--{owner}.aem.page/drafts/{blockname}

## Files Changed
- `blocks/{blockname}/{blockname}.js` — block decoration logic
- `blocks/{blockname}/{blockname}.css` — block styles
- `ue/models/blocks/{blockname}.json` — Universal Editor model
- `component-definition.json`, `component-models.json`, `component-filters.json` — merged manifests

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

## Step 7: Check PR Status

```bash
gh pr checks
```

Report the results. If any checks fail:
- Lint failures — fix and push a new commit
- Code sync issues — usually resolve automatically; wait and recheck
- Performance issues — investigate with PageSpeed Insights against the preview URL

## Step 8: Report

Return:
- PR URL
- Preview URL
- `gh pr checks` status summary

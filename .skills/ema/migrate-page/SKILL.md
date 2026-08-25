---
name: migrate-page
description: Migrate a web page to AEM Edge Delivery Services. Extracts page structure, decomposes into blocks, generates EDS-compatible code, and verifies with visual comparison.
allowed-tools: bash
---

# EDS Page Migration

Migrate a web page into AEM Edge Delivery Services: extract structure,
decompose into blocks, generate EDS-compatible code per block, and verify
each with visual comparison.

## Orchestration model

This skill is the **orchestrator's** job: the top-level agent runs Phases 1, 2,
2.5, and 4 itself, and in Phase 3 fans out **one subagent per block** (each
subagent runs `migrate-block`, or `migrate-header` for the header). Subagents
cannot spawn subagents, so the orchestrator owns the whole flow.

## Invocation

Triggers: "migrate this page", "convert to EDS", "create EDS blocks from URL".
The user provides a **source URL** and a **GitHub repo** (`owner/repo`). If the
repo is not given, ask for it before starting Phase 1.

Progress reporting (optional): emit a short status line at each phase transition
— `extraction → decomposition → blocks (done/total) → assembly → done`, or
`error: <message>` on failure.

## Four Phases

1. **Extraction** — clone the repo, navigate to the URL, run extraction scripts
2. **Decomposition** — classify the visual tree into fragments/sections/blocks
3. **Block Generation** — dispatch one subagent per block, wait until all complete
4. **Assembly** — collect results, build the page, (optionally) commit

---

## Phase 1: Extraction

User provides a URL and a GitHub repo (owner/repo).

### Step 1.1: Clone and Branch

Clone the repo and create a migration branch:

```
bash: git clone https://github.com/{owner}/{repo}.git {repo-dir}
bash: cd {repo-dir} && git checkout -b migrate/{page-slug}-{timestamp}
bash: mkdir -p {repo-dir}/.migration
```

Where `{repo-dir}` is the local clone directory (the repo name), `{page-slug}` is derived
from the URL path (e.g., `/products/widget` → `products-widget`), and
`{timestamp}` is a short identifier (e.g., `Date.now().toString(36)`).

### Step 1.2: Navigate to Source Page

Open `{sourceUrl}` in a new browser tab; keep the tab handle for all Phase-1 steps.

### Step 1.3: Dismiss Overlays (opt-in, skipped by default)

**Skip this step unless the user explicitly requested overlay dismissal**
(e.g., "dismiss overlays", "handle cookie banners", "remove consent dialogs").

If requested, run the **dismiss-overlays** skill on the source tab to clear
cookie banners, consent dialogs, and other overlays. It handles its own visual
verification and cleanup.

### Step 1.4: Lazy-Load Scroll

Scroll the page top-to-bottom to trigger lazy-loaded images and sections:

Evaluate `slicc-migration/migrate-page/scripts/lazy-load-scroll.js` in the page.

### Step 1.5: De-Sticky

Convert `position: fixed` elements to `position: relative` so they don't
overlap content in the visual tree or full-page screenshot:

Evaluate `slicc-migration/migrate-page/scripts/de-sticky.js` in the page.

### Step 1.6: Extract Visual Tree

Run the visual tree extraction and save directly to file:

Evaluate `slicc-migration/migrate-page/scripts/visual-tree.js` in the page and
save its JSON result to `{repo-dir}/.migration/visual-tree.json`.

### Step 1.7: Full-Page Screenshot

Capture the page after all preparation. This is the only screenshot used
by downstream phases (decomposition, visual comparison):

Take a full-page screenshot (~1440px wide) to `{repo-dir}/.migration/screenshot.png`.

Verify the file exists and has a reasonable size (>10 KB).

### Step 1.8: Extract Brand Data

Evaluate `slicc-migration/migrate-page/scripts/brand-extract.js` in the page and
save its JSON result to `{repo-dir}/.migration/brand.json`.

### Step 1.9: Extract Metadata

Evaluate `slicc-migration/migrate-page/scripts/metadata-extract.js` in the page and
save its JSON result to `{repo-dir}/.migration/metadata.json`.

### Step 1.10: Scan Block Inventory

Scan the project's blocks directory and save the inventory:

```bash
node slicc-migration/migrate-page/scripts/block-inventory.js {repo-dir}
```

This writes `block-inventory.json` to `.migration/` and prints a summary
(block count and names) to stdout.

### Extraction Artifacts

After Phase 1, these files exist in `{repo-dir}/.migration/`:

| Artifact | Purpose |
|----------|---------|
| `screenshot.png` | Full-page screenshot after prep (for decomposition) |
| `visual-tree.json` | Spatial hierarchy (bounds, backgrounds, selectors) |
| `brand.json` | Fonts, colors, spacing |
| `metadata.json` | Title, description, OG tags |
| `block-inventory.json` | Existing blocks in the EDS project |

---

## Phase 2: Decomposition

Read `visual-tree.json` and `screenshot.png`. The visual tree is used ONLY
for decomposition (identifying what regions exist and classifying them). It
is NOT used for content extraction — subagents extract content from the live
page in Phase 3.

### Visual Tree Format

```
{id} [{role/tag}] [{CxR}] [{bg:type}] @{x},{y} {w}x{h} "{text}"
```

Hierarchy via 2-space indentation. `{id}` is a positional identifier
(e.g., `rc1c2`). `[CxR]` = columns x rows layout. `[bg:type]` =
background signal.

### Classification Rules

**THE TYPING TEST:** Can an author create this in Word/Google Docs?
- YES → `default-content`
- NO → `block`

**Layout rule:** `[CxR]` with C >= 2 → MUST be `block`.

**Background rule:** Background transitions signal section boundaries.

**Reserved names:** NEVER use "header" or "footer" as block names.

### Three Fragments

Every page decomposes into exactly 3 fragments:
1. `/nav` — header/navigation
2. `/{page-path}` — main content
3. `/footer` — page footer

### Output

Write `decomposition.json` to `{repo-dir}/.migration/`:

```json
{
  "url": "https://example.com/page",
  "fragments": [
    {
      "path": "/nav",
      "children": [
        { "type": "block", "name": "nav-bar", "id": "rc1",
          "bounds": { "x": 0, "y": 0, "width": 1440, "height": 80 } }
      ]
    },
    {
      "path": "/page",
      "children": [
        { "type": "section", "style": "highlight", "children": [
          { "type": "block", "name": "hero", "id": "rc2c1" },
          { "type": "default-content", "id": "rc2c2" }
        ]},
        { "type": "block", "name": "cards", "id": "rc3" }
      ]
    },
    {
      "path": "/footer",
      "children": [
        { "type": "block", "name": "footer-links", "id": "rc4" }
      ]
    }
  ]
}
```

### Close Source Tab

The source tab is no longer needed — all subsequent phases work from extracted
artifacts, not the live page. Close it to free resources.

---

## Phase 2.5: Prepare Brand, Fonts, and Styles

Set up brand, fonts, and styles BEFORE dispatching subagents in Phase 3, so their
preview pages load with correct fonts, colors, and spacing.

### 2.5a: Resolve Fonts

1. Read `.migration/brand.json` — check `fonts.sources.typekit` and
   `fonts.sources.googleFonts`
2. Resolve font delivery using this cascade (first match wins):

   **a. Source has Adobe Fonts (Typekit)?**
   If `fonts.sources.typekit` is not null → use the source's kit directly.
   The source's kit has the exact fonts the page uses and works in preview.
   Link: `https://use.typekit.net/{fonts.sources.typekit}.css`

   **b. Source has Google Fonts?**
   If `fonts.sources.googleFonts` has URLs → use those URLs directly.

   **c. Font in our fallback Typekit kit `cwm0xxe`?**
   Check: `https://typekit.com/api/v1/json/kits/cwm0xxe/published`
   (public API, no auth). If the font family appears → use kit `cwm0xxe`.
   Link: `https://use.typekit.net/cwm0xxe.css`

   **d. Font available on Google Fonts?**
   Check: `https://fonts.googleapis.com/css2?family={FontName}:wght@400;700&display=swap`
   If 200 OK → use that URL.

   **e. System font fallback**
   Use the extracted font name with generic fallback (serif/sans-serif).

### 2.5b: Update head.html

Read `{repo-dir}/head.html`. Add font `<link>` tags BEFORE the
existing `<script>` tags based on the cascade result:

- Adobe Fonts: `<link rel="stylesheet" href="https://use.typekit.net/{projectId}.css">`
- Google Fonts: preconnects + `<link href="{url}" rel="stylesheet">`

Write the updated `head.html` back.

### 2.5c: Generate brand.css

Write `{repo-dir}/styles/brand.css` with brand values from
`brand.json`:

```css
:root {
  --heading-font-family: "{resolved heading font}", serif;
  --body-font-family: "{resolved body font}", sans-serif;
  --background-color: {brand.colors.background};
  --text-color: {brand.colors.text};
  --link-color: {brand.colors.link};
  --link-hover-color: {brand.colors.linkHover};
  --section-padding: {brand.spacing.sectionPadding};
  --nav-height: {brand.spacing.navHeight};
}

html, body { overflow: auto !important; }
```

### 2.5d: Update styles.css with @import

Read `{repo-dir}/styles/styles.css`. Add `@import url('brand.css');`
as the **VERY FIRST LINE** (CSS spec requires `@import` before all other
rules). Also update `:root` variables to match brand values.

Add a global EDS button reset after `:root`:

```css
main .button-container { display: inline; }
main a.button:any-link {
  background: none; border: none; border-radius: 0;
  color: var(--link-color); font-size: inherit; font-weight: inherit;
  padding: 0; margin: 0; text-decoration: underline; white-space: normal;
}
```

Write the updated `styles.css` back.

Now subagents will preview with correct fonts, colors, spacing, and button
behavior from the start.

---

## Phase 3: Block Generation (parallel subagents)

Dispatch one subagent per **block** and wait until all complete before Phase 4.
Each subagent runs `migrate-block` (or `migrate-header` for the header).

**`default-content` items do NOT get subagents.** They are simple prose
(headings, paragraphs, lists, images) that the orchestrator writes directly
during Phase 4 assembly, extracting the text from the source page.

### Step 1 — Generate block task configs via script

Run the prompt generator. It reads `decomposition.json`, derives the source URL
and project path, and outputs one task config per block as JSON — so the
orchestrator doesn't spend tokens hand-writing repetitive prompts:

```bash
node slicc-migration/migrate-page/scripts/generate-scoop-prompts.js {repo-dir}/.migration
```

Parse the JSON output — an array of `{ name, model, prompt }` objects, one per block.

### How the script works

`generate-scoop-prompts.js` handles all three block types:
- **Header** (nav-bar, header, navigation, or the `/nav` fragment) → `migrate-header`
- **Footer** (footer, footer-links, footer-content, or the `/footer` fragment) → `migrate-block` (footer special case)
- **All other blocks** → `migrate-block`

Each generated prompt includes the block parameters, the head.html content, and
instructions to read the appropriate skill. Use the prompts exactly as returned.

### Step 2 — Dispatch all block subagents

Dispatch one subagent per config, in a single batch, using each `prompt`
verbatim (and `model` if your harness supports per-task models). Run them in
parallel.

### Step 3 — Collect results

Each subagent returns a JSON report:

```json
{
  "done": true,
  "blockName": "hero",
  "status": "success|partial|failed",
  "iterations": 2,
  "files": { "css": "...", "js": "...", "plainHtml": "..." },
  "issues": []
}
```

1. Track the expected block names from the configs.
2. As each subagent returns, parse its JSON and record `status`, `files`, and
   `issues` — you need `files.plainHtml` in Phase 4 assembly.
3. **Stuck-block fallback:** if a subagent fails to return but its
   `.plain.html` exists on disk (`ls {repo-dir}/drafts/{blockName}.plain.html`),
   treat it as `partial`; if the file is missing, mark it `failed`.
4. Do NOT proceed to Phase 4 until every block is accounted for.

---

## Phase 4: Assembly — MANDATORY STEPS

After ALL blocks complete, the orchestrator MUST execute ALL of the following steps.
Do not skip any. Phase 4 is not optional — it produces the final deliverables.

**Keep every block's output files** for user review.

### Step 4.1: Collect Block Results

Use the reports collected during Phase 3. For each block, you already have
`status`, `files`, and `issues` from the subagent's returned JSON.

If reports were requested and exist in `{repo-dir}/.migration/reports/`,
read them for additional detail (EDS verification, visual verification,
design tokens). Otherwise, the completion messages have everything needed
for assembly.

List any blocks with `status: "failed"` or that required the stuck-block
fallback — flag these in the final summary.

### Step 4.2: Verify Brand Setup

`brand.css`, `styles.css`, and `head.html` were already updated in
Phase 2.5. Verify they are correct:

- `styles/brand.css` exists with `:root` variables
- `styles/styles.css` has `@import url('brand.css');` as FIRST LINE
- `styles/styles.css` has the global button reset
- `head.html` has Typekit/Google Fonts `<link>` tags

If anything is missing (Phase 2.5 was skipped or failed), do it now:

### Step 4.3: Assemble Page Content — MANDATORY

Write the main page to `{repo-dir}/drafts/{page-path}.plain.html`.

Read each block's `.plain.html` file and combine them into sections
following the decomposition order:

```html
<div>
  <div class="hero">
    <!-- paste hero block's .plain.html content -->
  </div>
</div>
<div>
  <div class="cards">
    <!-- paste cards block's .plain.html content -->
  </div>
</div>
```

**Rules:**
- Each section is a top-level `<div>`
- Blocks inside sections: `<div class="blockname">` with the content
  from the block's `.plain.html` (copy the block div, not the section wrapper)
- Section styles from decomposition → add `<div class="section-metadata">`
- Images use `/drafts/images/` root-relative paths
- Default-content items (from decomposition): extract from source page
  and write as plain HTML (headings, paragraphs, lists) in their section
- Do NOT include a `<div class="metadata">` block with nav/footer paths.
  That block is only needed for the DA upload pipeline (EDS HTML → meta tags
  conversion) and will be added at DA upload time. For local preview, the
  `<meta name="nav">` and `<meta name="footer">` tags in the preview HTML
  handle fragment loading.

### Step 4.4: Create Full Preview Page — MANDATORY

Write `{repo-dir}/drafts/{page-path}-preview.html`:

```html
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="nav" content="/drafts/nav">
  <meta name="footer" content="/drafts/footer">
  {PASTE <script> AND <link> TAGS FROM head.html}
  <style>html, body { overflow: auto !important; }</style>
</head>
<body>
  <header></header>
  <main>
    {PASTE THE CONTENT OF THE ASSEMBLED .plain.html}
  </main>
  <footer></footer>
</body>
</html>
```

Serve the project and open the preview page:

```bash
cd {repo-dir} && aem up      # serves http://localhost:3000
```

Open `http://localhost:3000/drafts/{page-path}-preview.html` in a browser tab;
keep the tab handle.

Wait for all blocks to load before screenshotting. The page has header
(fragment load) + multiple content blocks + footer (fragment load) — these
load asynchronously. Verify with:

Evaluate in the page:

```js
JSON.stringify({ blocks: document.querySelectorAll('[data-block-status="loaded"]').length, appear: document.body.classList.contains('appear') })
```

Wait until all expected blocks show `status: "loaded"`. Then take the screenshot:
Take a full-page screenshot (~1440px wide) to `{repo-dir}/.migration/preview-assembled.png`.

### Step 4.5: Git Commit — OPT-IN

**Skip this step unless the user explicitly requested a commit** (e.g.,
"commit the result", "commit when done", "auto-commit"). If skipped,
mention in the final summary that changes are uncommitted and ready for
review.

```bash
git add blocks/ styles/ drafts/
git commit -m "feat: migrate {page-path} from {source-domain}"
```

### Step 4.6: Final Summary

Report to the user:
- Number of blocks migrated and their statuses
- Visual verification results per block (from reports)
- Brand.css and styles.css: what was updated
- Assembled page preview URL
- Any issues, gaps, or incomplete items
- Path to all reports in `.migration/reports/`

---

## Reference: Four Content Models

1. **Standalone** — One-off (hero, blockquote): single row, mixed cells
2. **Collection** — Repeating items (cards, carousel): rows = items,
   cells = item parts (image, title, description)
3. **Configuration** — Key-value pairs (blog listing config): 2-column,
   col1 = key, col2 = value. Only for API-driven content.
4. **Auto-Blocked** — Authors write standard content, pattern detection
   creates block (tabs, accordion). Rare in migration.

Use Standalone or Collection for most blocks. NEVER use Configuration
for static content.

## Reference: Quality Criteria

| Criterion | Target |
|-----------|--------|
| Block visual similarity | >= 85% acceptable, >= 95% ideal |
| Header visual similarity | >= 85% (interactive states differ) |
| Max iterations per block | 3 |
| Max iterations for header | 5 |
| .plain.html format | NO html/head/body/script tags |
| CSS scoping | All rules under .blockname |
| Header CSS scoping | All rules under .header.block |
| Responsive | At least one breakpoint (900px) |
| Images | <picture><img> with alt text |
| Report schema | Exact schema, no extra keys |

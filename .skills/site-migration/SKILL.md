---
name: site-migration
description: >
  End-to-end orchestrator for migrating an existing website — a single page OR a
  whole site/section — into this AEM Edge Delivery (EDS/DA) project with FAITHFUL
  design AND a preserved information architecture. Defines migration scope up
  front (whole site / named sections / top-level pages only), persists an IA
  ledger mapping every source path to its migrated target path, rewrites internal
  links so migrated pages link to each other (not back to the source site),
  bootstraps the starting pages through main content + header/footer + a
  design-token-accurate fidelity pass + an objective diff gate (run at 1080p AND
  2K, local draft AND deployed preview URL) + a two-part deploy (code to git,
  content to DA), then fans out subagents to migrate remaining subpages in the
  same per-page flow while preserving each page's nested URL path. Use when the
  user wants to "migrate a site/page", "clone <site>'s design into AEM",
  "rebuild <url> as an EDS page", "migrate the whole site", "port <site>'s
  section into AEM keeping the folder structure", "make this page look like
  <live site>", "uplift/refresh a page from a URL", or asks to import a page or
  site AND match its look. Chains the page-import, migrate-header,
  da-content/da-auth, and stardust:diff skills, reuses stardust:rollout's
  wave/ledger batch-execution model for multi-page fan-out, and folds in
  hard-won migration gotchas (see the Gotchas section below).
license: Apache-2.0
metadata:
  version: "2.3.0"
---

# site-migration — full-page and full-site migration with design fidelity + IA

Migrate one page, a section, or a whole site from a source website into this EDS
project so every page is **content-complete, design-faithful, structurally
correct (information architecture preserved and cross-linked), and deployed**.
This is an orchestrator: it sequences existing sub-skills and layers on scope
definition, IA persistence + link rewriting, fidelity/validation/deploy steps,
and a subagent batch model for sites bigger than one page.

## When to use

- "Migrate `<url>` into `/path`" / "rebuild this page in AEM" / "make our page
  look like `<site>`" — single page, run Part A only.
- "Migrate the whole site" / "port the `<section>` of `<site>` into AEM keeping
  its structure" / "migrate every page under `/products`" — multi-page, run
  Part A (bootstrap) then Part B (batch fan-out).
- Any port where the goal is BOTH canonical EDS authoring AND matching the
  source's look (hero, nav, footer, tokens, per-block design), for one page or many.

**Not for:** byte-for-byte DOM overlays (use `snowflake`), a from-scratch
compositional redesign that needs a generated canon/module-catalog/design-token
system (use stardust/ema's full `extract → direct → prototype → migrate`
cascade), or building brand-new blocks with no source to port from
(`building-blocks`). Multi-page mode here reuses `stardust:rollout`'s proven
wave/ledger execution model for the batch step, but stays a lightweight 1:1-port
tool — it does not adopt `stardust`'s `DESIGN.json`/canon/module-catalog state
machine. If the job actually needs a new design system generated (not a faithful
port), hand off to `stardust:prepare-migration` + `stardust:rollout` instead.

## Sub-skills this orchestrates (repo paths)

| Phase | Skill | Path |
|---|---|---|
| Import main content | `page-import` | `.skills/adobe/aem/edge-delivery-services/page-import/` |
| Header (+ mega-menu) | `migrate-header` | `.skills/ema/migrate-header/` |
| Design craft (optional) | `impeccable` | `.skills/impeccable/` |
| Fidelity diff gate | `diff` (`stardust:diff`) | `.skills/stardust/diff/` |
| DA auth / upload rules | `da-auth`, `da-content` | `.skills/adobe/aem/edge-delivery-services/da-auth/`, `.../da-content/` |
| Batch execution model (reference only — mechanics, not the state machine) | `rollout` Phase A/C | `.skills/stardust/rollout/SKILL.md` |

> NOTE: several sub-skill SKILL.md files reference paths like `.claude/skills/...`; the
> ACTUAL location in this repo is `.skills/...`. Translate accordingly.

## Environment prerequisites (verify first)

- `node -v` (18+), `@adobe/aem-cli` available (`aem up` or `npx -y @adobe/aem-cli`).
- Dev server for local preview: `npx -y @adobe/aem-cli up --no-open --forward-browser-logs --html-folder drafts` (background). Un-authored test content lives in `drafts/` and serves at `/drafts/<name>` (nested paths serve at `/drafts/<section>/<name>`).
- **Playwright lives in** `.skills/adobe/aem/edge-delivery-services/scrape-webpage/scripts/node_modules`. ESM resolves `import 'playwright'` from the script's own dir, so put any `.mjs` browser/diff script INSIDE that dir and run it there; clean up temp scripts after.
- `npm install` at repo root before `npm run lint`.
- This skill ships three local scripts under `scripts/`: `build-da.mjs` (DA
  transform template, Phase 6), `typography-diff.mjs` (block-by-block font
  fidelity probe, Phase 4/5), and `block-diff.mjs` (block-by-block width /
  text-overlay / link-button UX / icon fidelity probe, Phase 4/5) — copy
  whichever you need into the playwright scripts dir per the rule above.

---

## Phase 0 — Define & confirm migration scope

**Gate: do not start importing before this is confirmed with the human.** Scope
drives everything downstream (how many pages, whether IA persistence and batch
fan-out are even needed).

1. Determine the scope mode with the user — one of:
   - **Whole site** — every page reachable from the source's sitemap/nav.
   - **Named section(s)** — e.g. "everything under `/products`", "the support
     section".
   - **Top-level pages only** — just the pages linked from the primary nav
     (no deep subpages).
2. Enumerate candidate URLs for the chosen scope:
   - Prefer `<source>/sitemap.xml` if it exists (`curl` it).
   - Fall back to crawling the header/footer nav links captured in Phase 2
     (below) plus in-page links found during Phase 1 of each bootstrapped page.
   - For "named section(s)", filter the above to URLs whose path starts with
     the named prefix(es).
3. **Confirm the resulting page list (and page count) with the user before
   proceeding** — a full-site crawl can surface far more pages than expected;
   don't silently commit a large subagent batch to a scope no one signed off on.
4. Persist the confirmed scope to `migration/scope.json`:
   ```json
   {
     "mode": "section",
     "sections": ["/products"],
     "sourceRoot": "https://example.com",
     "pathRewrite": [],
     "pages": [
       { "url": "https://example.com/products", "path": "/products" },
       { "url": "https://example.com/products/phones", "path": "/products/phones" }
     ]
   }
   ```
   `pathRewrite` is only populated when the target path must diverge from the
   source path (e.g. migrating a subsection under a new root) — record the rule
   explicitly rather than improvising it per page.
5. If scope resolves to exactly one page, skip straight to Part A and ignore
   Part B entirely — this collapses back to the original single-page flow.

## Phase 0.5 — Information architecture (IA) map

The single biggest way multi-page migrations silently go wrong: nested source
paths get flattened (`/products/phones/pixel` lands at `drafts/pixel.plain.html`)
or renamed inconsistently. EDS has no filesystem — a document's URL path IS its
identity — so the IA map must be decided once, up front, and then followed
mechanically by every phase and every subagent. This ledger is also the input
the Link rewrite rule (below) keys off, so it must exist before any page's
content is imported — including the bootstrap pages in Part A.

1. For every page in `migration/scope.json`, derive:
   - `sourcePath` — the normalized source URL path (strip query/hash).
   - `targetPath` — same as `sourcePath` unless a `pathRewrite` rule applies.
     Apply AEM-Edge path-safety normalization while deriving it: lowercase,
     no trailing `-`/`_`, no `--` segment, no trailing slash. Record any
     source→normalized change in `migration/redirects.tsv` (`sourcePath<TAB>targetPath`)
     so nothing silently 404s later.
   - `draftPath` — `drafts/<targetPath minus leading slash>.plain.html`, i.e.
     nested source paths become nested directories under `drafts/`
     (`/products/phones/pixel` → `drafts/products/phones/pixel.plain.html`).
     Create the intermediate directories; don't collapse them.
   - `parent` — the immediate parent path, if any (used to check every
     directory-with-children has a landing/index page at that exact path).
2. Persist to `migration/site-map.json` — one row per page, the ledger every
   later phase reads and writes:
   ```json
   { "sourceUrl": "...", "sourcePath": "/products/phones/pixel",
     "targetPath": "/products/phones/pixel",
     "draftPath": "drafts/products/phones/pixel.plain.html",
     "parent": "/products/phones", "role": "leaf",
     "status": "scoped" }
   ```
   `status` progresses `scoped → imported → validated → preview-ready → deployed
   | failed`. This ledger is the single source of truth for what's done — never
   re-derive progress by re-crawling. `targetPath` is fixed the moment this
   phase runs — it does NOT change when the row's `status` later advances.
3. Mark each page's `role`: `home`, `section-index` (a page with children under
   its own path), or `leaf`. Section-index pages must exist for every distinct
   `parent` value that appears — flag any missing one now (the source may 404
   on its own section root; decide with the user whether to synthesize a
   minimal landing page or link straight to the first child).

4. **Detect duplicate content before finalizing the ledger.** The same source
   article is sometimes reachable from two different paths (e.g. cross-referenced
   under two taxonomy branches) — check scoped pages for duplicates (same H1 +
   near-identical body) before assigning target paths. Migrate the content ONCE
   to a single `targetPath`, and record every duplicate as an `aliasSourcePaths`
   entry on that same row so the Link rewrite rule repoints all of them
   consistently instead of creating duplicate migrated pages.

## Link rewrite rule — migrated pages link to migrated pages

Once `migration/site-map.json` exists, **every internal link authored anywhere
in the migration — page content, nav, footer — must point at the migrated
target, not the original source site.** This applies the moment a page's
`targetPath` is reserved (Phase 0.5), not only once that page is deployed: a
link to a not-yet-imported sibling can and must still be rewritten correctly,
because the path is already deterministic.

For every `<a href>` encountered while authoring (Phase 1 imports, Phase 2
nav/footer, and every Part B subagent's own Phase 1):

1. Resolve the href to an absolute URL against the source root, strip
   query/hash, and normalize the path the same way Phase 0.5 does.
2. Look up the normalized path against `sourcePath` in `migration/site-map.json`.
3. **Match found (in scope)** → rewrite the href to that row's `targetPath`,
   root-relative (e.g. `/products/phones/pixel`), regardless of the row's
   current `status` — the path is already reserved even if unmigrated yet.
   Preserve any hash fragment (`/products#warranty`).
4. **No match (out of scope)** → leave the href pointing at the original
   absolute source URL — a deliberate bounce, not an oversight. Record it (a
   running list is enough) so Phase 8 can confirm every one is intentional.
5. Leave external-domain links and same-page (`#anchor`-only) links untouched.

Do this inline while authoring each page/fragment — don't defer it to a
clean-up pass; the per-page diff gate (Phase 5/6.5) then measures the page as
it will actually ship.

---

## Part A — Bootstrap the starting pages (single-page recipe)

Run this full recipe on the **starting pages**: the home page plus every
top-level page that defines the primary nav/footer and therefore the header,
tokens, and the first instance of every recurring block. For a single-page job,
"starting pages" is just the one page and Part B never runs. Even for a
single-page job, if that page links to other in-scope pages, Phase 0.5 and the
Link rewrite rule still apply to those links.

**Do not fan out subagents until Part A's Phase 6a (code → git) is merged to
main.** Every block/token/CSS decision made here is inherited by every
subagent in Part B; parallelizing before the foundation is settled means
subagents rediscover the same missing block or wrong token independently.

### Phase 1 — Import main content → `page-import`
Scrape → identify structure → authoring analysis → generate HTML → preview. Output:
`drafts/<page>.plain.html` (+ `drafts/images/`) previewing at `http://localhost:3000/drafts/<page>`.
- Override the auto documentPath to the target from `migration/site-map.json` (e.g. `/about`), not an ad hoc guess — the ledger is authoritative.
- Import MAIN content only; skip header/nav/footer (Phase 2).
- **Rewrite every internal link per the Link rewrite rule above** using `migration/site-map.json` — don't leave in-scope links pointing at the source domain.
- Keep `import-work/` (has `metadata.json` with the **original image URL → local file** map — needed at deploy).

### Phase 2 — Header + footer  → `migrate-header` (+ footer by hand)
Header/footer are global content fragments, not page content. The boilerplate ships
placeholder `/nav` and `/footer` — replace them.
- **Header contract (this project):** `blocks/header/header.js` uses INDEX-based sections —
  `nav.children[0/1/2]` = brand / sections / tools. So `drafts/nav.plain.html` must have
  **exactly 3 top-level `<div>`s and NO `section-metadata`** (metadata divs break the index).
  A nav `<li>` gets `.nav-drop` automatically when it contains a nested `<ul>` (mega menu = `<li><a>label</a><ul>…</ul></li>`).
- **Footer:** `blocks/footer/footer.js` just appends the `/footer` fragment. Author
  `drafts/footer.plain.html` with link columns (`<h3>` + `<ul>`), social icons, legal text.
- **Nav/footer links follow the same Link rewrite rule** — a nav entry for `/products` must
  point at the migrated `/products`, not `https://example.com/products`, as soon as
  `/products` has a reserved `targetPath` in the ledger.
- **Local preview wiring:** add two rows to the page's `metadata` block so header/footer load
  the drafts fragments locally:
  `| nav | /drafts/nav |` and `| footer | /drafts/footer |`.
  **Mark them LOCAL-PREVIEW ONLY** — strip (or repoint to global `/nav`,`/footer`) at deploy.
- While authoring nav, record every nav link's path against `migration/site-map.json` —
  this is a primary source for Phase 0's page enumeration when no sitemap.xml exists.

### Phase 3 — Design tokens  → update `styles/styles.css` `:root`
The single biggest fidelity lever. Extract the source's REAL computed tokens with Playwright
(sample a body link, h1/h2, body text, header bar): `--link-color`, `--link-hover-color`,
brand navy/blue, `--text-color`, heading scale, and font-family names + the hero gradient.
Set them in `:root`. (Fonts are usually domain-locked Typekit → fall back to system on
localhost; set the correct family names anyway, don't chase font rendering.)

**Measure layout tokens across multiple widths, not from a single screenshot.**
Values like a hero's height or a section's `max-width` cap can look right from
one desktop capture and still be wrong. Sample the live source at several
widths (e.g. 1440/1920/2560) before treating a layout-affecting token as final —
a value pinned from a single reference screenshot was corrected later once
measured properly across widths.

### Phase 4 — Fidelity pass  → block CSS + content, per-block to match the source
Work in two passes on every block — **survey the whole page and group every
finding before fixing anything.** Fixing block-by-block as you go hides
duplicate root causes (one wrong token can explain five blocks) and makes it
easy to skip a whole category unreviewed.

**4a. Survey (check).** Walk every block against the source and record
findings under fixed categories, not a flat list:
- **Layout/composition** — hero treatment, link-group column layout vs grid,
  panel/eyebrow treatment, image crop/bleed.
- **Block width** — each block's rendered width (px and % of viewport)
  against the source; a block clamped to a narrower/wider effective
  `max-width` reads as a structural miss even when every token and font matches.
- **Text-overlay position** — for a block with text laid over media (hero,
  promo tiles), the text's anchor zone (top/middle/bottom × left/center/right)
  relative to the media, not just whether overlay text exists.
- **Link/button UX** — does each link render as a BUTTON (background/border,
  or this project's `<strong>`/`<em>` wrap convention — Gotcha #2) or a plain
  link, same as the source; does it carry the source's icon; does it have ANY
  hover/focus feedback at all (a link that lost its hover/focus state is a
  real regression even with the right text and color).
- **Icons** — count of icon-bearing elements per block; a block that dropped
  its icon set reads noticeably flatter even with correct text/color.
  Run `scripts/block-diff.mjs` (Phase 5) for the four bullets above instead
  of eyeballing — use it during the survey, not only at the gate.
- **Typography, per block** — for each block's headings, body copy, links,
  and any rule/divider, compare against the source's computed styles:
  - **Type** — font-family (the actual rendered face, not just the declared name).
  - **Weight** — font-weight.
  - **Line height** — line-height ÷ font-size ratio (a unitless ratio survives
    a font-size change; a raw px comparison doesn't).
  - **Line space** — letter-spacing.
  - **Line weight** — stroke width of any rule the block renders as (divider
    `border`, underline `text-decoration-thickness`, `<hr>`).
  Run `scripts/typography-diff.mjs` (Phase 5) to get this per block instead
  of eyeballing it — use it during the survey, not only at the gate.
- **Color/imagery** — link/brand colors, image treatment (full-bleed vs
  contained).

**4b. Fix, grouped.** Apply fixes in the survey's category order — all
typography fixes together, then all layout fixes, etc. — not block-by-block
in survey order. A shared root cause (a missing `--line-height-tight` token,
a wrong body-copy `font-weight`) usually spans several blocks; fixing by
category closes every instance in one CSS change instead of re-discovering
it per block.

Match the source's design LANGUAGE, not a generic "modern" look. Patterns
that recurred across migrations:
- **Hero:** full-bleed brand-gradient background + white text + white-outline CTA (not a light panel).
- **Link groups:** the source's own layout — often a heading in a LEFT column with links flowing
  **vertically down columns** (`column-count`, not a row-filling grid), chevrons only where the source has them.
- **Eyebrows:** pill badges, not uppercase text.
- **Panels:** tinted/grey rounded containers for notices and grouped tool/utility content (e.g.
  compliance banners, interactive widget panels) — match the source's container treatment, not a generic card.
- **Images:** lifestyle photos full-bleed / un-rounded; product mockups contained & un-cropped.
- **Icons:** add outline SVGs under `icons/` + `<span class="icon icon-NAME">` (decorateIcons renders them).
- **Collapsible sections:** a small `<details>`-based block for legal/expandable panels.
- **Footer:** coloured social icons + accent.
- **Check both breakpoints while crafting, not just at the diff gate** — a layout that's
  faithful at 1080p can develop gaps, mis-wrapped columns, or stretched hero art at 2K
  (wide viewports expose `max-width`/`column-count` assumptions that never show up at
  1920px). See "Gotchas" for WHY section styling must hook off block classes.

### Phase 5 — Validate locally  → `diff` (all probes, both widths)
Copy `.skills/stardust/diff/scripts/*.mjs` and this skill's own
`scripts/typography-diff.mjs` + `scripts/block-diff.mjs` into the playwright
scripts dir and run **all four probes at both widths** — 1080p
(`--width 1920`) and 2K/QHD (`--width 2560`). A 2K-only gap (column layout
re-flowing, hero art stretching, a max-width wrap kicking in differently) is
common and invisible at 1920px, so never skip the second width to save time:
```
node visual-diff.mjs      "<source-url>" "http://localhost:3000/drafts/<page>" --profile eds --width 1920
node visual-diff.mjs      "<source-url>" "http://localhost:3000/drafts/<page>" --profile eds --width 2560
node content-diff.mjs     "<source-url>" "http://localhost:3000/drafts/<page>" --profile eds --width 1920
node content-diff.mjs     "<source-url>" "http://localhost:3000/drafts/<page>" --profile eds --width 2560
node typography-diff.mjs  "<source-url>" "http://localhost:3000/drafts/<page>" --width 1920
node typography-diff.mjs  "<source-url>" "http://localhost:3000/drafts/<page>" --width 2560
node block-diff.mjs       "<source-url>" "http://localhost:3000/drafts/<page>" --width 1920
node block-diff.mjs       "<source-url>" "http://localhost:3000/drafts/<page>" --width 2560
```
- **Pass bar:** at EACH width — visual red flags none/justified AND content-diff 0 structural 🔴
  (🟡/🟠 confirmed) AND typography-diff/block-diff 0 unreviewed DIFF rows (a DIFF is fine once
  you've *decided* it's intentional — e.g. a domain-locked source font falling back locally, or a
  deliberately narrower `max-width` — record why; an unreviewed DIFF is not). A pass at 1920 and
  a fail at 2560 is still a fail; fix and re-run all four.
- **Read the reds critically:** on a content-cleaned migration, expect FALSE 🔴 "MISSING CTA"
  from (a) role classification (source `cta` vs our list links) and (b) stripped `?pid=` tracking
  params in hrefs, plus intentional omissions (hidden legal footnotes). VERIFY each red's text is
  actually absent (`curl <build> | grep`) before "fixing". A rewritten internal link (Link rewrite
  rule) changing the href value is expected and NOT a defect — only text/role changes matter.
- **Caveat:** the probes do NOT catch "heading in the wrong column" (that's role+order intact,
  no colour/stretch flag). **Layout-slot fidelity needs a cropped 1:1 per-section screenshot
  compare** against `import-work/screenshot.png` — do that too, at both widths.
- On pass at both widths, set the page's `migration/site-map.json` `status` to `imported` (not yet `preview-ready` — that's earned after the post-deploy check in Phase 6.5).

### Phase 6 — Deploy (TWO parts — both required)
1. **Code → git (Code Bus).** New blocks (`notice`, `disclaimer`), `icons/*.svg`, and all
   block/`styles.css` changes must land on `main` (branch → PR → merge, per AGENTS.md) so the
   pipeline serves the JS/CSS/icons. Content alone will render unstyled without this.
   **For a multi-page job, this merge is the gate before Part B fans out.**
2. **Content → DA (Content Bus).** Transform drafts → DA source docs (see below), upload,
   preview, publish. Needs an IMS token (`da-auth`) — this is interactive; the sandbox may
   block token handling, so get the user to approve the prompts.

**DA transform rules** (see `da-content` for the full contract; template: `scripts/build-da.mjs`):
- DA docs are **body fragments**: `<body><header></header><main><div>…sections…</div></main><footer></footer></body>` — no doctype/html/head/script/style/inline-style/class on default content.
- **The `metadata` block must be the LAST element of the LAST section**, never
  its own top-level section — otherwise SEO `<title>`/`<meta description>` tags
  aren't emitted and the metadata renders as visible text on the page.
- **Images must be reachable URLs** — replace local `./images/<hash>` with the **original source
  URLs** (from `import-work/metadata.json`; DA sideloads external URLs). Pre-upload only for URL
  stability (logo → `/media/…` on `content.da.live`). **DA caps SVG uploads at 40KB** — rasterize
  any oversized source SVG (QR codes, illustrations) to PNG and pre-upload it before referencing.
- **Strip the local-preview `nav`/`footer` override rows** from the page metadata (deploy nav to
  global `/nav`, footer to `/footer`).
- Upload: `PUT admin.da.live/source/{org}/{repo}/<path>.html` multipart field **`data`**, blob `text/html`, using the page's `targetPath` from `migration/site-map.json` verbatim — never a shortened or flattened path.
- Preview: `POST admin.hlx.page/preview/{org}/{repo}/main/<path>` (no `.html`). Publish: `.../live/...`.
- **Retiring or moving a page needs BOTH a source delete AND a preview delete.**
  Deleting a DA source doc does not retire its already-generated preview — the
  old path keeps serving stale content until the Admin API's preview-delete
  endpoint is also called for it.

### Phase 6.5 — Validate against the deployed preview URL (both widths)
A pass against `localhost:3000/drafts/<page>` is necessary but not sufficient — the
real EDS pipeline (block transport, DA content shaping, real font loading, CDN
rendering) can reshape the page between draft and deploy. **Re-run all four probes at
both widths against the feature preview URL**, not just the local draft:
```
BUILD="https://<branch>--<repo>--<owner>.aem.page/<path>"
node visual-diff.mjs      "<source-url>" "$BUILD" --profile eds --width 1920
node visual-diff.mjs      "<source-url>" "$BUILD" --profile eds --width 2560
node content-diff.mjs     "<source-url>" "$BUILD" --profile eds --width 1920
node content-diff.mjs     "<source-url>" "$BUILD" --profile eds --width 2560
node typography-diff.mjs  "<source-url>" "$BUILD" --width 1920
node typography-diff.mjs  "<source-url>" "$BUILD" --width 2560
node block-diff.mjs       "<source-url>" "$BUILD" --width 1920
node block-diff.mjs       "<source-url>" "$BUILD" --width 2560
```
- A defect that shows up here but NOT in Phase 5's local check means the delivery
  pipeline reshaped the content in transport (a block's flattened-shape fallback,
  a metadata-driven nav/footer swap, real webfont loading vs local fallback) — fix
  the transport/block, not the authoring.
- Only on a pass at both widths against the deployed preview URL does the page earn
  `status: preview-ready` in `migration/site-map.json`. On full publish success, set
  `status: deployed`.

---

## Part B — Batch subpage migration (multi-page scope only)

Runs after Part A's starting pages are `deployed` (code on `main`, at minimum).
Every remaining `scoped` page in `migration/site-map.json` is migrated by a
subagent running **the same Phase 1 → 6.5 recipe as Part A** — including the
Link rewrite rule — plus its own content-bus deploy, while preserving its
`draftPath`/`targetPath` from the IA map.

### Phase 7 — Wave-based subagent fan-out
Reuses the execution model from `stardust:rollout` Phase C (representative-first
waves, resumable per-page ledger, retry-only-FAILs) — the mechanics, not
`rollout`'s `DESIGN.json`/canon state machine, which this skill doesn't use.

1. **Group by template/page-type** (e.g. every `/products/*` leaf page probably
   shares one layout). Pick one representative per group.
2. **Wave 1 — representatives, one agent at a time (not parallel).** Each
   representative subagent runs Phases 1 (incl. link rewrite), 4 (fidelity), 5
   (both widths, local), 6 (deploy), 6.5 (both widths, against its own preview
   URL) for its page. If it needs a block or token that doesn't exist yet, it
   **stops and reports back** — it must NOT create/edit `blocks/*` or
   `styles/styles.css` itself. The orchestrator (this session) creates the new
   block/token once, gets it through Phase 6's code-bus PR/merge, then resumes.
3. **Wave 2+ — remaining siblings, in parallel batches** (respect the
   concurrency cap). Each subagent gets:
   - Its row(s) from `migration/site-map.json` (source URL, `draftPath`, `targetPath`).
   - The now-settled block/token contract from Wave 1 — siblings reuse blocks
     by name, they don't reinvent them.
   - **The full `migration/site-map.json` ledger** (read-only) so it can apply
     the Link rewrite rule against every in-scope sibling, not just its own row.
   - Instructions to run Phase 1 (import + link rewrite, writing ONLY to its
     own `draftPath` and its own `drafts/images/<slug>/` subfolder), Phase 5
     (both widths, local diff against its own source URL), Phase 6's
     content-bus deploy for its own page, and Phase 6.5 (both widths, against
     its own preview URL) — and report pass/fail. **Never touch
     `styles/styles.css`, `blocks/*`, `drafts/nav.plain.html`,
     `drafts/footer.plain.html`, or another page's files.** Disjoint file
     ownership per subagent is what makes true concurrency safe here (see
     Gotcha 3).
4. **Single-writer ledger.** Subagents report results to the orchestrator
   (don't have every subagent edit the shared `migration/site-map.json`
   concurrently); the orchestrator merges each wave's results into the ledger
   after the wave completes, setting `status` to `preview-ready`/`deployed` or
   `failed` with a reason.
5. **Resume, don't restart.** A re-run only re-dispatches `scoped`/`failed`
   rows — pages already `preview-ready`/`deployed` are skipped, exactly like
   `rollout`'s incremental inventory.

### Phase 8 — IA reconciliation + link-rewrite audit
Before/alongside batch publish, verify the information architecture — and the
cross-linking — actually hold:
- Every `site-map.json` row's `draftPath` exists on disk at the expected nested
  location (no flattened paths).
- Every `parent` value that appears on a row is itself a row with `role:
  section-index` and status `preview-ready`/`deployed` — a section can't have
  children if its own landing page is missing.
- **Link-rewrite audit**: grep every drafted page's `<a href>` values against
  the source domain. Any hit whose path matches a `sourcePath` in
  `migration/site-map.json` is a **missed rewrite** — fix it (this is a defect,
  not a style choice). A hit with no ledger match is a deliberate out-of-scope
  bounce; confirm it's intentional, not an omission from Phase 0's scoping.
  Normalize trailing slashes/`.html` the same way as a single page (EDS serves
  extensionless paths) before comparing.
- Any path renamed for AEM-Edge-safety in Phase 0.5 has a corresponding row in
  `migration/redirects.tsv` and that redirect is wired up before publish.

### Phase 9 — Batch publish
Each page already ran its own two-part deploy + Phase 6.5 preview-URL check in
Phase 7. This phase is the whole-batch wrap-up:
1. Confirm every `preview-ready` row has actually been published (`.../live/...`),
   not just previewed — flip to `deployed`.
2. **Code → git**: batch any block/token additions accumulated across waves that
   weren't already merged into one sequenced PR — never split across concurrent
   subagents.
3. Re-run the IA reconciliation + link-rewrite audit (Phase 8) once more against
   the now-published tree, since publish is what makes cross-page internal links
   resolvable end to end.

---

## Gotchas (hard-won — read before starting)

1. **NEVER modify `scripts/aem.js`** (AGENTS.md). Its `decorateSections` is stripped and
   ignores `section-metadata`, so you **cannot style a section via section-metadata**. Use a
   **block class as the styling hook** (a block's first class survives to the DOM; wrap
   default-content sections that need distinct styling in a small block, e.g. `notice`,
   `disclaimer`). `:has()` on `.section.<block>-container` is a clean per-section hook.
2. **Buttons are authored, not automatic.** This project's `decorateButtons` only makes a link
   a button when it's wrapped in `<strong>` (primary) or `<em>` (secondary). Plain `<a>` stays a
   link. Wrap CTAs accordingly in the content.
3. **Concurrency is safe only across disjoint files.** A single-page job still needs full
   sequencing (page HTML, `styles.css`, and shared blocks are the usual collision points). In
   the multi-page batch, subagents are safe to run in parallel ONLY because each owns exactly
   one page's `draftPath` + image subfolder and never touches shared files (`styles.css`,
   `blocks/*`, nav/footer drafts, the ledger). Any change to a shared file — new block, new
   token, new nav entry — is single-writer and sequenced, whether that's one agent or the
   orchestrator.
4. **Playwright path** (see prerequisites) — run browser/diff `.mjs` from the scrape-scripts dir.
5. **Design tokens first.** A wrong `--link-color` / brand palette makes everything read "off"
   even when layout is right. Extract from the live site (Phase 3) before per-block work — and
   before Part B fans out, since every subagent inherits these tokens.
6. **Verify, don't trust self-grades.** Subagents report "~95% match"; confirm with cropped
   comparisons + the diff gate — per page, not just on the bootstrap page.
7. **IA is not automatic.** `page-import`'s default documentPath guess is per-page and has no
   notion of the site's nested structure — it will happily flatten `/products/phones/pixel` to
   `/pixel` if not told otherwise. Always pass the `targetPath` from `migration/site-map.json`
   explicitly; never let a subagent infer its own path.
8. **A missing section-index page breaks the ledger's IA check, not just a nav link.** If the
   source 404s on its own section root (e.g. `/products` has no page, only `/products/*`
   children), decide explicitly in Phase 0.5 whether to synthesize a minimal landing page or
   accept the gap — don't discover it silently in Phase 8.
9. **A local-draft pass is not a deploy pass.** Always run Phase 6.5 against the actual feature
   preview URL, not just `localhost:3000/drafts/<page>` — DA content shaping, real block
   transport, and CDN rendering can reshape the page between draft and deploy. Treat a
   local-only pass as provisional.
10. **1080p-only checks miss 2K-only regressions.** Column layouts, `max-width` wraps, and hero
    art scaling can be faithful at 1920px and visibly wrong at 2560px (or vice versa). Both
    widths are mandatory at every diff gate (Phase 5 and 6.5), not just the default.
11. **Don't leave migrated pages linking back to the source site.** Rewrite internal links at
    import time (Link rewrite rule) using the reserved `targetPath`, not just once the target is
    deployed — a nav/footer or in-content link to an in-scope page that still points at the
    source domain is a defect, caught by Phase 8's link-rewrite audit if missed earlier.
12. **DA's markdown round-trip strips any class on a non-block element** — only a
    recognized block's top-level class survives. A bespoke class added to a plain
    `<p>`/inner `<div>` for one-off styling renders correctly on the local
    `--html-folder` drafts server but is silently dropped on DA — invisible until
    content is actually uploaded. Style such elements structurally (`:first-child`,
    `:nth-child`, `:has()`, element type) instead, and verify by checking the
    DA-served `.plain.html` post-upload, not just the local draft.
13. **`localhost:3000` bare-root paths proxy the remote DA preview; only
    `/drafts/<slug>` serves the local draft file.** A page can look correct at
    `/drafts/<slug>` (the code-fidelity check) yet be broken at `/<slug>` or on the
    real `aem.page` preview (the DA-fidelity check) — the drafts server never runs
    content through DA's pipeline, so it can't reproduce DA-side corruption
    (stripped classes, flattened divs). Both are distinct checks; run both.
14. **Interactive DA-auth tokens can expire mid-session with no way to
    self-refresh.** Sequence the work so all local authoring/verification finishes
    BEFORE the sync step (upload/preview/publish) — an expired token then blocks
    only the final sync, never the substantive work. Never let a subagent guess
    at re-auth.

## Success criteria

- Page renders at `/drafts/<page>` with 0 console errors / 0 broken images, `npm run lint` clean.
- Cropped per-section compare against `import-work/screenshot.png` matches (esp. heading slots), at both 1080p and 2K.
- Diff gate: visual none/justified, content-diff 0 real 🔴, typography-diff 0 unreviewed DIFF rows (type/weight/line-height/line-space/line-weight), block-diff 0 unreviewed DIFF rows (width/text-overlay position/link-button UX/icons) — all **block by block**, at both widths (1920px, 2560px), against BOTH the local draft AND the deployed feature-preview URL.
- Deployed: code on `main`, content previewed + published; `https://main--{repo}--{owner}.aem.live/<path>` renders fully.
- **Multi-page additionally:** scope was confirmed with the user and recorded in
  `migration/scope.json`; every page in `migration/site-map.json` reached
  `deployed` (or `failed` with a surfaced reason — never silently dropped);
  every nested source path is preserved 1:1 (or explicitly redirected) in the
  deployed target site; every section-index page exists for every path that
  has children; every internal link on every migrated page points at another
  migrated page's `targetPath` (not the original source domain) unless
  deliberately out of scope — a source-domain-href grep across `drafts/`
  returns only intentional bounces.

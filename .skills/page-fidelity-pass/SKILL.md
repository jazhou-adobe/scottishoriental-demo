---
name: page-fidelity-pass
description: Use when comparing a migrated / converted EDS page against its live target (source) page block by block for design fidelity — width, asset, location, font, colour — e.g. "run a fidelity pass on this page", "does my migrated page match the source", "compare the migrated home vs the original block by block", "why doesn't the converted page look like the target". Orchestrates the existing diff probes, captures matched per-block screenshots, fans one subagent out per block to judge the crops, and outputs a deduped, severity-ranked task list of fixes.
tags: [aem, edge-delivery, migration, fidelity, qa, visual-diff]
---

# Page Fidelity Pass

A **page-level, block-by-block fidelity audit** of a migrated (build) page against
its live target (source) page. It does not fix anything — it produces an
evidence-backed, severity-ranked **task list** of every fidelity gap across five
facets: **WIDTH, ASSET, LOCATION, FONT, COLOUR** (plus link/button UX, icons, and
dropped/added/reworded blocks).

It is the deep, single-page complement to the whole-site gates in
`site-migration` (Phase 5 / 6.5): those run four probes and flag; this one
additionally captures **matched per-block screenshots** and delegates the visual
judgement of each block to its own subagent, then aggregates.

Use it after a page has been migrated + deployed, or any time a converted page is
suspected of diverging from its source.

## What it leverages (do not reinvent)

This skill orchestrates tools that already exist in this repo. Read their headers
before running:

- `.skills/stardust/diff/scripts/visual-diff.mjs` — full-page screenshots +
  metrics + red flags (blank render, imagery/content gap, surface/ground colour
  mismatch, font-not-loaded, image-did-not-load, flush-left).
- `.skills/stardust/diff/scripts/content-diff.mjs` — text/role structural diff.
- `.skills/site-migration/scripts/typography-diff.mjs` — per-block font facets.
- `.skills/site-migration/scripts/block-diff.mjs` — per-block WIDTH / text-overlay
  anchor / link-vs-button UX / icon counts.
- `.skills/site-migration/scripts/image-audit.mjs` — decode-based broken-image
  gate (`naturalWidth===0`) on the deployed page.
- `scripts/block-crops.mjs` (ships with THIS skill) — the one artifact the others
  don't emit: **matched, positionally/label-paired per-block screenshot crops**
  from both sides + a `manifest.json` of per-block facets. This is the subagent
  fan-out input.

Also honour the hard-won traps in `.skills/site-migration/SKILL.md` "Gotchas"
(esp. 13 = local draft bypasses the DA pipeline so audit the DEPLOYED URL; 15 =
broken images fail silently past HTTP/curl; 16 = classic-AEM sources have no
`<main>`, scope symmetrically).

## Inputs to establish first

- **BUILD url** — the deployed page (`https://main--<repo>--<owner>.aem.live/<path>`
  or `…aem.page/…`). NOT the local `--html-folder drafts` server (Gotcha 13: it
  bypasses the DA pipeline and can't reproduce content-bus image/decoration bugs).
- **SOURCE url** — the live target page.
- **`--source-main`** — the source content root when it has no `<main>`. Check:
  `curl -s <SOURCE> | grep -c '<main'` → `0` means you MUST pass one (e.g.
  `.page-content-container`), or the source side inventories nav/footer chrome and
  the pairing floods with false diffs (Gotcha 16).
- **Gate / consent dismissal** — many target sites show a disclaimer or cookie
  gate that, if not dismissed, IS the captured "page" (its text pollutes the
  blocks). Find the accept control and pass it via `--dismiss` (playwright
  locator, e.g. `--dismiss "text=Agree"`; comma-separate several). Verify from
  `source-full.png` that the real page rendered.
- **Widths** — always run BOTH `1920` (1080p) and `2560` (2K/QHD); layout bugs
  routinely appear at only one.

## Prerequisites

Playwright resolves only from the scrape-webpage scripts dir. Stage every script
+ its siblings there and run from there:

```bash
D=.skills/adobe/aem/edge-delivery-services/scrape-webpage/scripts
cp .skills/stardust/diff/scripts/{visual-diff,content-diff,live-session,diff-profiles,content-inventory}.mjs "$D"/
cp .skills/site-migration/scripts/{typography-diff,block-diff,image-audit}.mjs "$D"/
cp .skills/page-fidelity-pass/scripts/block-crops.mjs "$D"/
```

Pick an output root, e.g. `WORK=fidelity/<page-slug>` (create it). Clean up the
copied `*.mjs` from `$D` when done.

## Procedure

### Phase A — Capture (run all, both widths)

Run from `$D`. For each width `W` in `1920 2560`:

1. **Matched per-block crops + facet manifest** (the fan-out input):
   ```bash
   node block-crops.mjs "<SOURCE>" "<BUILD>" --out <WORK>/w<W> --width <W> \
     [--source-main <sel>] [--dismiss "<accept-selector>"] --chrome
   ```
   Read the stdout pairing summary and `<WORK>/w<W>/manifest.json`. It reports
   label-matched pairs (high confidence), position-matched pairs (`position?` —
   HYPOTHESES to confirm from crops), and unpaired build/source blocks.

2. **The four probes** (machine flags across the whole page / per block):
   ```bash
   node visual-diff.mjs   "<SOURCE>" "<BUILD>" --out <WORK>/w<W>/vdiff --width <W> [--main <sel>] [--dismiss ...]
   node content-diff.mjs  "<SOURCE>" "<BUILD>" [--main <sel>] > <WORK>/w<W>/content-diff.txt
   node typography-diff.mjs "<SOURCE>" "<BUILD>" --width <W> [--main <sel>] > <WORK>/w<W>/typo-diff.txt
   node block-diff.mjs    "<SOURCE>" "<BUILD>" --width <W> [--main <sel>] > <WORK>/w<W>/block-diff.txt
   ```
   (`content-diff` / `typography-diff` / `block-diff` take `--main` as the source
   content root when there is no `<main>`.)

3. **Broken-image gate on the deployed build:**
   ```bash
   node image-audit.mjs "<BUILD>" --width <W>   # exit 2 = broken image / console error
   ```

A probe exit `3` = bot challenge on the live side → re-run that probe with
`--headed`. A missing `source-full.png` content, a `BLANK RENDER` flag, or a gate
still visible in the crop means the capture is invalid — fix inputs and re-run
before trusting anything downstream.

### Phase B — Per-block subagent fan-out

The block-level judgement is delegated. Spawn, in one `task` batch (respect the
32-agent cap; batch larger pages):

- **One subagent per PAIR** in `manifest.json` (`pairs[]`). Prefer the 1920
  manifest as the spine; give each subagent BOTH widths' crops for its block when
  they exist.
- **One CHROME subagent** for header + footer (`*-chrome-header.png`,
  `*-chrome-footer.png`) — nav/footer live outside `<main>` and are otherwise
  never compared (site-migration Phase 2 gate). Judge logo, menu tiers/layout,
  search/tools, footer ground colour, link columns, every footer logo.
- **One RECONCILIATION subagent** for `unpaired[]` — using `source-full.png` and
  `build-full.png`, decide for each unmatched block whether it is: DROPPED (in
  source, absent in build), ADDED (build-only), RENAMED (same block, reworded
  heading — should have paired), or SOURCE CHROME/GATE (nav, consent, country
  selector — not a real gap).

Each subagent is READ-ONLY (scout is fine) and returns findings only — it does
NOT edit. Give it the exact crop paths + its `manifest.json` pair object + the
matching rows from the probe outputs. Subagent prompt template:

> Compare ONE migrated block against its source. Read both screenshots:
> SOURCE `<path>` and BUILD `<path>` (also the 2560 crops if given). Here is the
> measured facet data for this block (from manifest.json):
> `<paste pairs[i].source and pairs[i].build>`. Relevant probe rows:
> `<paste matching block-diff / typography-diff / visual-diff lines>`.
> First confirm the two crops are the SAME block (labels/content) — if not, say
> so and stop. Then report every fidelity gap across these facets, each as one
> finding `{facet, severity, source, build, evidence, fix}`:
> - WIDTH — rendered width & viewport fraction (tolerance ±24px or ±5% vw).
> - ASSET — every image present in source present in build, right image, not
>   broken (`failed:true` / natural 0×0), not stretched (natural AR vs rendered
>   AR), decorative icons/logos present.
> - LOCATION — block/element position & layout: order, alignment, column count,
>   text-over-media anchor, flush-left/no-padding, full-bleed vs wrapped.
> - FONT — family actually loaded (not a silent fallback), size, weight, case.
> - COLOUR — ground (background band) and text/heading colour; catch
>   surface/ground inversion (light-on-dark vs dark-on-light).
> Severity: blocker (missing/broken/wrong content or asset), major (clearly
> wrong colour/width/layout), minor (small spacing/shade). Return ONLY the
> findings list.

### Phase C — Aggregate into a task list

The main agent merges everything and OWNS the output (do not delegate this):

1. Collect all subagent findings + the probe red flags (`visual-diff` flags,
   `content-diff` misses, `typo-diff`/`block-diff` DIFF rows) + `image-audit`
   result.
2. Deduplicate (the same colour bug surfaces in a subagent AND in visual-diff's
   SURFACE/GROUND flag — one task).
3. Rank by severity, then by block order.
4. Write `<WORK>/findings.md` — a table of every finding with evidence (crop
   filename + measured values) — and a **task list** `<WORK>/tasks.md`:

   ```markdown
   ## Fidelity tasks — <page> (<BUILD> vs <SOURCE>)
   ### Blockers
   - [ ] T1 · <block> · <facet> — <what's wrong: source X vs build Y>
         fix: <concrete change> · file: blocks/<name>/ or the DA doc · evidence: w1920/<crop>
   ### Major
   - [ ] …
   ### Minor
   - [ ] …
   ```

5. Initialise the `todo` list from the blocker + major tasks so the fixes are
   tracked, and report the summary counts to the user.

## Facet reference & tolerances

| Facet | Signal source | Match if |
|---|---|---|
| WIDTH | manifest `width`/`wFrac`, `block-diff` | within ±24px OR ±5% of viewport |
| ASSET | manifest `images[]` (`natural`,`rendered`,`failed`), `image-audit`, visual-diff IMAGE flags | every source image present, right asset, natural>0, AR within 4% |
| LOCATION | manifest `top`/`height`, `block-diff` overlay anchor, visual-diff flush-left | same order/alignment/column count; not full-bleed when source is wrapped |
| FONT | manifest `fontFamily`/`fontSize`, `typography-diff`, visual-diff FONT flag | named face actually loaded (width-probe, never `document.fonts.check`); size/weight/case match |
| COLOUR | manifest `ground`/`textColor`, visual-diff SURFACE/GROUND flag | ground & text colour match; no light/dark inversion |

## Notes / failure modes

- **Cross-DOM pairing is advisory.** Source and build DOMs differ; `by:"label"`
  pairs are high-confidence, `by:"position"` pairs are hypotheses — the subagent
  MUST confirm the crops are the same block before reporting facet diffs. A wrong
  positional pair is expected on pages with source-only chrome; it becomes a
  "not the same block" note, not a false fix task.
- **A gate not dismissed poisons everything.** If `source-*` crops show a
  disclaimer/cookie wall, the whole run is invalid. Re-run with the right
  `--dismiss` selector.
- **Classic-AEM source with no `<main>`** → always pass `--source-main` /
  `--main`; otherwise both sides false-flag and the pairing fills with chrome.
- **Audit the DEPLOYED url, never the local draft** (Gotcha 13) — the local
  server bypasses the DA pipeline and hides the content-bus image/decoration bugs
  this pass exists to catch.
- **Run both widths.** A block that is correct at 1920 can break at 2560.
- **This pass finds; it does not fix.** Output is the task list. Apply fixes via
  the normal block/CSS or DA-content workflow, then re-run this pass to confirm.
```

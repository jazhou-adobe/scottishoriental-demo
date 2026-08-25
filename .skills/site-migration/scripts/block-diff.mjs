#!/usr/bin/env node
/**
 * site-migration/scripts/block-diff.mjs
 *
 * Block-by-block LAYOUT/UX fidelity probe for the site-migration skill's
 * Phase 4/5 fidelity gate. Complements typography-diff.mjs (font facets) and
 * stardust:diff's visual-diff.mjs/content-diff.mjs (pixels/structure) with
 * four facets neither reports per block:
 *   WIDTH          rendered block width, in px and as a fraction of viewport
 *   TEXT OVERLAY   for a block with text laid over media, the text's anchor
 *                  zone (top/middle/bottom x left/center/right) relative to
 *                  the media — not just "is there overlay text"
 *   LINK/BUTTON UX for every <a> in the block: does it render as a BUTTON
 *                  (background/border, or this project's <strong>/<em> wrap
 *                  convention — see Gotcha #2) or a plain link, does it carry
 *                  an icon, and does it have ANY :hover/:focus rule at all
 *                  (a link that lost its hover/focus feedback is a real UX
 *                  regression even when its color and text are correct)
 *   ICONS          count of icon-bearing elements in the block (svg, an
 *                  icon-ish <img>, a `.icon`-classed element, or an
 *                  icon-only ::before/::after)
 *
 * Blocks are the same "widest classed content container, de-duplicated to
 * outermost" heuristic visual-diff.mjs uses for its contentBoxes, sorted by
 * vertical order, then aligned source-to-build positionally (block[i] vs
 * block[i]) — the two DOMs are never structurally identical, so read the
 * printed label/link text on a DIFF row to confirm the alignment before
 * trusting the flag, exactly like typography-diff.mjs.
 *
 * Usage:
 *   node block-diff.mjs <sourceURL> <buildURL> [options]
 *     --main <selector>      content root to sample             (default "main")
 *     --width <px>           viewport width                     (default 1280)
 *     --ua <string>          user agent                         (default: real-Chrome desktop UA)
 *     --wait-until <state>   goto wait state override (see visual-diff.mjs for the
 *                            three-tier default: localhost/EDS origins -> networkidle,
 *                            other live http(s) -> domcontentloaded)
 *     --dismiss [sel,...]    dismiss overlays (consent + timed marketing modals) on
 *                            both sides; optional comma-separated extra selectors
 *     --headed               escalation: headed stealth real Chrome (bot-managed sites)
 *     --locale <tag>         pin Accept-Language + context locale (geo determinism)
 *
 * Tolerances (inside these = MATCH, not DIFF): width +-24px OR +-5% of
 * viewport, whichever is looser.
 *
 * Exit codes: 0 ran (DIFF rows are advisory, like every other probe here —
 * they do NOT fail the run), 1 error, 3 bot challenge/blocked live side
 * (BotChallengeError — escalate with --headed).
 */

/* eslint-disable import/no-extraneous-dependencies, import/extensions, no-await-in-loop, no-restricted-syntax, brace-style, object-curly-newline, max-len, no-plusplus, no-continue */
/* standalone dev tool: playwright is a devDependency; sequential page ops are awaited by design */
import { chromium } from 'playwright';
import { isLiveHttpUrl, defaultWaitUntil, launchStealthHeaded, newLiveContext, gotoLive, dismissOverlays, REAL_CHROME_UA } from './live-session.mjs';

const USAGE = `usage: node block-diff.mjs <sourceURL> <buildURL> [options]
  --main <selector>      content root to sample          (default "main")
  --width <px>           viewport width                  (default 1280)
  --ua <string>          user agent (default: real-Chrome desktop UA)
  --wait-until <state>   goto wait state override
  --dismiss [sel,...]    dismiss overlays on both sides
  --headed               headed stealth real Chrome (escalation for bot-managed sites)
  --locale <tag>         pin Accept-Language + locale (e.g. en-GB)
exit codes: 0 ran (DIFF rows advisory), 1 error, 3 bot challenge (live side blocked)
`;

function parseArgs(argv) {
  const [, , source, build, ...rest] = argv;
  if (rest.includes('--help') || source === '--help' || source === '-h') { process.stdout.write(USAGE); process.exit(0); }
  const opts = { main: 'main', width: 1280, ua: REAL_CHROME_UA, waitUntil: null, dismiss: null, headed: false, locale: null };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--main') { opts.main = rest[i += 1]; }
    else if (a === '--width') { opts.width = Number(rest[i += 1]); }
    else if (a === '--ua') { opts.ua = rest[i += 1]; }
    else if (a === '--wait-until') { opts.waitUntil = rest[i += 1]; }
    else if (a === '--dismiss') {
      const next = rest[i + 1];
      opts.dismiss = (next && !next.startsWith('--')) ? rest[i += 1].split(',').map((s) => s.trim()).filter(Boolean) : [];
    }
    else if (a === '--headed') { opts.headed = true; }
    else if (a === '--locale') { opts.locale = rest[i += 1]; }
  }
  return { source, build, opts };
}

// Runs IN the page (serialized by Playwright, ONE arg: the --main selector).
/* eslint-disable no-undef */
function sample(mainSel) {
  const root = document.querySelector(mainSel) || document.querySelector('main') || document.body;
  const vw = window.innerWidth;
  const round = (n, p = 2) => { const m = 10 ** p; return Math.round(n * m) / m; };

  // Same heuristic as visual-diff.mjs's contentBoxes: the widest classed
  // containers holding real content, generic structural wrappers excluded,
  // de-duplicated to outermost so a hero's inner text wrap doesn't also
  // count as its own "block".
  const STRUCT = /(^|[\s-])(section|block-content|default-content|wrapper)([\s-]|$)/i;
  let blocks = [...root.querySelectorAll('[class]')].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width >= vw * 0.3 && r.height > 0
      && el.querySelector('h1, h2, h3, p, a, img')
      && !STRUCT.test((el.className || '').toString());
  });
  blocks = blocks.filter((el) => !blocks.some((o) => o !== el && el.contains(o)));
  blocks.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);

  const pointIn = (t, m) => {
    const cx = (t.left + t.right) / 2; const cy = (t.top + t.bottom) / 2;
    return cx >= m.left && cx <= m.right && cy >= m.top && cy <= m.bottom;
  };

  // Largest media element in the block (or the block itself, if it paints a
  // CSS background-image) + whether any text element's center sits over it,
  // and which of the 9 anchor zones that center falls in.
  const overlayInfo = (block) => {
    const mediaEls = [...block.querySelectorAll('img, video')].filter((m) => {
      const r = m.getBoundingClientRect();
      return r.width > 40 && r.height > 40;
    }).sort((a, b) => {
      const ra = a.getBoundingClientRect(); const rb = b.getBoundingClientRect();
      return (rb.width * rb.height) - (ra.width * ra.height);
    });
    const bg = getComputedStyle(block).backgroundImage !== 'none';
    const media = mediaEls[0] || (bg ? block : null);
    if (!media) return { hasMedia: false, hasOverlayText: false };
    const mr = media.getBoundingClientRect();
    const textEls = [...block.querySelectorAll('h1, h2, h3, h4, p, a')].filter((t) => t !== media && t.textContent.trim().length > 0);
    const overlay = textEls.find((t) => pointIn(t.getBoundingClientRect(), mr));
    if (!overlay) return { hasMedia: true, hasOverlayText: false };
    const tr = overlay.getBoundingClientRect();
    const cx = (tr.left + tr.right) / 2; const cy = (tr.top + tr.bottom) / 2;
    const col = cx < mr.left + mr.width / 3 ? 'left' : cx > mr.right - mr.width / 3 ? 'right' : 'center';
    const row = cy < mr.top + mr.height / 3 ? 'top' : cy > mr.bottom - mr.height / 3 ? 'bottom' : 'middle';
    return { hasMedia: true, hasOverlayText: true, anchor: `${row}-${col}` };
  };

  // Does ANY stylesheet rule with a :hover/:focus pseudo target this element,
  // once the pseudo is stripped back to a plain selector? Cheap CSSOM scan —
  // no actual mouse/keyboard simulation, so it can't tell if the STATE looks
  // right, only whether the element has ANY defined interactive feedback.
  const hasStateRule = (el) => {
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules || sheet.rules; } catch { continue; }
      if (!rules) continue;
      for (const rule of rules) {
        if (!rule.selectorText || !/:hover|:focus/.test(rule.selectorText)) continue;
        const base = rule.selectorText.replace(/:hover|:focus(-visible)?/g, '').trim();
        if (!base) continue;
        try { if (el.matches(base)) return true; } catch { /* selector no longer valid after strip */ }
      }
    }
    return false;
  };

  const ICON_SEL = 'svg, img[src*="icon" i], [class*="icon" i]';
  const countIcons = (block) => block.querySelectorAll(ICON_SEL).length;

  const linkUX = (el) => {
    const cs = getComputedStyle(el);
    const hasBg = cs.backgroundColor && !/rgba?\(0,\s*0,\s*0,\s*0\)|transparent/.test(cs.backgroundColor);
    const hasBorder = (parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderBottomWidth) > 0) && cs.borderStyle !== 'none';
    const parentTag = el.parentElement ? el.parentElement.tagName.toLowerCase() : '';
    const isButton = !!(hasBg || hasBorder || parentTag === 'strong' || parentTag === 'em');
    const before = getComputedStyle(el, '::before').content;
    const after = getComputedStyle(el, '::after').content;
    const pseudoIcon = (c) => c && c !== 'none' && c !== '""' && c !== "''";
    const hasIcon = !!(el.querySelector(ICON_SEL) || pseudoIcon(before) || pseudoIcon(after));
    return {
      text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40),
      isButton,
      hasIcon,
      hasInteractiveStyle: hasStateRule(el),
    };
  };

  return blocks.map((block, index) => {
    const r = block.getBoundingClientRect();
    const label = (block.getAttribute('class') || '').trim().split(/\s+/)[0] || block.tagName.toLowerCase();
    return {
      index,
      label,
      sample: (block.querySelector('h1, h2, h3, p')?.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40),
      width: round(r.width, 0),
      widthRatio: round(r.width / vw),
      overlay: overlayInfo(block),
      icons: countIcons(block),
      links: [...block.querySelectorAll('a')].map(linkUX),
    };
  });
}
/* eslint-enable no-undef */

async function capture(browser, url, opts) {
  const ctx = await newLiveContext(browser, { ua: opts.ua, locale: opts.locale, viewport: { width: opts.width, height: 1000 } });
  const page = await ctx.newPage();
  await gotoLive(page, url, { waitUntil: opts.waitUntil || defaultWaitUntil(url), timeoutMs: 60000, settleMs: 800, httpError: 'measure', solveWindow: opts.headed });
  if (opts.dismiss) await dismissOverlays(page, { extra: opts.dismiss, lateWindowMs: isLiveHttpUrl(url) ? 6000 : 0 });
  const blocks = await page.evaluate(sample, opts.main);
  await ctx.close();
  return blocks;
}

const WIDTH_TOL_PX = 24;
const WIDTH_TOL_RATIO = 0.05;

function diffLinks(srcLinks, buildLinks) {
  const n = Math.max(srcLinks.length, buildLinks.length);
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const a = srcLinks[i]; const t = buildLinks[i];
    if (!a || !t) { out.push({ status: !a ? 'BUILD-ONLY' : 'SOURCE-ONLY', text: (a || t).text }); continue; }
    const diffs = [];
    if (a.isButton !== t.isButton) diffs.push(`role: ${a.isButton ? 'button' : 'link'} -> ${t.isButton ? 'button' : 'link'}`);
    if (a.hasIcon !== t.hasIcon) diffs.push(`icon: ${a.hasIcon} -> ${t.hasIcon}`);
    if (a.hasInteractiveStyle && !t.hasInteractiveStyle) diffs.push('missing hover/focus feedback (source has it, build does not)');
    if (diffs.length) out.push({ status: 'DIFF', text: t.text || a.text, diffs });
  }
  return out;
}

function diffBlocks(srcBlocks, buildBlocks) {
  const n = Math.max(srcBlocks.length, buildBlocks.length);
  const rows = [];
  for (let i = 0; i < n; i += 1) {
    const a = srcBlocks[i]; const t = buildBlocks[i];
    if (!a || !t) { rows.push({ i, status: !a ? 'BUILD-ONLY' : 'SOURCE-ONLY', block: (a || t).label }); continue; }
    const diffs = [];
    const widthDeltaPx = Math.abs(a.width - t.width);
    const widthDeltaRatio = Math.abs(a.widthRatio - t.widthRatio);
    if (widthDeltaPx > WIDTH_TOL_PX && widthDeltaRatio > WIDTH_TOL_RATIO) {
      diffs.push(`width: ${a.width}px (${a.widthRatio}vw) -> ${t.width}px (${t.widthRatio}vw)`);
    }
    if (a.overlay.hasOverlayText !== t.overlay.hasOverlayText) {
      diffs.push(`text-overlay: ${a.overlay.hasOverlayText ? 'present' : 'absent'} -> ${t.overlay.hasOverlayText ? 'present' : 'absent'}`);
    } else if (a.overlay.hasOverlayText && t.overlay.hasOverlayText && a.overlay.anchor !== t.overlay.anchor) {
      diffs.push(`text-overlay position: ${a.overlay.anchor} -> ${t.overlay.anchor}`);
    }
    if (a.icons !== t.icons) diffs.push(`icon count: ${a.icons} -> ${t.icons}`);
    const linkDiffs = diffLinks(a.links, t.links);
    rows.push({
      i, status: diffs.length || linkDiffs.length ? 'DIFF' : 'MATCH', block: t.label, sample: t.sample || a.sample, diffs, linkDiffs,
    });
  }
  return rows;
}

function printReport(rows) {
  let diffCount = 0; let matchCount = 0;
  rows.forEach((row) => {
    if (row.status === 'MATCH') { matchCount += 1; return; }
    diffCount += 1;
    const label = row.status === 'DIFF' ? `DIFF  [${row.block}]` : `${row.status}  [${row.block}]`;
    process.stdout.write(`${label} "${row.sample || ''}"\n`);
    (row.diffs || []).forEach((d) => process.stdout.write(`    ${d}\n`));
    (row.linkDiffs || []).forEach((ld) => {
      if (ld.status === 'DIFF') {
        process.stdout.write(`    link "${ld.text}":\n`);
        ld.diffs.forEach((d) => process.stdout.write(`      ${d}\n`));
      } else {
        process.stdout.write(`    link "${ld.text}": ${ld.status}\n`);
      }
    });
  });
  process.stdout.write(`\nblock-diff: ${matchCount} match, ${diffCount} diff (advisory — fix the DIFF blocks' CSS/markup, then re-run)\n`);
}

async function main() {
  const { source, build, opts } = parseArgs(process.argv);
  if (!source || !build) { process.stderr.write(USAGE); process.exit(1); }
  const browser = opts.headed ? await launchStealthHeaded(chromium) : await chromium.launch();
  try {
    const srcBlocks = await capture(browser, source, opts);
    const buildBlocks = await capture(browser, build, opts);
    printReport(diffBlocks(srcBlocks, buildBlocks));
  } finally {
    await browser.close();
  }
}

main().catch((e) => { process.stderr.write(`block-diff error: ${e.message}\n`); process.exit(e.name === 'BotChallengeError' ? 3 : 1); });

#!/usr/bin/env node
/**
 * site-migration/scripts/typography-diff.mjs
 *
 * Block-by-block TYPOGRAPHY fidelity probe for the site-migration skill's
 * Phase 4/5 fidelity gate. stardust:diff's visual-diff.mjs covers layout/
 * color/imagery and content-diff.mjs covers structure/text/role — neither
 * reports the five typography facets a migration must match per block:
 *   TYPE          font-family (the first named face in the computed stack)
 *   WEIGHT        computed font-weight
 *   LINE HEIGHT   line-height / font-size ratio (unitless — comparable
 *                 across different font sizes, unlike a raw px line-height)
 *   LINE SPACE    letter-spacing, in px
 *   LINE WEIGHT   stroke width of any rule the element renders as — a
 *                 <hr>/border-bottom divider, or a text-decoration
 *                 (underline) thickness
 *
 * Every text-bearing element matching a role selector (h1..h6, p, li, a,
 * blockquote, hr) is sampled on both sides, labelled with its nearest
 * classed ancestor ("block" — the EDS block name on the build side, the
 * closest identifiable container on the source side), then rows are
 * aligned by (role, order-within-role) — the same positional key
 * content-diff.mjs's structural probes use, since the two DOMs are never
 * structurally identical. Read the printed source/build sample text on a
 * DIFF row to confirm the alignment before trusting the flag.
 *
 * Usage:
 *   node typography-diff.mjs <sourceURL> <buildURL> [options]
 *     --main <selector>      content root to sample             (default "main")
 *     --width <px>           viewport width                     (default 1280)
 *     --ua <string>          user agent                         (default: real-Chrome desktop UA)
 *     --wait-until <state>   goto wait state override (see visual-diff.mjs for the
 *                            three-tier default: localhost/EDS origins → networkidle,
 *                            other live http(s) → domcontentloaded)
 *     --dismiss [sel,...]    dismiss overlays (consent + timed marketing modals) on
 *                            both sides; optional comma-separated extra selectors
 *     --headed               escalation: headed stealth real Chrome (bot-managed sites)
 *     --locale <tag>         pin Accept-Language + context locale (geo determinism)
 *     --role <name>          only report this role (repeatable), e.g. --role h1 --role p
 *
 * Tolerances (a delta inside these is MATCH, not DIFF — computed-style
 * rounding and sub-pixel rendering differences are noise, not defects):
 *   weight ±0, lineHeight ±0.05, letterSpacing ±0.3px, ruleWeight ±0.5px
 *
 * Exit codes: 0 ran (DIFF rows are advisory, like every other probe here —
 * they do NOT fail the run), 1 error, 3 bot challenge/blocked live side
 * (BotChallengeError — escalate with --headed).
 */

/* eslint-disable import/no-extraneous-dependencies, import/extensions, no-await-in-loop, no-restricted-syntax, brace-style, object-curly-newline, max-len, no-plusplus, no-continue */
/* standalone dev tool: playwright is a devDependency; sequential page ops are awaited by design */
import { chromium } from 'playwright';
import { isLiveHttpUrl, defaultWaitUntil, launchStealthHeaded, newLiveContext, gotoLive, dismissOverlays, REAL_CHROME_UA } from './live-session.mjs';

const USAGE = `usage: node typography-diff.mjs <sourceURL> <buildURL> [options]
  --main <selector>      content root to sample          (default "main")
  --width <px>           viewport width                  (default 1280)
  --ua <string>          user agent (default: real-Chrome desktop UA)
  --wait-until <state>   goto wait state override
  --dismiss [sel,...]    dismiss overlays on both sides
  --headed               headed stealth real Chrome (escalation for bot-managed sites)
  --locale <tag>         pin Accept-Language + locale (e.g. en-GB)
  --role <name>          only report this role (repeatable)
exit codes: 0 ran (DIFF rows advisory), 1 error, 3 bot challenge (live side blocked)
`;

const ROLE_SELECTORS = { h1: 'h1', h2: 'h2', h3: 'h3', h4: 'h4', h5: 'h5', h6: 'h6', body: 'p', item: 'li', link: 'a', quote: 'blockquote', rule: 'hr' };

function parseArgs(argv) {
  const [, , source, build, ...rest] = argv;
  if (rest.includes('--help') || source === '--help' || source === '-h') { process.stdout.write(USAGE); process.exit(0); }
  const opts = { main: 'main', width: 1280, ua: REAL_CHROME_UA, waitUntil: null, dismiss: null, headed: false, locale: null, roles: [] };
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
    else if (a === '--role') { opts.roles.push(rest[i += 1]); }
  }
  return { source, build, opts };
}

// Runs IN the page (serialized by Playwright, ONE arg). Returns one row per
// sampled element: role, DOM order within that role, nearest classed
// ancestor label ("block"), a text sample, and the five typography facets.
/* eslint-disable no-undef */
function sample(args) {
  const [mainSel, roleSelectors] = args;
  const root = document.querySelector(mainSel) || document.querySelector('main') || document.body;
  const namedFamily = (ff) => ((ff || '').match(/"([^"]+)"|'([^']+)'/) || [])[1] || (ff || '').split(',')[0].trim();
  const round = (n, p = 2) => { const m = 10 ** p; return Math.round(n * m) / m; };
  const blockLabel = (el) => {
    let node = el;
    while (node && node !== root) {
      const cls = (node.getAttribute && node.getAttribute('class')) || '';
      const first = cls.trim().split(/\s+/)[0];
      if (first) return first;
      node = node.parentElement;
    }
    return root === document.body ? 'body' : (root.getAttribute('class') || root.tagName || 'main').toString().split(/\s+/)[0];
  };

  const rows = [];
  Object.entries(roleSelectors).forEach(([role, sel]) => {
    const els = [...root.querySelectorAll(sel)].filter((el) => {
      if (role === 'rule') { const r = el.getBoundingClientRect(); return r.width > 0; }
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && el.textContent.trim().length > 0 && el.children.length === 0;
    });
    els.forEach((el, order) => {
      const cs = getComputedStyle(el);
      const fontSize = parseFloat(cs.fontSize) || 16;
      const lineHeightPx = cs.lineHeight === 'normal' ? fontSize * 1.2 : parseFloat(cs.lineHeight);
      let ruleWeight = 0;
      if (role === 'rule') {
        ruleWeight = parseFloat(cs.borderTopWidth) || parseFloat(cs.height) || 0;
      } else if (cs.textDecorationLine !== 'none') {
        ruleWeight = cs.textDecorationThickness === 'auto' ? fontSize * 0.05 : parseFloat(cs.textDecorationThickness) || 0;
      } else {
        ruleWeight = parseFloat(cs.borderBottomWidth) || 0;
      }
      rows.push({
        role,
        order,
        block: blockLabel(el),
        text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 48) || (role === 'rule' ? '<hr>' : ''),
        family: namedFamily(cs.fontFamily),
        weight: Number(cs.fontWeight) || 400,
        lineHeight: round(lineHeightPx / fontSize),
        letterSpacing: round(cs.letterSpacing === 'normal' ? 0 : parseFloat(cs.letterSpacing) || 0),
        ruleWeight: round(ruleWeight),
      });
    });
  });
  return rows;
}
/* eslint-enable no-undef */

async function capture(browser, url, opts) {
  const ctx = await newLiveContext(browser, { ua: opts.ua, locale: opts.locale, viewport: { width: opts.width, height: 1000 } });
  const page = await ctx.newPage();
  await gotoLive(page, url, { waitUntil: opts.waitUntil || defaultWaitUntil(url), timeoutMs: 60000, settleMs: 800, httpError: 'measure', solveWindow: opts.headed });
  if (opts.dismiss) await dismissOverlays(page, { extra: opts.dismiss, lateWindowMs: isLiveHttpUrl(url) ? 6000 : 0 });
  const roleSelectors = opts.roles.length ? Object.fromEntries(Object.entries(ROLE_SELECTORS).filter(([r]) => opts.roles.includes(r))) : ROLE_SELECTORS;
  const rows = await page.evaluate(sample, [opts.main, roleSelectors]);
  await ctx.close();
  return rows;
}

const TOL = { weight: 0, lineHeight: 0.05, letterSpacing: 0.3, ruleWeight: 0.5 };

// Align by (role, order-within-role) and diff the five facets. Grouped by
// role in the return order so the report reads block-type by block-type,
// per the fidelity-pass "check everything, then group findings" workflow.
function diffRows(srcRows, buildRows) {
  const byRole = (rows) => rows.reduce((m, r) => { (m[r.role] ||= []).push(r); return m; }, {});
  const s = byRole(srcRows);
  const b = byRole(buildRows);
  const groups = [];
  for (const role of Object.keys(ROLE_SELECTORS)) {
    if (!s[role] && !b[role]) continue;
    const sr = s[role] || [];
    const br = b[role] || [];
    const n = Math.max(sr.length, br.length);
    const items = [];
    for (let i = 0; i < n; i += 1) {
      const a = sr[i];
      const t = br[i];
      if (!a || !t) { items.push({ i, status: !a ? 'BUILD-ONLY' : 'SOURCE-ONLY', a, t }); continue; }
      const diffs = [];
      if (a.family !== t.family) diffs.push(`type: "${a.family}" -> "${t.family}"`);
      if (Math.abs(a.weight - t.weight) > TOL.weight) diffs.push(`weight: ${a.weight} -> ${t.weight}`);
      if (Math.abs(a.lineHeight - t.lineHeight) > TOL.lineHeight) diffs.push(`line-height: ${a.lineHeight} -> ${t.lineHeight}`);
      if (Math.abs(a.letterSpacing - t.letterSpacing) > TOL.letterSpacing) diffs.push(`line-space: ${a.letterSpacing}px -> ${t.letterSpacing}px`);
      if (Math.abs(a.ruleWeight - t.ruleWeight) > TOL.ruleWeight) diffs.push(`line-weight: ${a.ruleWeight}px -> ${t.ruleWeight}px`);
      items.push({ i, status: diffs.length ? 'DIFF' : 'MATCH', block: t.block, text: t.text || a.text, diffs });
    }
    groups.push({ role, items });
  }
  return groups;
}

function printReport(groups) {
  let diffCount = 0;
  let matchCount = 0;
  groups.forEach(({ role, items }) => {
    if (!items.length) return;
    process.stdout.write(`\n== ${role} (${items.length}) ==\n`);
    items.forEach((it) => {
      if (it.status === 'MATCH') { matchCount += 1; return; }
      if (it.status === 'DIFF') diffCount += 1;
      const label = it.status === 'DIFF' ? `DIFF  [${it.block}]` : it.status;
      process.stdout.write(`  ${label} "${it.text || ''}"\n`);
      (it.diffs || []).forEach((d) => process.stdout.write(`      ${d}\n`));
    });
  });
  process.stdout.write(`\ntypography-diff: ${matchCount} match, ${diffCount} diff (advisory — fix the DIFF rows' block CSS, then re-run)\n`);
}

async function main() {
  const { source, build, opts } = parseArgs(process.argv);
  if (!source || !build) { process.stderr.write(USAGE); process.exit(1); }
  const browser = opts.headed ? await launchStealthHeaded(chromium) : await chromium.launch();
  try {
    const srcRows = await capture(browser, source, opts);
    const buildRows = await capture(browser, build, opts);
    printReport(diffRows(srcRows, buildRows));
  } finally {
    await browser.close();
  }
}

main().catch((e) => { process.stderr.write(`typography-diff error: ${e.message}\n`); process.exit(e.name === 'BotChallengeError' ? 3 : 1); });

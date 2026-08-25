#!/usr/bin/env node
/**
 * page-fidelity-pass/scripts/block-crops.mjs
 *
 * Produces the per-block VISUAL + METRIC artifact the page-fidelity-pass skill
 * fans out to its per-block subagents. It is the one thing the existing probes
 * (visual-diff / content-diff / typography-diff / block-diff) do NOT emit: a
 * matched, positionally-PAIRED set of per-block screenshot crops from BOTH the
 * source (target) page and the migrated (build) page, each annotated with the
 * five fidelity facets a subagent judges — WIDTH, ASSET, LOCATION, FONT, COLOR.
 *
 * It reuses the same "widest classed content container, de-duplicated to the
 * outermost, sorted by vertical order" block heuristic that block-diff.mjs and
 * visual-diff.mjs use, so its block indices line up with those probes' rows —
 * block[i] here is block[i] there. The two DOMs are never structurally
 * identical, so ALWAYS confirm a pair really matches by reading its printed
 * `label` (first heading / lead text) before trusting a facet, exactly like the
 * other probes.
 *
 * Run it from the playwright scripts dir (the one with
 * node_modules/playwright); it imports live-session.mjs as a sibling, so copy
 * live-session.mjs + diff-profiles.mjs in alongside it (see SKILL.md prereqs).
 *
 * Usage:
 *   node block-crops.mjs <sourceURL> <buildURL> --out <dir> [options]
 *     --out <dir>            REQUIRED output dir for crops + manifest.json
 *     --width <px>           viewport width                     (default 1920)
 *     --source-main <sel>    source content root (classic-AEM pages have no
 *                            <main>; pass e.g. ".page-content-container" so the
 *                            source is scoped symmetrically — see Gotcha 16)
 *     --build-main <sel>     build content root                 (default "main")
 *     --dismiss [sel,...]    dismiss consent / marketing overlays on both sides
 *     --headed               headed stealth real Chrome (bot-managed sources)
 *     --locale <tag>         pin Accept-Language + locale (geo determinism)
 *     --chrome               ALSO crop header + footer (outside the content
 *                            root) into <src|build>-chrome-{header,footer}.png —
 *                            the probes scope to <main>, so nav/footer are
 *                            otherwise never captured (site-migration Phase 2 gate)
 *
 * Output (under --out):
 *   source-full.png  build-full.png                 full-page, both sides
 *   source-<NN>-<label>.png  build-<NN>-<label>.png per matched block
 *   {source,build}-chrome-{header,footer}.png       with --chrome
 *   manifest.json    { width, source-main, build-main, counts,
 *                      pairs: [{ i, source:{...facets}, build:{...facets},
 *                                sourceCrop, buildCrop }],
 *                      unpaired: {...} }             the subagent fan-out input
 *
 * Exit codes: 0 ran, 1 error, 3 bot challenge/blocked live side (escalate --headed).
 */

/* eslint-disable import/no-extraneous-dependencies, import/extensions, no-await-in-loop, no-restricted-syntax, brace-style, object-curly-newline, max-len, no-plusplus */
/* standalone dev tool: playwright is a devDependency; sequential page ops are awaited by design */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { launchStealthHeaded, newLiveContext, gotoLive, dismissOverlays, defaultWaitUntil, isLiveHttpUrl } from './live-session.mjs';

const USAGE = `usage: node block-crops.mjs <sourceURL> <buildURL> --out <dir> [options]
  --out <dir>          REQUIRED  output dir for crops + manifest.json
  --width <px>         viewport width (default 1920)
  --source-main <sel>  source content root (classic-AEM has no <main>)
  --build-main <sel>   build content root (default "main")
  --dismiss [sel,...]  dismiss overlays on both sides
  --headed             headed stealth real Chrome (bot-managed sources)
  --locale <tag>       pin Accept-Language + locale
  --chrome             also crop header + footer (outside the content root)
exit: 0 ran, 1 error, 3 bot challenge (escalate --headed)`;

function parseArgs(argv) {
  const a = argv.slice(2);
  const pos = [];
  const o = { width: 1920, buildMain: 'main', out: null, dismiss: null, headed: false, locale: null, chrome: false };
  for (let i = 0; i < a.length; i++) {
    const t = a[i];
    if (t === '--width') o.width = Number(a[++i]);
    else if (t === '--out') o.out = a[++i];
    else if (t === '--source-main') o.sourceMain = a[++i];
    else if (t === '--build-main') o.buildMain = a[++i];
    else if (t === '--locale') o.locale = a[++i];
    else if (t === '--headed') o.headed = true;
    else if (t === '--chrome') o.chrome = true;
    else if (t === '--dismiss') {
      const nxt = a[i + 1];
      if (nxt && !nxt.startsWith('--')) { o.dismiss = nxt.split(',').map((s) => s.trim()).filter(Boolean); i++; }
      else o.dismiss = [];
    } else pos.push(t);
  }
  if (pos.length < 2 || !o.out) { process.stderr.write(`${USAGE}\n`); process.exit(1); }
  [o.source, o.build] = pos;
  return o;
}

// Runs IN the page. Tags each chosen block with data-fid and returns its facets.
/* eslint-disable no-undef */
function collectBlocks(mainSel) {
  const round = (n) => Math.round(n);
  const vw = window.innerWidth;
  const mainEl = (mainSel && document.querySelector(mainSel)) || document.querySelector('main') || document.body;
  // effective ground: block's own bg is often transparent (color lives on the
  // section band) — walk up to the first non-transparent / non-empty background.
  const effBg = (el) => {
    let n = el;
    while (n && n !== document.documentElement) {
      const c = getComputedStyle(n).backgroundColor;
      if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') return c;
      n = n.parentElement;
    }
    return 'rgb(255, 255, 255)';
  };
  const STRUCT = /(^|[\s-])(section|block-content|default-content|wrapper|container|nav|navbar|footer|header|breadcrumb)([\s-]|$)/i;
  let boxes = [...mainEl.querySelectorAll('[class]')].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width >= vw * 0.5 && r.height > 24
      && (el.querySelector('h1,h2,h3,h4,p,img,a,ul,ol,table') || el.matches('img'))
      && !STRUCT.test((el.className || '').toString());
  });
  boxes = boxes.filter((el) => !boxes.some((o) => o !== el && el.contains(o))); // outermost only
  boxes.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
  return boxes.map((el, i) => {
    el.setAttribute('data-fid', String(i));
    const r = el.getBoundingClientRect();
    const h = el.querySelector('h1,h2,h3,h4');
    const tcs = getComputedStyle(h || el.querySelector('p, a, li') || el);
    const named = (tcs.fontFamily.match(/"([^"]+)"|'([^']+)'/) || [])[1];
    const imgs = [...el.querySelectorAll('img')].map((im) => {
      const ir = im.getBoundingClientRect();
      return {
        src: (im.currentSrc || im.src || '').split('/').pop().slice(0, 60),
        natural: `${im.naturalWidth}x${im.naturalHeight}`,
        rendered: `${round(ir.width)}x${round(ir.height)}`,
        failed: ir.width > 1 && ir.height > 1 && (im.naturalWidth === 0 || im.naturalHeight === 0),
      };
    });
    return {
      i,
      sel: (el.className || '').toString().trim().split(/\s+/).slice(0, 3).join('.'),
      label: ((h ? h.textContent : el.textContent) || '').trim().replace(/\s+/g, ' ').slice(0, 48),
      width: round(r.width),
      wFrac: +(r.width / vw).toFixed(2),
      top: round(r.top + window.scrollY),
      height: round(r.height),
      ground: effBg(el),
      textColor: tcs.color,
      fontFamily: named || tcs.fontFamily.split(',')[0].trim(),
      fontSize: tcs.fontSize,
      imgCount: el.querySelectorAll('img, svg').length,
      linkCount: el.querySelectorAll('a').length,
      images: imgs,
    };
  });
}
/* eslint-enable no-undef */

async function capture(browser, url, tag, mainSel, opts) {
  const ctx = await newLiveContext(browser, {
    ua: opts.ua, locale: opts.locale, viewport: { width: opts.width, height: 1000 }, reducedMotion: 'reduce',
  });
  const page = await ctx.newPage();
  await gotoLive(page, url, { waitUntil: opts.waitUntil || defaultWaitUntil(url), timeoutMs: 60000, settleMs: 0, httpError: 'measure', solveWindow: opts.headed });
  await page.waitForTimeout(1500);
  if (opts.dismiss) await dismissOverlays(page, { extra: opts.dismiss, lateWindowMs: isLiveHttpUrl(url) ? 6000 : 0 });
  // scroll to trigger lazy images / reveal-on-scroll, then home
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => { setTimeout(r, 40); }); }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${opts.out}/${tag}-full.png`, fullPage: true });
  const blocks = await page.evaluate(collectBlocks, mainSel);
  for (const blk of blocks) {
    const safe = (blk.label || blk.sel || 'block').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 32).toLowerCase() || 'block';
    const name = `${tag}-${String(blk.i).padStart(2, '0')}-${safe}.png`;
    const loc = page.locator(`[data-fid="${blk.i}"]`).first();
    try { await loc.scrollIntoViewIfNeeded(); await page.waitForTimeout(120); await loc.screenshot({ path: `${opts.out}/${name}` }); blk.crop = name; }
    catch { blk.crop = null; }
  }
  if (opts.chrome) {
    for (const [zone, sels] of [['header', ['header', '.header', '#header', 'nav']], ['footer', ['footer', '.footer', '#footer']]]) {
      for (const s of sels) {
        const loc = page.locator(s).first();
        if (await loc.count()) {
          try { await loc.scrollIntoViewIfNeeded(); await page.waitForTimeout(120); await loc.screenshot({ path: `${opts.out}/${tag}-chrome-${zone}.png` }); break; } catch { /* try next */ }
        }
      }
    }
  }
  await ctx.close();
  return blocks;
}

// Cross-DOM pairing: the source and build DOMs are structurally different and
// often differ in block COUNT (extra source chrome/gates, differently split
// sections), so positional block[i]↔block[i] mis-aligns. Pair by LABEL token
// overlap (Jaccard) instead — greedy, highest-scoring first, each side used
// once — and leave anything below threshold or unmatched in `unpaired` for the
// aggregator to reconcile (a dropped/added section IS a finding).
const tokenize = (s) => new Set((s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length >= 3));
const jaccard = (a, b) => { if (!a.size || !b.size) return 0; let inter = 0; for (const t of a) if (b.has(t)) inter++; return inter / (a.size + b.size - inter); };
function pairBlocks(src, build) {
  const st = src.map((b) => tokenize(b.label));
  const bt = build.map((b) => tokenize(b.label));
  const cand = [];
  build.forEach((_, bi) => src.forEach((__, si) => { const s = jaccard(bt[bi], st[si]); if (s > 0) cand.push({ bi, si, s }); }));
  cand.sort((a, b) => b.s - a.s);
  const usedS = new Set(); const usedB = new Set(); const matched = [];
  for (const c of cand) { if (usedB.has(c.bi) || usedS.has(c.si) || c.s < 0.18) continue; usedB.add(c.bi); usedS.add(c.si); matched.push(c); }
  matched.forEach((c) => { c.by = 'label'; });
  // Positional fallback: reworded headings (e.g. "Share price" vs "270.0 p")
  // score 0 on labels but are still the same block. Pair remaining build blocks
  // with the remaining source block nearest in vertical position fraction (each
  // page's own top/height), tagged by:"position" + a low confidence so the
  // subagent treats the pair as a HYPOTHESIS to confirm from the crops.
  const srcMaxTop = Math.max(1, ...src.map((b) => b.top + b.height));
  const bldMaxTop = Math.max(1, ...build.map((b) => b.top + b.height));
  const remB = build.map((_, bi) => bi).filter((bi) => !usedB.has(bi));
  const remS = src.map((_, si) => si).filter((si) => !usedS.has(si));
  const pcand = [];
  remB.forEach((bi) => remS.forEach((si) => { pcand.push({ bi, si, d: Math.abs(build[bi].top / bldMaxTop - src[si].top / srcMaxTop) }); }));
  pcand.sort((a, b) => a.d - b.d);
  for (const c of pcand) { if (usedB.has(c.bi) || usedS.has(c.si) || c.d > 0.15) continue; usedB.add(c.bi); usedS.add(c.si); matched.push({ ...c, s: 0, by: 'position' }); }
  matched.sort((a, b) => build[a.bi].top - build[b.bi].top);
  const pairs = matched.map((c, idx) => ({ i: idx, by: c.by, score: +(c.s || 0).toFixed(2), sourceCrop: src[c.si].crop, buildCrop: build[c.bi].crop, source: src[c.si], build: build[c.bi] }));
  const unpaired = { source: src.filter((_, si) => !usedS.has(si)), build: build.filter((_, bi) => !usedB.has(bi)) };
  return { pairs, unpaired };
}

async function main() {
  const opts = parseArgs(process.argv);
  opts.out = resolve(process.cwd(), opts.out);
  mkdirSync(opts.out, { recursive: true });
  const browser = opts.headed ? await launchStealthHeaded(chromium) : await chromium.launch();
  try {
    const src = await capture(browser, opts.source, 'source', opts.sourceMain, opts);
    const build = await capture(browser, opts.build, 'build', opts.buildMain, opts);
    const { pairs, unpaired } = pairBlocks(src, build);
    const manifest = {
      width: opts.width,
      sourceUrl: opts.source,
      buildUrl: opts.build,
      sourceMain: opts.sourceMain || '(auto: main|body)',
      buildMain: opts.buildMain,
      counts: { source: src.length, build: build.length, paired: pairs.length },
      pairs,
      unpaired,
    };
    writeFileSync(`${opts.out}/manifest.json`, JSON.stringify(manifest, null, 2));
    process.stdout.write(`block-crops @${opts.width}px → ${opts.out}\n`);
    process.stdout.write(`  source blocks ${src.length} | build blocks ${build.length} | paired ${pairs.length} (label match)\n`);
    pairs.forEach((p) => {
      const tag = p.by === 'label' ? `${(p.score * 100).toFixed(0)}% label` : 'position?';
      process.stdout.write(`  [${String(p.i).padStart(2, '0')}] ${tag} src "${p.source.label}" ↔ build "${p.build.label}"\n`);
    });
    if (unpaired.build.length) process.stdout.write(`  ⚠ ${unpaired.build.length} BUILD block(s) unmatched (possible EXTRA/altered content): ${unpaired.build.map((b) => `"${b.label}"`).join(', ')}\n`);
    if (unpaired.source.length) process.stdout.write(`  ⚠ ${unpaired.source.length} SOURCE block(s) unmatched (possible DROPPED content or source chrome/gate): ${unpaired.source.map((b) => `"${b.label}"`).join(', ')}\n`);
    await browser.close();
  } catch (e) {
    await browser.close();
    process.stderr.write(`block-crops error: ${e.message}\n`);
    process.exit(e.name === 'BotChallengeError' ? 3 : 1);
  }
}

main();

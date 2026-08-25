// site-migration: decode-based broken-image + console-error gate (Gotcha 15).
//
// WHY: a DA round-trip can rewrite an unreachable <img src> to `about:error`
// (ERR_UNKNOWN_URL_SCHEME) — which emits NO HTTP response, so a
// `response.status >= 400` check and a `curl` of the asset (which may 200 from
// the code bus) BOTH pass while the image is blank. The only reliable signal is
// `img.naturalWidth === 0` evaluated IN-BROWSER on the DEPLOYED page. The local
// `--html-folder drafts` server also can't reproduce this (it bypasses the DA
// pipeline — Gotcha 13), so ALWAYS point this at the real aem.page/aem.live URL.
//
// Playwright rule: run this from the scrape-webpage/scripts dir (where
// node_modules/playwright lives) — copy it in per the skill prerequisites.
//
// Usage:  node image-audit.mjs "<deployed-url>" [--width 1920] [--dismiss]
// Exit:   0 = all images decoded (naturalWidth>0) and 0 console errors
//         2 = one or more broken images or console errors (hard gate failure)
//         1 = probe error (navigation/bot block)
/* eslint-disable no-console */
import { chromium } from 'playwright';

const url = process.argv[2];
const widthArg = process.argv.indexOf('--width');
const width = widthArg > -1 ? Number(process.argv[widthArg + 1]) : 1920;
const dismiss = process.argv.includes('--dismiss');
if (!url) { console.error('usage: node image-audit.mjs "<url>" [--width 1920] [--dismiss]'); process.exit(1); }

const b = await chromium.launch();
try {
  const p = await b.newPage();
  await p.setViewportSize({ width, height: 1000 });
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 140)); });
  p.on('requestfailed', (r) => errors.push(`REQFAIL ${r.url().slice(0, 90)} ${r.failure()?.errorText || ''}`));
  await p.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  if (dismiss) {
    for (const s of ['#onetrust-accept-btn-handler', 'button:has-text("Accept")', 'button:has-text("Agree")']) {
      try { const el = await p.$(s); if (el) await el.click({ timeout: 1500 }); } catch { /* noop */ }
    }
  }
  await p.waitForTimeout(1500);
  const broken = await p.evaluate(() => [...document.querySelectorAll('img')]
    .filter((i) => i.naturalWidth === 0)
    .map((i) => ({ src: (i.currentSrc || i.src || '(empty)').slice(0, 90), alt: (i.alt || '').slice(0, 40) })));
  console.log(`image-audit ${url} @${width}px`);
  console.log(`  images broken (naturalWidth===0): ${broken.length}`);
  broken.forEach((i) => console.log(`   ✗ ${i.src}  | alt="${i.alt}"`));
  console.log(`  console errors: ${errors.length}`);
  errors.slice(0, 10).forEach((e) => console.log(`   ! ${e}`));
  await b.close();
  process.exit(broken.length || errors.length ? 2 : 0);
} catch (e) {
  await b.close();
  console.error('image-audit error:', e.message);
  process.exit(1);
}

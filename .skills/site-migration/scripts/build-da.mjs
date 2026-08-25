// site-migration: transform local drafts (.plain.html) into DA source documents.
// Generic template — set CONFIG for your migration, then `node build-da.mjs`.
//
// DA source docs are BODY FRAGMENTS: <body><header></header><main>…sections…</main><footer></footer></body>
// (no doctype/html/head/script/style). Images must be REACHABLE URLs — reference the
// original source URLs (DA sideloads them) taken from import-work/metadata.json.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const ROOT = new URL('../../../', import.meta.url); // adjust to your repo root
const draft = (p) => readFileSync(new URL(`drafts/${p}`, ROOT), 'utf8');
const out = (p, s) => writeFileSync(new URL(`deploy/${p}`, ROOT), s);
mkdirSync(new URL('deploy/', ROOT), { recursive: true });

const CONFIG = {
  page: 'index.plain.html',           // drafts file for the page — set per migration
  nav: 'nav.plain.html',              // drafts file for the nav fragment
  footer: 'footer.plain.html',        // drafts file for the footer fragment
  logoLocal: '/drafts/images/logo.png',
  logoUrl: 'https://content.da.live/{org}/{repo}/media/logo.png', // pre-uploaded logo
  // local ./images/<file>  ->  original reachable source URL (from import-work/metadata.json)
  images: {
    // './images/abc.png': 'https://source.example/dam/hero.png',
  },
};

const pageSlug = CONFIG.page.replace(/\.plain\.html$/, ''); // drafts/<slug>.plain.html -> deploy/<slug>.html

const wrap = (inner) => `<body>\n  <header></header>\n  <main>\n${inner}\n  </main>\n  <footer></footer>\n</body>\n`;

// page: swap image URLs, strip the LOCAL-PREVIEW nav/footer override, wrap
let page = draft(CONFIG.page);
for (const [local, url] of Object.entries(CONFIG.images)) page = page.split(local).join(url);
page = page.replace(/\n\s*<!-- LOCAL-PREVIEW OVERRIDE[\s\S]*?\/drafts\/footer<\/div>\s*<\/div>/, '');
out(`${pageSlug}.html`, wrap(page.trimEnd()));

// nav: point logo at its DA media URL, wrap
out('nav.html', wrap(draft(CONFIG.nav).split(CONFIG.logoLocal).join(CONFIG.logoUrl).trimEnd()));

// footer: wrap
out('footer.html', wrap(draft(CONFIG.footer).trimEnd()));

// guard rails
const p = readFileSync(new URL(`deploy/${pageSlug}.html`, ROOT), 'utf8');
console.log('checks:',
  ['<main>', '</main>'].every((s) => p.includes(s)) ? 'skeleton OK' : 'SKELETON MISSING',
  !p.includes('./images/') ? '| no local imgs' : '| LOCAL IMGS REMAIN',
  !p.includes('/drafts/nav') ? '| override stripped' : '| OVERRIDE REMAINS');
console.log(`wrote deploy/{${pageSlug},nav,footer}.html`);

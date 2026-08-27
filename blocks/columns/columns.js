function decorateIntroVideo(block) {
  const link = block.querySelector('a[href*="brightcove.net"]');
  if (!link) return;
  const src = link.getAttribute('href');
  const col = link.closest('div');
  const picture = col.querySelector('picture');
  const label = link.textContent.trim() || 'Video';

  const facade = document.createElement('div');
  facade.className = 'intro-video';
  if (picture) facade.append(picture);

  const play = document.createElement('button');
  play.type = 'button';
  play.className = 'intro-video-play';
  play.setAttribute('aria-label', `Play video: ${label}`);
  facade.append(play);

  play.addEventListener('click', () => {
    const iframe = document.createElement('iframe');
    iframe.src = `${src}${src.includes('?') ? '&' : '?'}autoplay=1`;
    iframe.title = label;
    iframe.setAttribute('allow', 'autoplay; fullscreen; encrypted-media; picture-in-picture');
    iframe.setAttribute('allowfullscreen', 'true');
    iframe.loading = 'lazy';
    facade.replaceChildren(iframe);
  });

  col.replaceChildren(facade);
}

function wrapRiskbox(startEl) {
  const box = document.createElement('div');
  box.className = 'report-riskbox';
  const items = [];
  for (let n = startEl; n; n = n.nextElementSibling) items.push(n);
  startEl.before(box);
  items.forEach((el) => box.append(el));
  return box;
}

function decorateReport(block) {
  const row = block.firstElementChild;
  if (!row) return;
  const [main, aside] = row.children;
  if (main) {
    main.classList.add('report-main');
    // Only wrap an explicit "Risk factors" heading (+ its body) into the teal
    // box — a long article's own headings must stay in normal flow.
    const heading = [...main.children]
      .find((el) => /^H[2-4]$/.test(el.tagName) && /risk factors/i.test(el.textContent));
    if (heading) wrapRiskbox(heading);
  }
  if (aside) {
    aside.classList.add('report-aside');
    const kids = [...aside.children];
    const imgIdx = kids.findIndex((c) => c.querySelector('picture'));
    // Any leading elements before the card image form the teal risk box.
    if (imgIdx > 0) wrapRiskbox(kids[0]);
    // The card image + trailing text become a bordered card.
    const imgHost = [...aside.children].find((c) => c.querySelector('picture'));
    if (imgHost) {
      const card = document.createElement('div');
      card.className = 'report-card';
      imgHost.classList.add('report-card-image');
      const body = document.createElement('div');
      body.className = 'report-card-body';
      const rest = [];
      for (let n = imgHost.nextElementSibling; n; n = n.nextElementSibling) rest.push(n);
      imgHost.before(card);
      card.append(imgHost);
      rest.forEach((el) => body.append(el));
      if (rest.length) card.append(body);
    }
  }
}

export default function decorate(block) {
  const cols = [...block.firstElementChild.children];
  block.classList.add(`columns-${cols.length}-cols`);

  // setup image columns
  [...block.children].forEach((row) => {
    [...row.children].forEach((col) => {
      const pic = col.querySelector('picture');
      if (pic) {
        const picWrapper = pic.closest('div');
        if (picWrapper && picWrapper.children.length === 1) {
          // picture is only content in column
          picWrapper.classList.add('columns-img-col');
        }
      }
    });
  });

  if (block.classList.contains('intro')) decorateIntroVideo(block);
  if (block.classList.contains('report')) decorateReport(block);
}

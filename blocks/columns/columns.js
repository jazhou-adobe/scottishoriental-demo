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

function decorateReport(block) {
  const row = block.firstElementChild;
  if (!row) return;
  const [main, aside] = row.children;
  if (main) {
    main.classList.add('report-main');
    const heading = main.querySelector('h2, h3, h4');
    if (heading) {
      const box = document.createElement('div');
      box.className = 'report-riskbox';
      const items = [];
      for (let n = heading; n; n = n.nextElementSibling) items.push(n);
      heading.before(box);
      items.forEach((el) => box.append(el));
    }
  }
  if (aside) {
    aside.classList.add('report-aside');
    const imgHost = [...aside.children].find((c) => c.querySelector('picture'));
    if (imgHost) imgHost.classList.add('report-card-image');
    const body = document.createElement('div');
    body.className = 'report-card-body';
    [...aside.children].forEach((c) => { if (c !== imgHost) body.append(c); });
    aside.append(body);
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

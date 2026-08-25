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
}

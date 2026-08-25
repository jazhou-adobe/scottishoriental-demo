import { createOptimizedPicture } from '../../scripts/aem.js';

export default function decorate(block) {
  [...block.children].forEach((row) => {
    const cells = [...row.children];
    const hasMedia = cells.some((c) => c.children.length === 1 && c.querySelector(':scope > picture'));
    if (hasMedia && cells.length > 1) row.classList.add('panel-media');
    cells.forEach((c) => {
      if (c.children.length === 1 && c.querySelector(':scope > picture')) c.classList.add('panel-media-col');
    });
  });
  block.querySelectorAll('picture > img').forEach((img) => {
    img.closest('picture').replaceWith(createOptimizedPicture(img.src, img.alt, false, [{ width: '750' }]));
  });
}

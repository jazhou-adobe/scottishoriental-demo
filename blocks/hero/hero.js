import { createOptimizedPicture } from '../../scripts/aem.js';

export default function decorate(block) {
  const picture = block.querySelector('picture');

  // Collect the remaining text content (h1 + CTA) into a single content div,
  // skipping the picture (which becomes the background layer).
  const content = document.createElement('div');
  content.className = 'hero-content';
  block.querySelectorAll(':scope > div > div').forEach((cell) => {
    [...cell.childNodes].forEach((node) => {
      if (node === picture || (node.contains && node.contains(picture))) return;
      content.append(node);
    });
  });

  block.replaceChildren();

  // Hoist the picture to be the first direct child (background layer).
  if (picture) {
    const img = picture.querySelector('img');
    const bg = img
      ? createOptimizedPicture(img.src, img.alt, false, [{ width: '2000' }])
      : picture;
    block.append(bg);
  }

  block.append(content);
}

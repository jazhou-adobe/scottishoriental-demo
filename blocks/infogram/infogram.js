const LOADER_ID = 'infogram-async';

/**
 * Loads the Infogram embed-loader once. If it is already present and
 * initialised (e.g. another infogram block on the page), re-run its
 * processor so the newly-inserted embed is picked up.
 */
function loadInfogramLoader() {
  if (window.InfogramEmbeds && window.InfogramEmbeds.initialized) {
    window.InfogramEmbeds.process?.();
    return;
  }
  if (document.getElementById(LOADER_ID)) return;
  const script = document.createElement('script');
  script.id = LOADER_ID;
  script.async = true;
  script.src = 'https://e.infogram.com/js/dist/embed-loader-min.js';
  document.head.append(script);
}

/**
 * Decorates an infogram block: reads the authored key/value rows
 * (`id`, optional `type`, optional `title`), builds the Infogram embed
 * placeholder, and loads the embed-loader that swaps it for the chart iframe.
 * @param {Element} block the infogram block element
 */
export default function decorate(block) {
  const cfg = {};
  [...block.children].forEach((row) => {
    const cells = [...row.children];
    const key = cells[0]?.textContent.trim().toLowerCase();
    const value = cells[1]?.textContent.trim();
    if (key) cfg[key] = value;
  });

  const { id, type = 'interactive', title = '' } = cfg;
  block.textContent = '';
  if (!id) return;

  const embed = document.createElement('div');
  embed.className = 'infogram-embed';
  embed.dataset.id = id;
  embed.dataset.type = type;
  if (title) embed.dataset.title = title;
  block.append(embed);

  loadInfogramLoader();
}

const loaded = new Set();

function loadHubspotEmbed(region, portalId) {
  const key = `${region}:${portalId}`;
  if (loaded.has(key)) return;
  loaded.add(key);
  const script = document.createElement('script');
  script.src = `https://js-${region}.hsforms.net/forms/embed/developer/${portalId}.js`;
  script.defer = true;
  document.head.append(script);
}

export default function decorate(block) {
  const cfg = {};
  [...block.children].forEach((row) => {
    const cells = [...row.children];
    const key = cells[0]?.textContent.trim().toLowerCase();
    const value = cells[1]?.textContent.trim();
    if (key) cfg[key] = value;
  });

  const { region, portal, form } = cfg;
  block.textContent = '';
  if (!region || !portal || !form) return;

  const frame = document.createElement('div');
  frame.className = 'hs-form-html';
  frame.dataset.region = region;
  frame.dataset.portalId = portal;
  frame.dataset.formId = form;
  block.append(frame);

  loadHubspotEmbed(region, portal);
}

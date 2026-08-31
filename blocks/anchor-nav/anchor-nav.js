/**
 * Decorates the anchor-nav block: a sticky in-page navigation bar that jumps
 * to the section headings referenced by its links, highlights the active
 * section on scroll, and appends a "Back to top" control.
 * @param {Element} block the anchor-nav block element
 */
export default function decorate(block) {
  const links = [...block.querySelectorAll('a[href^="#"]')];
  if (!links.length) return;

  const nav = document.createElement('nav');
  nav.className = 'anchor-nav-bar';
  nav.setAttribute('aria-label', 'On this page');
  const list = document.createElement('ul');

  links.forEach((a) => {
    const li = document.createElement('li');
    const link = document.createElement('a');
    link.href = a.getAttribute('href');
    link.textContent = a.textContent.trim();
    li.append(link);
    list.append(li);
  });
  nav.append(list);

  const top = document.createElement('a');
  top.className = 'anchor-nav-top';
  top.href = '#';
  top.setAttribute('aria-label', 'Back to top');
  top.addEventListener('click', (e) => {
    e.preventDefault();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  nav.append(top);

  block.textContent = '';
  block.append(nav);

  // scrollspy: highlight the link whose target section is in view
  const map = new Map();
  list.querySelectorAll('a').forEach((link) => {
    const target = document.getElementById(decodeURIComponent(link.hash.slice(1)));
    if (target) map.set(target, link);
  });

  if (map.size && 'IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          list.querySelectorAll('a').forEach((l) => l.classList.remove('active'));
          map.get(entry.target)?.classList.add('active');
        }
      });
    }, { rootMargin: '-96px 0px -70% 0px', threshold: 0 });
    map.forEach((_, target) => observer.observe(target));
  }
}

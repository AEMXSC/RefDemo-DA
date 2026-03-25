const VALID_HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

export default async function decorate(block) {
  block.querySelectorAll('p[data-aue-prop="tabsstyle"]').forEach((node) => {
    const style = node.textContent?.trim();
    if (style && style !== 'default') block.classList.add(style);
    let container = node;
    while (container && container.parentElement !== block) container = container.parentElement;
    if (container?.parentElement === block) container.remove();
    else node.remove();
  });

  const tabItems = [];

  [...block.children].forEach((row) => {
    if (!row?.firstElementChild) return;
    const cols = [...row.children];
    if (cols.length < 2) return;

    const titleCol = cols[0];
    const headingCol = cols[1];
    const headingTypeCol = cols[2];
    const imageCol = cols[3];
    const contentCol = cols[4];

    const labelText = titleCol?.textContent?.trim() || '';
    if (!labelText) return;

    const headingText = headingCol?.textContent?.trim() || '';
    const headingType = headingTypeCol?.textContent?.trim().toLowerCase() || '';

    const content = document.createElement('div');
    content.className = 'tabs-content';

    if (headingText) {
      const tag = VALID_HEADING_TAGS.has(headingType) ? headingType : 'h2';
      const heading = document.createElement(tag);
      heading.textContent = headingText;
      content.appendChild(heading);
    }

    const picture = imageCol?.querySelector('picture');
    if (picture) content.appendChild(picture);

    if (contentCol?.innerHTML?.trim()) {
      const textDiv = document.createElement('div');
      textDiv.className = 'tabs-text';
      textDiv.innerHTML = contentCol.innerHTML;
      content.appendChild(textDiv);
    }

    row.textContent = '';
    row.appendChild(titleCol);
    row.appendChild(content);

    tabItems.push({ row, labelText });
  });

  const nav = document.createElement('div');
  nav.className = 'tabs-nav';
  nav.setAttribute('role', 'tablist');

  tabItems.forEach(({ row, labelText }, i) => {
    row.classList.add('tabs-item');
    if (i === 0) row.classList.add('active');

    const btn = document.createElement('button');
    btn.className = 'tabs-tab';
    btn.textContent = labelText;
    btn.setAttribute('aria-selected', String(i === 0));
    btn.setAttribute('role', 'tab');
    btn.setAttribute('type', 'button');

    btn.addEventListener('click', () => {
      block.querySelectorAll('.tabs-item').forEach((el) => el.classList.remove('active'));
      nav.querySelectorAll('.tabs-tab').forEach((b) => b.setAttribute('aria-selected', 'false'));
      row.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
    });

    nav.appendChild(btn);
  });

  block.prepend(nav);
}

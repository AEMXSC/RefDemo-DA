const buildOutPattern = (len, pattern) => {
  const doc = document.createElement('div');
  doc.innerHTML = pattern;
  const patternDom = doc.firstElementChild;
  const dataRow = patternDom.querySelector('[data-row]');

  if (dataRow.getAttribute('data-row') === 'n-length') {
    dataRow.setAttribute('data-row', 0);
    for (let i = 1; i < len; i += 1) {
      const rowCopy = dataRow.cloneNode(true);
      rowCopy.setAttribute('data-row', i);
      dataRow.insertAdjacentElement('afterend', rowCopy);
    }
  }
  return patternDom;
};

const cleanUp = () => {
  const dels = document.querySelectorAll('._delete');
  dels.forEach((item) => {
    item.remove();
  });
};

const fetchTemplate = async () => {
  try {
    const resp = await fetch('https://raw.githubusercontent.com/AdobeHOLs/universal-demo/refs/heads/demo73/blocks/cards/_default.html');
    const templateText = await resp.text();
    return templateText;
  } catch {
    // no template found
    return '';
  }
};

export const patternDecorate = async (block) => {
  const pattern = await fetchTemplate(block);
  const patternDom = buildOutPattern(block.children.length, pattern);
  const blockAttr = block.attributes;
  const attrObj = {};
  Object.values(blockAttr).forEach((item) => attrObj[item.name] = item.value);
  attrObj.class += ` ${patternDom.getAttribute('class')}`;

  /** ammend block element */
  Object.entries(attrObj).forEach(([key, value]) => block.setAttribute(key, value));
  block.innerHTML = patternDom.innerHTML;
  cleanUp();
};

export default patternDecorate;

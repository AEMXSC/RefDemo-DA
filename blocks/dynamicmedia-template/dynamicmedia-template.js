/**
 * @param {HTMLElement} $block
 */
export default async function decorate(block) {
  const inputs = block.querySelectorAll('.dynamicmedia-template > div');
  const configSrc = Array.from(block.children)[0]?.textContent?.trim();

  if (configSrc === 'inline' || !configSrc) {
    // Get DM Url input
    const templateURL = inputs[1]?.textContent?.trim();
    const variablemapping = inputs[2]?.textContent?.trim();

    if (!templateURL) {
      block.innerHTML = '';
      return;
    }

    // Split by comma first, then handle each parameter pair
    const paramPairs = variablemapping.split(',');
    const paramObject = {};

    if (paramPairs) {
      paramPairs.forEach((pair) => {
        const indexOfEqual = pair.indexOf('=');
        if (indexOfEqual !== -1) {
          const key = pair.slice(0, indexOfEqual).trim();
          let value = pair.slice(indexOfEqual + 1).trim();

          // Remove trailing comma (if any)
          if (value.endsWith(',')) {
            value = value.slice(0, -1);
          }

          // Only add if key is not empty
          if (key) {
            paramObject[key] = value;
          }
        }
      });
    }

    // Manually construct the query string (preserving `$` in keys)
    const queryString = Object.entries(paramObject)
      .map(([key, value]) => `${key}=${value}`)
      .join('&');

    // Combine with template URL (already includes ? or not)
    const finalUrl = templateURL.includes('?')
      ? `${templateURL}&${queryString}`
      : `${templateURL}?${queryString}`;

    if (finalUrl) {
      const finalImg = document.createElement('img');
      Object.assign(finalImg, {
        className: 'dm-template-image',
        src: finalUrl,
        alt: 'dm-template-image',
      });
      finalImg.onerror = () => {
        finalImg.src = 'https://smartimaging.scene7.com/is/image/DynamicMediaNA/WKND%20Template?wid=2000&hei=2000&qlt=100&fit=constrain';
        finalImg.alt = 'Fallback image - template image not correctly authored';
      };
      block.innerHTML = '';
      block.append(finalImg);
    }
  }
}

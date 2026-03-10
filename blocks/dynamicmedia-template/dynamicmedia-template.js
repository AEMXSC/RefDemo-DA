import { getMetadata } from '../../scripts/aem.js';
import { getHostname, isAuthorEnvironment } from '../../scripts/utils.js';

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
  } else if (configSrc === 'cf') {
    const CONFIG = {
      WRAPPER_SERVICE_URL: 'https://3635370-refdemoapigateway-stage.adobeioruntime.net/api/v1/web/ref-demo-api-gateway/fetch-cf',
      GRAPHQL_QUERY: '/graphql/execute.json/ref-demo-eds/DynamicMediaTemplateByPath',
    };

    const hostnameFromPlaceholders = await getHostname();
    const hostname = hostnameFromPlaceholders || getMetadata('hostname');
    const aemauthorurl = getMetadata('authorurl') || '';

    const aempublishurl = hostname?.replace('author', 'publish')?.replace(/\/$/, '');

    const contentPath = block.querySelector('p.button-container > a')?.textContent?.trim();
    const isAuthor = isAuthorEnvironment();

    // Prepare request configuration based on environment
    const requestConfig = isAuthor
      ? {
        url: `${aemauthorurl}${CONFIG.GRAPHQL_QUERY};path=${contentPath};ts=${Date.now()}`,
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      }
      : {
        url: `${CONFIG.WRAPPER_SERVICE_URL}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graphQLPath: `${aempublishurl}${CONFIG.GRAPHQL_QUERY}`,
          cfPath: contentPath,
          variation: `master;ts=${Date.now()}`,
        }),
      };

    try {
      const response = await fetch(requestConfig.url, {
        method: requestConfig.method,
        headers: requestConfig.headers,
        ...(requestConfig.body && { body: requestConfig.body }),
      });

      if (!response.ok) {
        block.innerHTML = '';
        return;
      }

      const offer = await response.json();
      const templateURL = offer?.data?.dynamicMediaTemplateByPath?.item?.dm_template;
      const paramPairs = offer?.data?.dynamicMediaTemplateByPath?.item?.var_mapping;

      const paramObject = {};

      paramPairs.forEach((pair) => {
        const indexOfEqual = pair.indexOf('=');
        const key = pair.slice(0, indexOfEqual).trim();
        let value = pair.slice(indexOfEqual + 1).trim();

        if (value.endsWith(',')) {
          value = value.slice(0, -1);
        }
        paramObject[key] = value;
      });

      const queryString = Object.entries(paramObject)
        .map(([key, value]) => `${key}=${value}`)
        .join('&');

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
    } catch (error) {
      block.innerHTML = '';
    }
  }
}

// add delayed functionality here
import { getMetadata, loadScript } from './aem.js';

// Adobe Target - start

window.targetGlobalSettings = {
  bodyHidingEnabled: false,
};

function loadAT() {
  loadScript(`${window.hlx.codeBasePath}/scripts/at-lsig.js`);
}
// Adobe Target - end

/**
 * Finds and embeds custom JS and css
 */
function embedCustomLibraries() {
  const externalLibs = getMetadata('js-files');
  const libsArray = externalLibs?.split(',').map((url) => url.trim());

  libsArray.forEach((url) => {
    loadScript(`${url}`);
  });
}

if (!window.location.hostname.includes('localhost')) {
  loadAT();
  embedCustomLibraries();
}

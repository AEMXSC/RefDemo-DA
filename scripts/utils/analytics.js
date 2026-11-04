
export function getAdobeImsUserDetails() {
  const ims = window.adobeIMS || {};

  const getProfile = () => {
    const store = ims?.profileService?.storage?.storage || {};
    const key = Object.keys(store).find((k) => k.includes('adobeid_ims_profile'));
    if (!key) return {};
    try {
      return JSON.parse(store[key]);
    } catch (e) {
      return {};
    }
  };

  const profile = getProfile();

  return {
    username: profile.displayName || profile.name || '',
    email: profile.email || '',
    userId: profile.userId || profile.authId || '',
    ownerOrg: profile.ownerOrg || '',
    countryCode: profile.countryCode || '',
    isGuest: Boolean(profile.isFederatedGuest),
    environment: ims?.adobeIdData?.environment || 'prod',
  };
}

export async function getClientIP() {
  try {
    const response = await fetch('https://api.ipify.org?format=json');
    const data = await response.json();
    return data.ip;
  } catch (error) {
    console.error('Failed to get client IP:', error);
    return null;
  }
}

export async function sendAnalyticsData(eVarNEventsData = []) {
  try {

    const clientIP = await getClientIP();
    const pageURL = window.location.href;
    const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '';

    const imsUser = getAdobeImsUserDetails();

    const eVarElements = eVarNEventsData
      .map((item) => `        <${item.key}>${item.value}</${item.key}>`)
      .join('\n');

    const optionalElements = [];
    if (clientIP) optionalElements.push(`        <ipAddress>${clientIP}</ipAddress>`);
    if (userAgent) optionalElements.push(`        <userAgent>${userAgent}</userAgent>`);
    if (eVarElements) optionalElements.push(eVarElements);
    if (imsUser.userId) optionalElements.push(`        <eVar3>${imsUser.userId}</eVar3>`);
    if (imsUser.ownerOrg) optionalElements.push(`        <eVar14>${imsUser.ownerOrg}</eVar14>`);

    const xmlBody = `<?xml version="1.0" encoding="UTF-8"?>
    <request>
            <pageURL>${pageURL}</pageURL>
            <reportSuiteID>aemholreferencedemo</reportSuiteID>
    ${optionalElements.join('\n')}
    </request>`;

    const analyticsUrl = 'https://aemhol0.112.2o7.net/b/ss/aemholreferencedemo/6';

    const response = await fetch(analyticsUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml' },
      body: xmlBody,
    });

    const content = await response.text();

    if (!response.ok) {
      throw new Error(`Analytics request failed: ${response.status} ${response.statusText}`);
    }

    return content;
  } catch (e) {
    console.error('[ai-image-generator] sendAnalyticsData ERROR:', e.constructor.name, e.message);
    throw e;
  }
}

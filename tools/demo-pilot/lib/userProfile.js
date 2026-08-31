/*
 * userProfile — fetch the signed-in user's email from Adobe IMS. Ported
 * verbatim from the UE extension: host-agnostic, only needs a bearer token.
 */

const IMS_PROFILE_URL = 'https://ims-na1.adobelogin.com/ims/profile/v1';

export async function fetchUserEmail(token) {
  if (!token) return '';
  try {
    const resp = await fetch(IMS_PROFILE_URL, { headers: { Authorization: `Bearer ${token}` } });
    if (!resp.ok) return '';
    const profile = await resp.json();
    return (profile && typeof profile.email === 'string' && profile.email) || '';
  } catch (_) {
    return '';
  }
}

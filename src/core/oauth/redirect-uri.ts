/** The most redirect URIs one client registers. */
export const REDIRECT_URIS_MAX = 10;

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Whether a URL is served on this machine: plain http is allowed only there (OAuth 2.1, 8.4.2). */
export function isLoopback(url: URL): boolean {
  return LOOPBACK_HOSTS.has(url.hostname);
}

/** A redirect URI a client may register: an absolute https URL, or http on loopback, with no fragment. */
export function isRedirectUri(text: string): boolean {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return false;
  }
  const isSecure = url.protocol === 'https:' || (url.protocol === 'http:' && isLoopback(url));
  return isSecure && url.hash === '' && !text.includes('#');
}

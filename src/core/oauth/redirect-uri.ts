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

/**
 * Whether a redirect URI a request names is one the client registered: the
 * same text, or, for a loopback URI registered without a port, the same URI
 * on any port. A native client listens on a port the system picks at run
 * time, so the authorization server must allow any port there (RFC 8252, 7.3).
 */
export function isRegisteredRedirectUri(registered: string, requested: string): boolean {
  if (registered === requested) {
    return true;
  }
  let registeredUrl: URL;
  let requestedUrl: URL;
  try {
    registeredUrl = new URL(registered);
    requestedUrl = new URL(requested);
  } catch {
    return false;
  }
  const isPortFree = registeredUrl.protocol === 'http:' && isLoopback(registeredUrl) && registeredUrl.port === '';
  requestedUrl.port = '';
  return isPortFree && requestedUrl.href === registeredUrl.href;
}

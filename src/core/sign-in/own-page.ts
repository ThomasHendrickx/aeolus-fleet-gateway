/**
 * The page of the gateway's own a sign-in's way back names, for both page
 * sign-ins, so the check exists once. A browser resolves the way back:
 * it drops tabs and newlines, reads a backslash as a slash and removes dot
 * segments, so `/a/..//evil.example` ends as `//evil.example`, another
 * site. The way back is kept only when, so resolved, it is a path of the
 * gateway's own, and resolving it again keeps it there.
 */

/** An origin no address is at: a way back resolved against it that keeps it is the gateway's own, wherever the gateway is. */
const OWN_ORIGIN = 'https://gateway.invalid';

/** The way back resolved as a browser resolves it, if it stays at the gateway's own origin. */
function resolvedOf(returnTo: string): string | undefined {
  if (!URL.canParse(returnTo, OWN_ORIGIN)) {
    return undefined;
  }
  const page = new URL(returnTo, OWN_ORIGIN);
  return page.origin === OWN_ORIGIN ? `${page.pathname}${page.search}${page.hash}` : undefined;
}

/** Whether a path begins as a browser reads another site: two slashes, or a slash and a backslash. */
function isAnotherSite(path: string): boolean {
  return path.startsWith('//') || path.startsWith('/\\');
}

/** The page of the gateway's own with its path, query and hash; undefined for anything else. */
export function ownPageOf(returnTo: string): string | undefined {
  if (!returnTo.startsWith('/')) {
    return undefined;
  }
  const resolved = resolvedOf(returnTo);
  if (resolved === undefined || isAnotherSite(resolved)) {
    return undefined;
  }
  // Belt and braces: the value kept, resolved once more, is still the gateway's own and unchanged.
  return resolvedOf(resolved) === resolved ? resolved : undefined;
}

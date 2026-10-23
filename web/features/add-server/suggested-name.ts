/** The most characters of the proxy ship's name the add button shows. */
const BUTTON_NAME_MAX_LENGTH = 20;

/** A proxy ship's name offered from a server's address: its host's first name that says whose it is; none for an IP address, whose numbers say nothing of it. */
export function suggestedName(url: string): string {
  if (!URL.canParse(url)) {
    return '';
  }
  const { hostname } = new URL(url);
  // URL writes every IPv4 host as four numbers, and keeps an IPv6 host in its brackets; the browser runs this too, so no node:net.
  if (/^\d+(\.\d+){3}$/.test(hostname) || hostname.startsWith('[')) {
    return '';
  }
  const labels = hostname.split('.').filter((label) => label !== 'mcp' && label !== 'www');
  return (labels[0] ?? '').toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-+|-+$/g, '');
}

/** The add button's words: the proxy ship's name as typed, cut at 20 characters, or the plain words while none is typed. */
export function addButtonLabel(name: string): string {
  const typed = name.trim();
  if (typed === '') {
    return 'Add as outside party';
  }
  return typed.length > BUTTON_NAME_MAX_LENGTH ? `Add ${typed.slice(0, BUTTON_NAME_MAX_LENGTH)}…` : `Add ${typed}`;
}

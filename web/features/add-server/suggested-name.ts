/** A proxy ship's name offered from a server's address: its host's first name that says whose it is. */
export function suggestedName(url: string): string {
  if (!URL.canParse(url)) {
    return '';
  }
  const labels = new URL(url).hostname.split('.').filter((label) => label !== 'mcp' && label !== 'www');
  return (labels[0] ?? '').toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-+|-+$/g, '');
}

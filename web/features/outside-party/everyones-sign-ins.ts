/**
 * Everyone's sign-ins on a server's page, for approvers (decision 0067, M3):
 * how a removal is said, and the rows Show more adds.
 */

/** A removal said: revoked at the server where it revoked the tokens, removed alone where it offers no revocation or did not answer. */
export function removedMessageOf({ person, party, isRevoked }: { person: string; party: string; isRevoked: boolean }): string {
  return isRevoked ? `${person}'s sign-in is removed, and revoked at ${party}.` : `${person}'s sign-in is removed.`;
}

/** The rows shown with the next page after them, each person once: a removal moves the pages along, so the next page may start with a person already shown. */
export function withNextPage<Row extends { personShipId: string }>(shown: readonly Row[], page: readonly Row[]): Row[] {
  const isShown = new Set(shown.map(({ personShipId }) => personShipId));
  return [...shown, ...page.filter(({ personShipId }) => !isShown.has(personShipId))];
}

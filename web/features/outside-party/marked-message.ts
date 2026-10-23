/** What an A2A agent's repeatable mark says once the API kept it (A9): what a message that died unconfirmed comes to, or that the proxy ship shows it at its next statement, and why. */
export function markedMessageOf({ name, isRepeatable, statementRefusal }: { name: string; isRepeatable: boolean; statementRefusal: string | null }): string {
  const state = `${name} is ${isRepeatable ? 'repeatable' : 'not repeatable'}`;
  if (statementRefusal !== null) {
    return `${state}; the fleet sees it at the proxy ship's next statement: ${statementRefusal}`;
  }
  return isRepeatable ? `${state}: a message that died before it confirmed it is handed again.` : `${state}: a message that died before it confirmed it is not handed again, as it may have run.`;
}

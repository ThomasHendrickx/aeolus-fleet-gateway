/** What a tool's switch says once the API kept it: what the fleet sees now, or that the proxy ship shows it at its next statement, and why. */
export function switchedMessageOf({ tool, isOn, statementRefusal }: { tool: string; isOn: boolean; statementRefusal: string | null }): string {
  const state = `${tool} is ${isOn ? 'on' : 'off'}`;
  if (statementRefusal !== null) {
    return `${state}; the fleet sees it at the proxy ship's next statement: ${statementRefusal}`;
  }
  return isOn ? `${state}: the fleet may call it.` : `${state}: the fleet sees it no more, and a call to it is refused.`;
}

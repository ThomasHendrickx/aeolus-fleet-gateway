/** What the tools table says once a change is kept (gateway scopes 4.3), in a Toast. */
import type { ScopeChange } from './scope-change';

function listOf(scopes: readonly string[]): string {
  return scopes.length <= 1 ? scopes.join('') : `${scopes.slice(0, -1).join(', ')} and ${scopes.at(-1) ?? ''}`;
}

function toolsOf(count: number): string {
  return `${String(count)} ${count === 1 ? 'tool' : 'tools'}`;
}

/** The change, and why the fleet sees it only at the proxy ship's next statement when it does. */
export function statedMessage(message: string, statementRefusal: string | null): string {
  return statementRefusal === null ? message : `${message}; the fleet sees it at the proxy ship's next statement: ${statementRefusal}`;
}

export function scopesSetMessage({ scopes, how, count }: { scopes: readonly string[]; how: ScopeChange; count: number }): string {
  if (how === 'remove') {
    return `${listOf(scopes)} removed from ${toolsOf(count)}`;
  }
  if (scopes.length === 0) {
    return `${toolsOf(count)} need${count === 1 ? 's' : ''} nothing of ${count === 1 ? 'its' : 'their'} own`;
  }
  return `${listOf(scopes)} set on ${toolsOf(count)}`;
}

export function partyScopesSetMessage({ party, scopes }: { party: string; scopes: readonly string[] }): string {
  return scopes.length === 0 ? `Every tool of ${party} needs nothing beyond reaching it` : `Every tool of ${party} needs ${listOf(scopes)}`;
}

export function suggestionsSetMessage(groups: readonly { scopes: readonly string[]; count: number }[]): string {
  return groups.map(({ scopes, count }) => `${listOf(scopes)} set on ${toolsOf(count)}`).join('; ');
}

export function toolsSwitchedMessage({ count, isOn, statementRefusal }: { count: number; isOn: boolean; statementRefusal: string | null }): string {
  return statedMessage(`${toolsOf(count)} switched ${isOn ? 'on' : 'off'}`, statementRefusal);
}

export function agentScopesSetMessage({ party, scopes }: { party: string; scopes: readonly string[] }): string {
  return scopes.length === 0 ? `Every message to ${party} needs nothing beyond reaching it` : `Every message to ${party} needs ${listOf(scopes)}`;
}

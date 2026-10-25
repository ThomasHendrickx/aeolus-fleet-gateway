/** How a bulk change treats the picked scopes on each selected tool (gateway scopes 4.3). */
export const SCOPE_CHANGES = [
  { how: 'add', label: 'Add to each' },
  { how: 'remove', label: 'Remove from each' },
  { how: 'replace', label: 'Replace with these' },
] as const;

export type ScopeChange = (typeof SCOPE_CHANGES)[number]['how'];

/** What each selected tool needs of its own after the change, each scope once; none needs nothing beyond the party's. */
export function changedScopesOf(selected: readonly { name: string; scopes: readonly string[] }[], change: { scopes: readonly string[]; how: ScopeChange }): { tool: string; scopes: string[] }[] {
  return selected.map(({ name, scopes }) => {
    switch (change.how) {
      case 'add':
        return { tool: name, scopes: [...new Set([...scopes, ...change.scopes])] };
      case 'remove':
        return { tool: name, scopes: scopes.filter((scope) => !change.scopes.includes(scope)) };
      case 'replace':
        return { tool: name, scopes: [...new Set(change.scopes)] };
    }
  });
}

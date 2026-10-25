/** A scope the fleet lists, with its one-line description, as an approver picks it. */
export interface ListedScope {
  scope: string;
  description: string;
}

const CHIP = 'inline-flex items-center rounded-md border px-2 font-mono text-caption';

/**
 * What a call needs, as chips (gateway scopes 4.3): the party's set muted, a
 * tool's own plain. A scope the fleet no longer lists is marked so: no ship
 * holds it, so every call needing it is refused until it is changed.
 */
export function NeedsChips({ party = [], own, listed }: { party?: readonly string[]; own: readonly string[]; listed: ReadonlySet<string> | null }) {
  if (party.length === 0 && own.length === 0) {
    return <span className="text-muted-foreground">Nothing</span>;
  }
  const chip = (scope: string, isParty: boolean) => {
    const isGone = listed !== null && !listed.has(scope);
    const look = isGone ? 'border-tone-attention-border bg-tone-attention-bg text-tone-attention-fg' : isParty ? 'border-transparent bg-muted text-muted-foreground' : 'border-border';
    return (
      <span key={`${isParty ? 'party' : 'own'}-${scope}`} className={`${CHIP} ${look}`} data-testid={isParty ? 'tools-table-party-scope' : 'tools-table-scope'} title={isGone ? 'No longer defined in the fleet' : isParty ? 'Every tool needs it' : undefined}>
        {scope}
        {isGone ? <span className="ml-1 font-sans">(no longer defined)</span> : null}
      </span>
    );
  };
  return (
    <span className="flex flex-wrap gap-1">
      {party.map((scope) => chip(scope, true))}
      {own.map((scope) => chip(scope, false))}
    </span>
  );
}

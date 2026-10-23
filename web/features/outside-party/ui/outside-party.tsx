import type { ReactNode } from 'react';

import { inFleet } from '../../../lib/gateway-api/page-account';
import { readOf, type SignedInPage } from '../../../lib/gateway-api/page-api';
import { BUTTONS, CARD } from '../../forms/ui/look';
import { outsideAddressOf, PARTY_KINDS, PARTY_STATES, SIDES, type ListedParty } from '../../outside-parties/party-kinds';
import { OUTSIDE_PARTIES_PATH, partyPath } from '../../outside-parties/paths';
import { scopeWords } from '../../outside-parties/scope-words';
import { StatusBadge, Tag } from '../../outside-parties/ui/status-badge';

/** The scopes that change a party's owner, its scopes, and retire it (0056). */
export const OWNING_SCOPE = 'fleet:owner';
export const GRANTING_SCOPE = 'scopes:grant';
export const RETIRING_SCOPE = 'fleet:manage';

/** The way back to the list, in the page's fleet. */
export function Back({ fleetId }: { fleetId: string }) {
  return (
    <a href={inFleet(OUTSIDE_PARTIES_PATH, fleetId)} className="text-muted-foreground hover:text-foreground">
      ← Outside parties
    </a>
  );
}

/** Why the API refused: said in place of the page. */
export function Refusal({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-md border border-tone-attention-border bg-tone-attention-bg px-3 py-2 text-tone-attention-fg">
      {children}
    </p>
  );
}

const UNKNOWN = <span className="text-muted-foreground">Not known</span>;

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[10rem_1fr]">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="flex flex-wrap items-center gap-2">{children}</dd>
    </div>
  );
}

/** The party's head: its name, protocol, side and state. */
export function PartyHead({ party }: { party: ListedParty }) {
  const { protocol, side } = PARTY_KINDS[party.kind];
  const state = PARTY_STATES[party.state];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <h1 className="text-title font-semibold">{party.name}</h1>
      <Tag>{protocol}</Tag>
      <Tag>{SIDES[side].one}</Tag>
      <StatusBadge tone={state.tone} label={state.label} />
    </div>
  );
}

/**
 * One outside party (design B, screens 12 and 14): its proxy ship's state,
 * then its facts as the fleet holds them, and for an MCP server the tools
 * it lists now, read-only. Each control shows only to an account holding
 * its scope; the API checks it again.
 */
export async function OutsideParty({ page, name }: { page: SignedInPage; name: string }) {
  const { api, fleetId, scopes } = page;
  const read = await readOf(api.parties.get.query({ name }));
  if (!read.isOk) {
    return (
      <div className="grid gap-4">
        <Back fleetId={fleetId} />
        <Refusal>{read.refusal}</Refusal>
      </div>
    );
  }
  const party = read.value;
  const address = outsideAddressOf(party);
  const [tools, cards] = await Promise.all([
    party.kind === 'mcpServer' ? readOf(api.parties.tools.query({ name })) : undefined,
    party.kind === 'a2aClient' ? readOf(api.parties.cardAddresses.query({ name })) : undefined,
  ]);
  const change = (
    <a href={inFleet(partyPath(party.name, 'change'), fleetId)} className="text-primary hover:underline" data-testid="outside-party-change">
      Change
    </a>
  );
  return (
    <div className="grid gap-4">
      <Back fleetId={fleetId} />
      <PartyHead party={party} />
      <dl className={`${CARD} grid gap-3`}>
        <Fact label="Proxy ship">{party.proxyShipName ?? UNKNOWN}</Fact>
        <Fact label="Owner">
          {party.ownerName ?? UNKNOWN}
          {scopes.includes(OWNING_SCOPE) ? change : null}
        </Fact>
        <Fact label="Scopes">
          {party.scopes === null
            ? UNKNOWN
            : party.scopes.map((scope) => <Tag key={scope}>{scopeWords(scope)}</Tag>)}
          {scopes.includes(GRANTING_SCOPE) ? change : null}
        </Fact>
        {address === null ? null : (
          <Fact label={party.kind === 'mcpServer' ? 'Address' : 'Client id'}>
            <span className="font-mono">{address}</span>
          </Fact>
        )}
      </dl>
      {tools === undefined ? null : (
        <section className={`${CARD} grid gap-2`} data-testid="outside-party-tools">
          <h2 className="flex justify-between text-section font-semibold">
            <span>Tools</span>
            {tools.isOk ? <span>{tools.value.tools.length}</span> : null}
          </h2>
          {tools.isOk ? (
            <ul className="grid gap-1">
              {tools.value.tools.map((tool) => (
                <li key={tool.name} className="grid">
                  <span className="font-mono">{tool.name}</span>
                  {tool.description === undefined ? null : <span className="text-muted-foreground">{tool.description}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">{tools.refusal}</p>
          )}
        </section>
      )}
      {cards === undefined ? null : (
        <section className={`${CARD} grid gap-2`} data-testid="outside-party-cards">
          <h2 className="flex justify-between text-section font-semibold">
            <span>Card addresses</span>
            {cards.isOk ? <span>{cards.value.addresses.length}</span> : null}
          </h2>
          <p className="text-muted-foreground">One per ship its proxy ship reaches now. Its owner hands them to the client.</p>
          {!cards.isOk ? (
            <p className="text-muted-foreground">{cards.refusal}</p>
          ) : cards.value.addresses.length === 0 ? (
            <p className="text-muted-foreground">It reaches no ship now.</p>
          ) : (
            <ul className="grid gap-1">
              {cards.value.addresses.map((address) => (
                <li key={address} className="break-all font-mono text-code">
                  {address}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {scopes.includes(RETIRING_SCOPE) ? (
        <div>
          <a className={BUTTONS.secondary} href={inFleet(partyPath(party.name, 'retire'), fleetId)} data-testid="outside-party-retire">
            Retire {party.name}…
          </a>
        </div>
      ) : null}
    </div>
  );
}

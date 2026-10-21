import { inFleet } from '../../../lib/gateway-api/page-account';
import { readOf, type SignedInPage } from '../../../lib/gateway-api/page-api';
import { BUTTONS, CARD } from '../../forms/ui/look';
import { countsOf, PARTY_KINDS, PARTY_STATES, SIDES, type ListedParty, type Side } from '../party-kinds';
import { ADD_SERVER_PATH, OUTSIDE_PARTIES_PATH, partyPath } from '../paths';
import { StatusBadge, Tag } from './status-badge';
import { SwitchCard } from './switch-card';

function PartyCard({ party, fleetId }: { party: ListedParty; fleetId: string }) {
  const { protocol, side } = PARTY_KINDS[party.kind];
  const where = party.kind === 'mcpServer' ? party.url : party.clientId;
  const state = PARTY_STATES[party.state];
  return (
    <a href={inFleet(partyPath(party.name), fleetId)} className={`${CARD} grid gap-2 hover:bg-accent`} data-testid="outside-parties-party">
      <span className="flex items-center gap-2">
        <strong>{party.name}</strong> <Tag>{protocol}</Tag> <Tag>{`${protocol} ${SIDES[side].one}`}</Tag>
      </span>
      <span className="truncate font-mono text-code" title={where}>
        {where}
      </span>
      <span className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={state.tone} label={state.label} />
        {party.ownerShipId === null ? null : <Tag isMono>{party.ownerShipId}</Tag>}
      </span>
    </a>
  );
}

/**
 * The Outside parties page: how many the fleet has, whether they are on,
 * and each party, for every side or one. What the API refuses is said in
 * place of what it would show.
 */
export async function OutsideParties({ page, side }: { page: SignedInPage; side: Side | undefined }) {
  const { api, fleetId } = page;
  const [status, parties] = await Promise.all([readOf(api.outsideParties.status.query()), readOf(api.parties.list.query())]);
  const listed = parties.isOk ? parties.value : [];
  const counts = countsOf(listed);
  const shown = side === undefined ? listed : listed.filter((party) => PARTY_KINDS[party.kind].side === side);
  const filters = [
    { label: 'All', href: OUTSIDE_PARTIES_PATH, isCurrent: side === undefined },
    { label: 'Servers', href: `${OUTSIDE_PARTIES_PATH}?kind=server`, isCurrent: side === 'server' },
    { label: 'Clients', href: `${OUTSIDE_PARTIES_PATH}?kind=client`, isCurrent: side === 'client' },
  ];
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-title font-semibold">Outside parties</h1>
          <p className="text-muted-foreground" data-testid="outside-parties-counts">
            {[
              `${String(counts.sides.server)} ${counts.sides.server === 1 ? SIDES.server.one : SIDES.server.many}`,
              `${String(counts.sides.client)} ${counts.sides.client === 1 ? SIDES.client.one : SIDES.client.many}`,
              ...counts.protocols.map(({ protocol, count }) => `${protocol} ${String(count)}`),
            ].join(' · ')}
          </p>
        </div>
        <a className={BUTTONS.primary} href={inFleet(ADD_SERVER_PATH, fleetId)} data-testid="outside-parties-add">
          Add server
        </a>
      </div>
      {status.isOk ? (
        <SwitchCard isOn={status.value.isOn} fleetId={fleetId} />
      ) : (
        <p role="alert" className="rounded-md border border-tone-attention-border bg-tone-attention-bg px-3 py-2 text-tone-attention-fg">
          {status.refusal}
        </p>
      )}
      <nav aria-label="Show" className="flex gap-2">
        {filters.map((filter) => (
          <a key={filter.label} href={inFleet(filter.href, fleetId)} aria-current={filter.isCurrent ? 'page' : undefined} className={filter.isCurrent ? BUTTONS.secondary : `${BUTTONS.secondary} border-transparent`}>
            {filter.label}
          </a>
        ))}
      </nav>
      {!parties.isOk ? (
        <p role="alert" className="text-tone-attention-fg">
          {parties.refusal}
        </p>
      ) : shown.length === 0 ? (
        <p className="text-muted-foreground">No outside party yet.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {shown.map((party) => (
            <PartyCard key={party.name} party={party} fleetId={fleetId} />
          ))}
        </div>
      )}
    </div>
  );
}

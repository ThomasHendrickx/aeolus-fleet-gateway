import { inFleet } from '../../../lib/gateway-api/page-account';
import { readOf, type SignedInPage } from '../../../lib/gateway-api/page-api';
import { BUTTONS, COMPACT_CARD, SMALL_BUTTON } from '../../forms/ui/look';
import { countsOf, inListOrder, outsideAddressOf, PARTY_KINDS, PARTY_STATES, SIDES, type ListedParty, type Side } from '../party-kinds';
import { ADD_A2A_AGENT_PATH, ADD_A2A_CLIENT_PATH, ADD_SERVER_PATH, OUTSIDE_PARTIES_PATH, partyPath } from '../paths';
import { StatusBadge, Tag } from './status-badge';
import { SwitchCard } from './switch-card';

/** The scopes that turn outside parties on or off, that add an outside MCP server (0056), and that add an outside A2A client (0060). */
const SWITCHING_SCOPE = 'fleet:network';
const ADDING_SCOPE = 'fleet:manage';
const APPROVING_SCOPE = 'gateway:approve';

function PartyCard({ party, fleetId }: { party: ListedParty; fleetId: string }) {
  const { protocol, side } = PARTY_KINDS[party.kind];
  const where = outsideAddressOf(party);
  const state = PARTY_STATES[party.state];
  return (
    <a href={inFleet(partyPath(party.name), fleetId)} className={`${COMPACT_CARD} grid min-w-0 justify-items-start gap-2 hover:bg-accent`} data-testid="outside-parties-party">
      <span className="flex flex-wrap items-center gap-2">
        <strong>{party.name}</strong>
        <span className="contents max-sm:hidden">
          <Tag>{protocol}</Tag> <Tag>{`${protocol} ${SIDES[side].one}`}</Tag>
        </span>
      </span>
      {where === null ? null : (
        <span className="max-w-full truncate font-mono text-code text-muted-foreground" title={where}>
          {where}
        </span>
      )}
      <span className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={state.tone} label={state.label} look="flat" />
        {party.ownerName === null ? null : <Tag>{party.ownerName}</Tag>}
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
  const { api, fleetId, scopes } = page;
  const [status, parties] = await Promise.all([readOf(api.outsideParties.status.query()), readOf(api.parties.list.query())]);
  const listed = parties.isOk ? parties.value : [];
  const counts = countsOf(listed);
  const shown = inListOrder(side === undefined ? listed : listed.filter((party) => PARTY_KINDS[party.kind].side === side));
  const filters = [
    { label: 'All', href: OUTSIDE_PARTIES_PATH, isCurrent: side === undefined },
    { label: 'Servers', href: `${OUTSIDE_PARTIES_PATH}?kind=server`, isCurrent: side === 'server' },
    { label: 'Clients', href: `${OUTSIDE_PARTIES_PATH}?kind=client`, isCurrent: side === 'client' },
  ];
  return (
    <div className="grid gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-heading-touch font-semibold max-sm:sr-only">Outside parties</h1>
          <p className="text-meta text-muted-foreground" data-testid="outside-parties-counts">
            {[
              `${String(counts.sides.server)} ${counts.sides.server === 1 ? SIDES.server.one : SIDES.server.many}`,
              `${String(counts.sides.client)} ${counts.sides.client === 1 ? SIDES.client.one : SIDES.client.many}`,
              ...counts.protocols.map(({ protocol, count }) => `${protocol} ${String(count)}`),
            ].join(' · ')}
          </p>
        </div>
        <div className="flex gap-2 max-sm:hidden">
          {scopes.includes(APPROVING_SCOPE) ? (
            <a className={`${BUTTONS.secondary} ${SMALL_BUTTON}`} href={inFleet(ADD_A2A_CLIENT_PATH, fleetId)} data-testid="outside-parties-add-a2a-client">
              Add A2A client
            </a>
          ) : null}
          {scopes.includes(APPROVING_SCOPE) ? (
            <a className={`${BUTTONS.secondary} ${SMALL_BUTTON}`} href={inFleet(ADD_A2A_AGENT_PATH, fleetId)} data-testid="outside-parties-add-a2a-agent">
              Add A2A agent
            </a>
          ) : null}
          {scopes.includes(ADDING_SCOPE) ? (
            <a className={`${BUTTONS.primary} ${SMALL_BUTTON}`} href={inFleet(ADD_SERVER_PATH, fleetId)} data-testid="outside-parties-add">
              Add server
            </a>
          ) : null}
        </div>
      </div>
      {status.isOk ? (
        <SwitchCard isOn={status.value.isOn} canSwitch={scopes.includes(SWITCHING_SCOPE)} fleetId={fleetId} />
      ) : (
        <p role="alert" className="rounded-md border border-tone-attention-border bg-tone-attention-bg px-3 py-2 text-tone-attention-fg">
          {status.refusal}
        </p>
      )}
      <nav aria-label="Show" className="flex w-fit gap-0.5 rounded-md border border-border bg-muted p-0.75 max-sm:w-full max-sm:rounded-lg max-sm:p-1">
        {filters.map((filter) => (
          <a
            key={filter.label}
            href={inFleet(filter.href, fleetId)}
            aria-current={filter.isCurrent ? 'page' : undefined}
            className={`inline-flex h-7 items-center justify-center rounded-sm px-2.5 text-meta font-medium max-sm:h-9 max-sm:flex-1 max-sm:text-body-touch ${filter.isCurrent ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          >
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
        <div className="grid gap-2.5 sm:grid-cols-[repeat(auto-fill,minmax(22rem,1fr))] sm:gap-3">
          {shown.map((party) => (
            <PartyCard key={party.name} party={party} fleetId={fleetId} />
          ))}
        </div>
      )}
    </div>
  );
}

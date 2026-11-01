import { Network, Plug, SquareTerminal, Users } from 'lucide-react';

import { GROUP_LABELS, STATE_LABELS, type FleetGroup, type FleetTile, type ShipState, type YourFleet } from '../services/your-fleet';
import { StateIcon } from './state-icon';

const GROUP_ICONS = { people: Users, agents: SquareTerminal, plugins: Plug, throughTheGateway: Network } as const;

/** A tile is filled in its state's tone; Idle tiles stay plain, so colour marks only what is going on. */
const TILE_TONES: Record<ShipState, string> = {
  alert: 'border-tone-attention-border bg-tone-attention-bg text-tone-attention-fg',
  waiting: 'border-tone-waiting-border bg-tone-waiting-bg text-tone-waiting-fg',
  working: 'border-tone-ok-border bg-tone-ok-bg text-tone-ok-fg',
  idle: 'border-border bg-card text-muted-foreground',
};

function Tile({ tile }: { tile: FleetTile }) {
  const { name, state, note } = tile;
  return (
    <li data-testid="fleet-tile" title={note === null ? name : `${name}: ${note}`} className={`flex h-13 min-w-0 flex-col justify-between rounded-md border px-2 py-1.5 ${TILE_TONES[state]}`}>
      <span className="truncate text-caption font-semibold text-card-foreground">{name}</span>
      <span className="flex items-center gap-1 text-[11px]">
        <StateIcon state={state} />
        {STATE_LABELS[state]}
      </span>
    </li>
  );
}

function Group({ group, tiles, tileColumns }: { group: FleetGroup; tiles: readonly FleetTile[]; tileColumns: string }) {
  const Icon = GROUP_ICONS[group];
  return (
    <section className="grid gap-1.5" aria-label={GROUP_LABELS[group]}>
      <h3 className="flex items-center gap-1.5 text-caption font-semibold">
        <Icon aria-hidden="true" className="size-3.5 shrink-0" />
        <span>{GROUP_LABELS[group]}</span>
        <span className="font-normal text-muted-foreground">{tiles.length}</span>
      </h3>
      <ul className={`grid gap-1.5 ${tileColumns}`}>
        {tiles.map((tile) => (
          <Tile key={tile.shipId} tile={tile} />
        ))}
      </ul>
    </section>
  );
}

/**
 * One tile per ship, grouped People, Agents, Plugins and Through the gateway,
 * each group alerts first; what a ship is doing shows in its tile's title.
 */
export function FleetWall({ groups, tileColumns, className }: { groups: YourFleet['groups']; tileColumns: string; className?: string }) {
  return (
    <div data-testid="fleet-wall" className={`${className ?? ''} grid gap-2.5`.trim()}>
      {groups.map(({ group, tiles }) => (
        <Group key={group} group={group} tiles={tiles} tileColumns={tileColumns} />
      ))}
    </div>
  );
}

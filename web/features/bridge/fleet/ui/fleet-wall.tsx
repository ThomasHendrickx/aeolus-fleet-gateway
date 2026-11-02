import { ArrowUpRight, Network, Plug, SquareTerminal, User, Users } from 'lucide-react';
import type { ReactNode } from 'react';

import { healthHrefOf } from '../../services/stay-aware';
import { ageOf, GROUP_LABELS, STATE_LABELS, type FleetGroup, type FleetTile, type ShipState, type YourFleet } from '../services/your-fleet';
import { StateIcon } from './state-icon';

const GROUP_ICONS = { people: Users, agents: SquareTerminal, plugins: Plug, throughTheGateway: Network } as const;

/** A ship's kind on its tile: one person, else the group's own icon (design/bridge-fleet-width). */
const KIND_ICONS = { people: User, agents: SquareTerminal, plugins: Plug, throughTheGateway: Network } as const;

const KIND_LABELS: Record<FleetGroup, string> = { people: 'Person', agents: 'Agent', plugins: 'Plugin', throughTheGateway: 'Through the gateway' };

/**
 * A tile is filled in its state's tone, and on hover its border takes the
 * state's colour; Idle tiles stay plain, so colour marks only what is going on.
 */
const TILE_TONES: Record<ShipState, string> = {
  alert: 'border-tone-attention-border bg-tone-attention-bg text-tone-attention-fg hover:border-tone-attention-fg active:border-tone-attention-fg',
  waiting: 'border-tone-waiting-border bg-tone-waiting-bg text-tone-waiting-fg hover:border-tone-waiting-fg active:border-tone-waiting-fg',
  working: 'border-tone-ok-border bg-tone-ok-bg text-tone-ok-fg hover:border-tone-ok-fg active:border-tone-ok-fg',
  idle: 'border-border bg-card text-muted-foreground hover:border-muted-foreground active:border-muted-foreground',
};

/** The kind's square, in the state's tone; an Idle ship's stays plain. */
const KIND_TONES: Record<ShipState, string> = {
  alert: 'border-current/25',
  waiting: 'border-current/25',
  working: 'border-current/25',
  idle: 'border-border',
};

/** A link lifts a little on hover with a soft shadow; pressed, it sits down again. Reduced motion: nothing moves. */
const LINK =
  'group cursor-pointer transition-[border-color,box-shadow,transform] duration-(--duration-fast) hover:-translate-y-px hover:shadow-[0_2px_8px_-2px_color-mix(in_oklch,var(--foreground)_18%,transparent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:translate-y-0 active:shadow-none motion-reduce:transition-none motion-reduce:hover:translate-y-0';

function TileFrame({ href, title, className, children }: { href: string | undefined; title: string; className: string; children: ReactNode }) {
  return href === undefined ? (
    <div data-testid="fleet-tile" title={title} className={className}>
      {children}
    </div>
  ) : (
    <a data-testid="fleet-tile" href={href} title={title} className={`${className} ${LINK}`}>
      {children}
    </a>
  );
}

/**
 * A ship's tile (design/bridge-fleet-width): its kind, its whole name, what
 * it is doing, its state and when it last did something; a link to the ship's page in the console, with
 * an arrow on hover and focus. A working ship's tile carries the live band,
 * which stands still under reduced motion.
 */
function Tile({ group, tile, consoleUrl, now }: { group: FleetGroup; tile: FleetTile; consoleUrl: string | undefined; now: Date }) {
  const { shipId, name, state, note } = tile;
  const age = ageOf(tile.lastActivityAt, now);
  const KindIcon = KIND_ICONS[group];
  return (
    <li className="min-w-0">
      <TileFrame
        href={consoleUrl === undefined ? undefined : healthHrefOf({ consoleUrl, shipId })}
        title={`${name}: ${note ?? STATE_LABELS[state]}`}
        className={`relative grid h-full min-h-28 grid-rows-[auto_1fr_auto] gap-1 overflow-hidden rounded-md border px-3 py-2.5 ${TILE_TONES[state]}`}
      >
        <span className="flex min-w-0 items-start gap-2 pr-4.5">
          <span data-testid="fleet-tile-kind" title={KIND_LABELS[group]} className={`inline-flex size-5.5 shrink-0 items-center justify-center rounded-md border bg-card/70 ${KIND_TONES[state]}`}>
            <KindIcon aria-hidden="true" className="size-3.25" />
          </span>
          <span className="min-w-0 pt-0.5 text-meta leading-4.5 font-semibold wrap-anywhere text-foreground">{name}</span>
        </span>
        {consoleUrl === undefined ? null : (
          <span className="absolute top-2.25 right-2.25 inline-flex text-muted-foreground opacity-0 transition-opacity duration-(--duration-fast) group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none">
            <ArrowUpRight aria-hidden="true" className="size-3.5" />
          </span>
        )}
        <span className="line-clamp-2 text-caption leading-4 text-muted-foreground">{note}</span>
        <span className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1 text-caption font-medium">
            <StateIcon state={state} />
            {STATE_LABELS[state]}
          </span>
          {age === null ? null : (
            <span data-testid="fleet-tile-age" className="text-caption text-muted-foreground">
              {age}
            </span>
          )}
        </span>
        {state === 'working' ? (
          <i
            data-testid="fleet-tile-live"
            aria-hidden="true"
            className="absolute inset-x-0 bottom-0 h-0.5 animate-live-band bg-[linear-gradient(90deg,transparent,currentColor,transparent)] bg-size-[40%_100%] bg-no-repeat opacity-70 motion-reduce:animate-none motion-reduce:bg-none motion-reduce:bg-current motion-reduce:opacity-35"
          />
        ) : null}
      </TileFrame>
    </li>
  );
}

function Group({ group, tiles, consoleUrl, tileColumns, now }: { group: FleetGroup; tiles: readonly FleetTile[]; consoleUrl: string | undefined; tileColumns: string; now: Date }) {
  const Icon = GROUP_ICONS[group];
  return (
    <section className="grid gap-1.5" aria-label={GROUP_LABELS[group]}>
      <h3 className="flex items-center gap-1.5 text-caption font-semibold max-sm:gap-2 max-sm:text-body-touch">
        <Icon aria-hidden="true" className="size-3.5 shrink-0 max-sm:size-4" />
        <span>{GROUP_LABELS[group]}</span>
        <span className="font-normal text-muted-foreground">{tiles.length}</span>
      </h3>
      <ul className={`grid gap-2 ${tileColumns}`}>
        {tiles.map((tile) => (
          <Tile key={tile.shipId} group={group} tile={tile} consoleUrl={consoleUrl} now={now} />
        ))}
      </ul>
    </section>
  );
}

/**
 * One tile per ship, grouped People, Agents, Plugins and Through the gateway,
 * each group alerts first; a tile opens its ship in the fleet's console.
 */
export function FleetWall({ groups, consoleUrl, tileColumns, now, className }: { groups: YourFleet['groups']; consoleUrl: string | undefined; tileColumns: string; now: Date; className?: string }) {
  return (
    <div data-testid="fleet-wall" className={`${className ?? ''} grid gap-2.5`.trim()}>
      {groups.map(({ group, tiles }) => (
        <Group key={group} group={group} tiles={tiles} consoleUrl={consoleUrl} tileColumns={tileColumns} now={now} />
      ))}
    </div>
  );
}

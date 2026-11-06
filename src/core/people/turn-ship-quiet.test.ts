import type { ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { CHARLOTTE_GRANT, fakeCrewPersonShip, memoryPersonCrews, memoryQuietShips } from '../../../test/support/people-fakes.js';
import { PERSON_SHIP_ID } from '../../../test/support/sign-in-fakes.js';
import { ok } from '../shared/result.js';
import { createReadQuietAmong } from './read-quiet-among.js';
import { createReadQuietShips, QUIET_SHIPS_PAGE_SIZE } from './read-quiet-ships.js';
import { createTurnShipQuiet } from './turn-ship-quiet.js';

// A person quiets a ship from its conversation, or wakes it again, through
// the person API (preferences design): kept per fleet and person ship. Their
// client lists the quiet ones 20 at a time, the latest quieted first, and
// asks which of the ships it shows are quiet.

const NOW = new Date('2026-11-06T09:00:00.000Z');
const LATER = new Date('2026-11-06T10:00:00.000Z');
const WATCHER: ShipId = 'shp_01m3tb1zgr5h2ffee12xnch8w1';
const RELEASER: ShipId = 'shp_01m3tb1zgr5h2ffee12xnch8r1';

let crews: ReturnType<typeof memoryPersonCrews>;
let quietShips: ReturnType<typeof memoryQuietShips>;

beforeEach(() => {
  crews = memoryPersonCrews();
  quietShips = memoryQuietShips();
});

const turnShipQuiet = (at = NOW) => createTurnShipQuiet({ crewPersonShip: fakeCrewPersonShip(crews), quietShips, clock: { now: () => at } });
const readQuietShips = () => createReadQuietShips({ crewPersonShip: fakeCrewPersonShip(crews), quietShips });
const readQuietAmong = () => createReadQuietAmong({ crewPersonShip: fakeCrewPersonShip(crews), quietShips });
const NOT_A_PERSON = { fleetId: FLEET_ID, grantId: 'grant-of-argo' };

/** The ship of the index, its id ending in the index. */
const shipIdOf = (index: number): ShipId => `shp_01m3tb1zgr5h2ffee12xnc${String(index).padStart(4, '0')}`;

describe('a person quiets a ship or wakes it again', () => {
  it('keeps a quiet ship for their own person ship, with its name and when it was quieted', async () => {
    const turned = await turnShipQuiet()({ caller: CHARLOTTE_GRANT, shipId: WATCHER, name: 'watcher', isQuiet: true });

    expect({ turned, held: quietShips.held }).toEqual({ turned: ok(undefined), held: [{ fleetId: FLEET_ID, shipId: PERSON_SHIP_ID, quietShipId: WATCHER, name: 'watcher', isQuiet: true, changedAt: NOW }] });
  });

  it('keeps when a ship was quieted when it is quieted again', async () => {
    await turnShipQuiet()({ caller: CHARLOTTE_GRANT, shipId: WATCHER, name: 'watcher', isQuiet: true });

    await turnShipQuiet(LATER)({ caller: CHARLOTTE_GRANT, shipId: WATCHER, name: 'watcher', isQuiet: true });

    expect(quietShips.held.map(({ changedAt }) => changedAt)).toEqual([NOW]);
  });

  it('keeps a ship woken again with when, so it wakes only for what it sends after', async () => {
    await turnShipQuiet()({ caller: CHARLOTTE_GRANT, shipId: WATCHER, name: 'watcher', isQuiet: true });

    await turnShipQuiet(LATER)({ caller: CHARLOTTE_GRANT, shipId: WATCHER, name: 'watcher', isQuiet: false });

    expect(quietShips.held.map(({ isQuiet, changedAt }) => ({ isQuiet, changedAt }))).toEqual([{ isQuiet: false, changedAt: LATER }]);
  });

  it('keeps nothing when a ship never quieted is woken again', async () => {
    await turnShipQuiet()({ caller: CHARLOTTE_GRANT, shipId: WATCHER, name: 'watcher', isQuiet: false });

    expect(quietShips.held).toEqual([]);
  });

  it('is refused without a person ship, keeping nothing', async () => {
    const turned = await turnShipQuiet()({ caller: NOT_A_PERSON, shipId: WATCHER, name: 'watcher', isQuiet: true });

    expect({ kind: turned.isOk ? undefined : turned.error.kind, held: quietShips.held }).toEqual({ kind: 'NOT_A_PERSON', held: [] });
  });
});

describe("a person's client lists their quiet ships", () => {
  it('lists none while no ship is quiet', async () => {
    await expect(readQuietShips()({ caller: CHARLOTTE_GRANT, cursor: null })).resolves.toEqual(ok({ ships: [], nextCursor: null }));
  });

  it('lists the quiet ones only, each with its name and since when', async () => {
    await turnShipQuiet()({ caller: CHARLOTTE_GRANT, shipId: WATCHER, name: 'watcher', isQuiet: true });
    await turnShipQuiet()({ caller: CHARLOTTE_GRANT, shipId: RELEASER, name: 'releaser', isQuiet: true });
    await turnShipQuiet(LATER)({ caller: CHARLOTTE_GRANT, shipId: RELEASER, name: 'releaser', isQuiet: false });

    await expect(readQuietShips()({ caller: CHARLOTTE_GRANT, cursor: null })).resolves.toEqual(ok({ ships: [{ shipId: WATCHER, name: 'watcher', since: NOW }], nextCursor: null }));
  });

  it('lists 20 at a time, the latest quieted first, and the next page after the cursor', async () => {
    for (let index = 1; index <= QUIET_SHIPS_PAGE_SIZE + 1; index += 1) {
      await turnShipQuiet(new Date(NOW.getTime() + index * 60_000))({ caller: CHARLOTTE_GRANT, shipId: shipIdOf(index), name: `ship-${String(index)}`, isQuiet: true });
    }

    const first = await readQuietShips()({ caller: CHARLOTTE_GRANT, cursor: null });
    const second = await readQuietShips()({ caller: CHARLOTTE_GRANT, cursor: first.isOk ? first.value.nextCursor : null });

    expect({ first: first.isOk ? [first.value.ships.length, first.value.ships[0]?.name] : undefined, second: second.isOk ? second.value : undefined }).toEqual({
      first: [QUIET_SHIPS_PAGE_SIZE, 'ship-21'],
      second: { ships: [{ shipId: shipIdOf(1), name: 'ship-1', since: new Date(NOW.getTime() + 60_000) }], nextCursor: null },
    });
  });

  it('is refused without a person ship', async () => {
    const read = await readQuietShips()({ caller: NOT_A_PERSON, cursor: null });

    expect(read.isOk ? undefined : read.error.kind).toBe('NOT_A_PERSON');
  });
});

describe("a person's client asks which ships are quiet", () => {
  it('answers the quiet ones among those asked, each with its name and since when', async () => {
    await turnShipQuiet()({ caller: CHARLOTTE_GRANT, shipId: WATCHER, name: 'watcher', isQuiet: true });
    await turnShipQuiet()({ caller: CHARLOTTE_GRANT, shipId: RELEASER, name: 'releaser', isQuiet: true });
    await turnShipQuiet(LATER)({ caller: CHARLOTTE_GRANT, shipId: RELEASER, name: 'releaser', isQuiet: false });

    await expect(readQuietAmong()({ caller: CHARLOTTE_GRANT, shipIds: [WATCHER, RELEASER, shipIdOf(1)] })).resolves.toEqual(ok([{ shipId: WATCHER, name: 'watcher', since: NOW }]));
  });

  it('is refused without a person ship', async () => {
    const read = await readQuietAmong()({ caller: NOT_A_PERSON, shipIds: [WATCHER] });

    expect(read.isOk ? undefined : read.error.kind).toBe('NOT_A_PERSON');
  });
});

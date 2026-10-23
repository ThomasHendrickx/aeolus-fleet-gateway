import { describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { memoryPersonCrews } from '../../../test/support/people-fakes.js';
import { PERSON_SHIP_ID } from '../../../test/support/sign-in-fakes.js';
import type { FleetRefusal } from '../connection/ports.js';
import { err, ok, type Result } from '../shared/result.js';
import type { InboxChange, PersonShipDoor } from './ports.js';
import type { WakeOutcome } from './wake-person.js';
import { createWaitOnPersonShip } from './wait-on-person-ship.js';

// The gateway waits on every person ship it crews (wake a person, W5, W7):
// it asks the fleet's inbox to wait while the count is the one it knows,
// and tells the person's pages each time the count changed.

const SHIP = { fleetId: FLEET_ID, shipId: PERSON_SHIP_ID };
const CREW_TOKEN = 'aeolus_ct_v1_charlotte';
const AGAIN_WAITS_MS = [100, 200] as const;
const WAKE_AGAIN_WAITS_MS = [60_000, 300_000] as const;
const UNAVAILABLE: FleetRefusal = { code: 'UNAVAILABLE', message: 'The fleet did not answer' };

type InboxAnswer = Result<{ waiting: number }, FleetRefusal>;

/**
 * The person ship's inbox in the fleet, answering each call in turn as the
 * test scripts it; once the script is through, it waits until stopped. Each
 * call is recorded with the crew token and the count it knew.
 */
function scriptedInbox(answers: (InboxAnswer | (() => InboxAnswer))[]) {
  const asked: { crewToken: string; knownWaiting: number | null }[] = [];
  const inbox: PersonShipDoor['inbox'] = (crewToken, wait) => {
    asked.push({ crewToken, knownWaiting: wait?.knownWaiting ?? null });
    const answer = answers.shift();
    if (answer !== undefined) {
      return Promise.resolve(typeof answer === 'function' ? answer() : answer);
    }
    return new Promise((resolve) => {
      if (wait?.signal.aborted === true) {
        resolve(err(UNAVAILABLE));
      }
      wait?.signal.addEventListener('abort', () => {
        resolve(err(UNAVAILABLE));
      });
    });
  };
  return { inbox, asked };
}

/** The time now, as the test moves it. */
const clock = { at: new Date('2026-10-23T12:00:00.000Z'), now(): Date { return clock.at; } };

async function waiting(answers: (InboxAnswer | (() => InboxAnswer))[], options: { crews?: ReturnType<typeof memoryPersonCrews>; wakes?: Result<WakeOutcome, FleetRefusal>[] } = {}) {
  const crews = options.crews ?? memoryPersonCrews();
  await crews.save({ ...SHIP, crewToken: CREW_TOKEN, crewedAt: new Date('2026-10-23T09:00:00.000Z') });
  const { inbox, asked } = scriptedInbox(answers);
  const told: InboxChange[] = [];
  const slept: number[] = [];
  /** Each wake the waiter asked for, by the time and crew token. */
  const woken: { at: Date; crewToken: string }[] = [];
  const wakes = options.wakes ?? [];
  const stop = new AbortController();
  const waitOnPersonShip = createWaitOnPersonShip({
    crews,
    door: { inbox },
    wakePerson: (ship, crewToken) => {
      woken.push({ at: clock.now(), crewToken });
      return Promise.resolve(wakes.shift() ?? ok({ kind: 'settled' }));
    },
    clock,
    wakeAgainWaitsMs: WAKE_AGAIN_WAITS_MS,
    changes: {
      tell: (change) => {
        told.push(change);
        return Promise.resolve();
      },
    },
    sleep: (ms) => {
      slept.push(ms);
      return Promise.resolve();
    },
    againWaitsMs: AGAIN_WAITS_MS,
  });
  return { crews, asked, told, slept, woken, stop, waitOnPersonShip };
}

/** Lets the waiter run until it waits on the fleet with nothing scripted left, then stops it. */
async function runUntilIdle(waiter: Awaited<ReturnType<typeof waiting>>) {
  const ended = waiter.waitOnPersonShip(SHIP, waiter.stop.signal);
  await new Promise((resolve) => setTimeout(resolve, 10));
  waiter.stop.abort();
  return ended;
}

describe('the waiter of a person ship', () => {
  it('looks once without a count, then waits while the count is the one it knows', async () => {
    const waiter = await waiting([ok({ waiting: 0 }), ok({ waiting: 1 }), ok({ waiting: 1 })]);

    await runUntilIdle(waiter);

    expect(waiter.asked).toEqual([
      { crewToken: CREW_TOKEN, knownWaiting: null },
      { crewToken: CREW_TOKEN, knownWaiting: 0 },
      { crewToken: CREW_TOKEN, knownWaiting: 1 },
      { crewToken: CREW_TOKEN, knownWaiting: 1 },
    ]);
  });

  it("tells the person's pages at its first look, as a page may have read the inbox before the waiter started", async () => {
    const waiter = await waiting([ok({ waiting: 3 })]);

    await runUntilIdle(waiter);

    expect(waiter.told).toEqual([SHIP]);
  });

  it("then tells the person's pages each time the count changed, up or down, and not when a wait ran out unchanged", async () => {
    const waiter = await waiting([ok({ waiting: 0 }), ok({ waiting: 2 }), ok({ waiting: 2 }), ok({ waiting: 1 })]);

    await runUntilIdle(waiter);

    expect(waiter.told).toEqual([SHIP, SHIP, SHIP]);
  });

  it.each(['LEASE_ENDED', 'UNAUTHORIZED'])('stops on %s and drops the crew, so the next sign-in crews again', async (code) => {
    const waiter = await waiting([ok({ waiting: 0 }), err({ code, message: 'The crew token no longer works' })]);

    const ended = await waiter.waitOnPersonShip(SHIP, waiter.stop.signal);

    expect({ ended, held: waiter.crews.held }).toEqual({ ended: { reason: 'crewEnded' }, held: [] });
  });

  it('goes on with the new crew when the ship was crewed again meanwhile, keeping it', async () => {
    const crews = memoryPersonCrews();
    const crewedAgain = { ...SHIP, crewToken: 'aeolus_ct_v1_charlotte_2', crewedAt: new Date('2026-10-23T10:00:00.000Z') };
    const waiter = await waiting(
      [
        ok({ waiting: 0 }),
        () => {
          crews.held.splice(0, 1, crewedAgain);
          return err({ code: 'LEASE_ENDED', message: 'The lease ended' });
        },
      ],
      { crews },
    );

    await runUntilIdle(waiter);

    expect({ tokens: waiter.asked.map(({ crewToken }) => crewToken), held: crews.held }).toEqual({ tokens: [CREW_TOKEN, CREW_TOKEN, 'aeolus_ct_v1_charlotte_2'], held: [crewedAgain] });
  });

  it('waits longer each time the fleet does not answer, up to its longest wait, and looks anew once it answers', async () => {
    const waiter = await waiting([ok({ waiting: 0 }), err(UNAVAILABLE), err(UNAVAILABLE), err(UNAVAILABLE), ok({ waiting: 1 }), err(UNAVAILABLE)]);

    await runUntilIdle(waiter);

    expect({ slept: waiter.slept, told: waiter.told }).toEqual({ slept: [100, 200, 200, 100], told: [SHIP, SHIP] });
  });

  it('wakes the person at its first look when something waits, then each time the count rose, and not when it fell or stayed', async () => {
    const waiter = await waiting([ok({ waiting: 2 }), ok({ waiting: 2 }), ok({ waiting: 3 }), ok({ waiting: 1 })]);

    await runUntilIdle(waiter);

    expect(waiter.woken.map(({ crewToken }) => crewToken)).toEqual([CREW_TOKEN, CREW_TOKEN]);
  });

  it('wakes no one at its first look when nothing waits', async () => {
    const waiter = await waiting([ok({ waiting: 0 })]);

    await runUntilIdle(waiter);

    expect(waiter.woken).toEqual([]);
  });

  it("wakes again once the window that held a wake back ends, though the count did not change", async () => {
    const at = (time: string) => (): InboxAnswer => {
      clock.at = new Date(time);
      return ok({ waiting: 1 });
    };
    const waiter = await waiting([at('2026-10-23T12:00:00.000Z'), at('2026-10-23T12:29:59.000Z'), at('2026-10-23T12:30:00.000Z'), at('2026-10-23T12:31:00.000Z')], {
      wakes: [ok({ kind: 'inWindow', until: new Date('2026-10-23T12:30:00.000Z') })],
    });

    await runUntilIdle(waiter);

    expect(waiter.woken.map(({ at: wokenAt }) => wokenAt.toISOString())).toEqual(['2026-10-23T12:00:00.000Z', '2026-10-23T12:30:00.000Z']);
  });

  it('tries a wake that failed again, waiting longer each time, up to its longest wait', async () => {
    const at = (time: string) => (): InboxAnswer => {
      clock.at = new Date(time);
      return ok({ waiting: 1 });
    };
    const waiter = await waiting(
      [at('2026-10-23T12:00:00.000Z'), at('2026-10-23T12:00:59.000Z'), at('2026-10-23T12:01:00.000Z'), at('2026-10-23T12:05:59.000Z'), at('2026-10-23T12:06:00.000Z'), at('2026-10-23T12:11:00.000Z'), at('2026-10-23T12:20:00.000Z')],
      { wakes: [ok({ kind: 'failed' }), ok({ kind: 'failed' }), ok({ kind: 'failed' })] },
    );

    await runUntilIdle(waiter);

    expect(waiter.woken.map(({ at: wokenAt }) => wokenAt.toISOString())).toEqual(['2026-10-23T12:00:00.000Z', '2026-10-23T12:01:00.000Z', '2026-10-23T12:06:00.000Z', '2026-10-23T12:11:00.000Z']);
  });

  it('stops and drops the crew when the fleet refuses its wake because the lease ended', async () => {
    const waiter = await waiting([ok({ waiting: 1 })], { wakes: [err({ code: 'LEASE_ENDED', message: 'The lease ended' })] });

    const ended = await waiter.waitOnPersonShip(SHIP, waiter.stop.signal);

    expect({ ended, held: waiter.crews.held }).toEqual({ ended: { reason: 'crewEnded' }, held: [] });
  });

  it('ends without a call for a ship whose crew the gateway no longer holds', async () => {
    const waiter = await waiting([]);
    await waiter.crews.drop(SHIP.fleetId, SHIP.shipId);

    const ended = await waiter.waitOnPersonShip(SHIP, waiter.stop.signal);

    expect({ ended, asked: waiter.asked }).toEqual({ ended: { reason: 'noCrew' }, asked: [] });
  });

  it('ends once stopped, dropping nothing', async () => {
    const waiter = await waiting([ok({ waiting: 0 })]);

    const ended = await runUntilIdle(waiter);

    expect({ ended, held: waiter.crews.held.length }).toEqual({ ended: { reason: 'stopped' }, held: 1 });
  });
});

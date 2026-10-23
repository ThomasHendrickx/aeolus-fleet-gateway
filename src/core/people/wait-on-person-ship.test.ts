import { describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { memoryPersonCrews } from '../../../test/support/people-fakes.js';
import { PERSON_SHIP_ID } from '../../../test/support/sign-in-fakes.js';
import type { FleetRefusal } from '../connection/ports.js';
import { err, ok, type Result } from '../shared/result.js';
import type { InboxChange, PersonShipDoor } from './ports.js';
import { createWaitOnPersonShip } from './wait-on-person-ship.js';
import type { WakeOutcome } from './wake-person.js';

// The gateway waits on every person ship it crews (wake a person, W5, W7):
// it asks the fleet's inbox to wait while the count is the one it knows,
// and tells the person's pages each time the count changed.

const SHIP = { fleetId: FLEET_ID, shipId: PERSON_SHIP_ID };
const CREW_TOKEN = 'aeolus_ct_v1_charlotte';
const AGAIN_WAITS_MS = [100, 200] as const;
const WAKE_AGAIN_WAITS_MS = [30_000, 60_000] as const;
const START = new Date('2026-10-23T10:00:00.000Z');
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

async function waiting(answers: (InboxAnswer | (() => InboxAnswer))[], options: { crews?: ReturnType<typeof memoryPersonCrews>; wakeOutcomes?: WakeOutcome[] } = {}) {
  const { crews = memoryPersonCrews(), wakeOutcomes = [] } = options;
  await crews.save({ ...SHIP, crewToken: CREW_TOKEN, crewedAt: new Date('2026-10-23T09:00:00.000Z') });
  const { inbox, asked } = scriptedInbox(answers);
  const told: InboxChange[] = [];
  const slept: number[] = [];
  /** Each wake, with the crew token and the time it ran at. */
  const woken: { crewToken: string; at: Date }[] = [];
  const clock = { at: START, now: () => clock.at };
  const stop = new AbortController();
  const waitOnPersonShip = createWaitOnPersonShip({
    crews,
    door: { inbox },
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
    wake: (ship, crewToken) => {
      woken.push({ crewToken, at: clock.now() });
      return Promise.resolve(wakeOutcomes.shift() ?? { kind: 'settled' });
    },
    clock,
    wakeAgainWaitsMs: WAKE_AGAIN_WAITS_MS,
  });
  return { crews, asked, told, slept, woken, clock, stop, waitOnPersonShip };
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

/** An inbox answer given once the clock moved on to then. */
function answeredAt(waiter: { clock: { at: Date } }, { at, answer }: { at: Date; answer: InboxAnswer }) {
  return () => {
    waiter.clock.at = at;
    return answer;
  };
}

const after = (ms: number) => new Date(START.getTime() + ms);

describe('the waiter of a person ship wakes its person (wake a person, W3)', () => {
  it('wakes them with the crew it holds each time the count rose', async () => {
    const waiter = await waiting([ok({ waiting: 0 }), ok({ waiting: 1 }), ok({ waiting: 1 }), ok({ waiting: 3 })]);

    await runUntilIdle(waiter);

    expect(waiter.woken).toEqual([
      { crewToken: CREW_TOKEN, at: START },
      { crewToken: CREW_TOKEN, at: START },
    ]);
  });

  it('wakes them at its first look while something waits, as after a restart between a wake and its hand-over', async () => {
    const waiter = await waiting([ok({ waiting: 2 })]);

    await runUntilIdle(waiter);

    expect(waiter.woken).toHaveLength(1);
  });

  it('wakes no one when the count went down, as when they opened one elsewhere', async () => {
    const waiter = await waiting([ok({ waiting: 0 }), ok({ waiting: 2 }), ok({ waiting: 1 }), ok({ waiting: 0 })]);

    await runUntilIdle(waiter);

    expect(waiter.woken).toHaveLength(1);
  });

  it("looks again once the channel's window ended, though the count did not change", async () => {
    const answers: (InboxAnswer | (() => InboxAnswer))[] = [ok({ waiting: 1 })];
    const waiter = await waiting(answers, { wakeOutcomes: [{ kind: 'windowOpen', endsAt: after(600_000) }] });
    answers.push(answeredAt(waiter, { at: after(599_999), answer: ok({ waiting: 1 }) }), answeredAt(waiter, { at: after(600_000), answer: ok({ waiting: 1 }) }), answeredAt(waiter, { at: after(625_000), answer: ok({ waiting: 1 }) }));

    await runUntilIdle(waiter);

    expect(waiter.woken.map(({ at }) => at)).toEqual([START, after(600_000)]);
  });

  it('tries a failed wake again, waiting longer each time, up to its longest wait', async () => {
    const answers: (InboxAnswer | (() => InboxAnswer))[] = [ok({ waiting: 1 })];
    const waiter = await waiting(answers, { wakeOutcomes: [{ kind: 'failed' }, { kind: 'failed' }, { kind: 'failed' }] });
    answers.push(
      answeredAt(waiter, { at: after(29_999), answer: ok({ waiting: 1 }) }),
      answeredAt(waiter, { at: after(30_000), answer: ok({ waiting: 1 }) }),
      answeredAt(waiter, { at: after(89_999), answer: ok({ waiting: 1 }) }),
      answeredAt(waiter, { at: after(90_000), answer: ok({ waiting: 1 }) }),
      answeredAt(waiter, { at: after(150_000), answer: ok({ waiting: 1 }) }),
      answeredAt(waiter, { at: after(200_000), answer: ok({ waiting: 1 }) }),
    );

    await runUntilIdle(waiter);

    expect(waiter.woken.map(({ at }) => at)).toEqual([START, after(30_000), after(90_000), after(150_000)]);
  });
});

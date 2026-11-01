import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { CHARLOTTE_GRANT, fakeCrewPersonShip, memoryConnectedChats, memoryPersonCrews } from '../../../test/support/people-fakes.js';
import { PERSON_SHIP_ID } from '../../../test/support/sign-in-fakes.js';
import { ok } from '../shared/result.js';
import { createReadChats } from './read-chats.js';

// Where things show (Bridge, section 8; the routing mockup): the chat
// place says which of the person's MCP clients are connected through the
// gateway, by their names.

const NOW = new Date('2026-10-31T20:00:00.000Z');
const LATER = new Date('2026-11-30T20:00:00.000Z');
const EARLIER = new Date('2026-10-31T19:59:59.999Z');

let chats: ReturnType<typeof memoryConnectedChats>;

beforeEach(() => {
  chats = memoryConnectedChats();
});

function readChats() {
  return createReadChats({ crewPersonShip: fakeCrewPersonShip(memoryPersonCrews()), chats, clock: { now: () => NOW } });
}

function aChat(name: string, liveUntil: Date) {
  return { fleetId: FLEET_ID, shipId: PERSON_SHIP_ID, name, liveUntil };
}

describe('a person reads the chats connected through the gateway', () => {
  it('names each chat signed in as their person ship, once and by name', async () => {
    chats.held.push(aChat('claude.ai', LATER), aChat('ChatGPT', LATER), aChat('claude.ai', LATER));

    await expect(readChats()(CHARLOTTE_GRANT)).resolves.toEqual(ok({ names: ['ChatGPT', 'claude.ai'] }));
  });

  it('leaves out a chat whose sign-in no longer lives', async () => {
    chats.held.push(aChat('claude.ai', EARLIER), aChat('ChatGPT', NOW));

    await expect(readChats()(CHARLOTTE_GRANT)).resolves.toEqual(ok({ names: [] }));
  });

  it("leaves out another person ship's chats", async () => {
    chats.held.push({ ...aChat('claude.ai', LATER), shipId: 'shp_01m3tb1zgr5h2ffee12xnch8zz' });

    await expect(readChats()(CHARLOTTE_GRANT)).resolves.toEqual(ok({ names: [] }));
  });

  it('is refused for an account with no person ship', async () => {
    const answer = await readChats()({ fleetId: FLEET_ID, grantId: 'grant-of-no-person' });

    expect(answer.isOk).toBe(false);
  });
});

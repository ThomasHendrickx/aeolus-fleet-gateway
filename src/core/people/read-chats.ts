import type { Clock } from '../shared/clock.js';
import { ok, type Result } from '../shared/result.js';
import type { CrewPersonShip } from './crew-person-ship.js';
import { personCrewOf, type PersonCaller, type PersonCrewError } from './person-crew.js';
import type { ConnectedChats } from './ports.js';

/** The chats connected through the gateway as a person ship, by their MCP clients' names. */
export interface Chats {
  readonly names: readonly string[];
}

export type ReadChats = (caller: PersonCaller) => Promise<Result<Chats, PersonCrewError>>;

/**
 * Use case: the chats a person connected through the gateway, as the chat
 * place on Bridge's Where things show names them (Bridge, section 8; the
 * routing mockup). A chat is connected while a sign-in of its MCP client
 * as the person ship lives; each is named once.
 */
export function createReadChats(deps: { crewPersonShip: CrewPersonShip; chats: ConnectedChats; clock: Clock }): ReadChats {
  return async (caller) => {
    const crew = await personCrewOf(deps.crewPersonShip, caller);
    if (!crew.isOk) {
      return crew;
    }
    const now = deps.clock.now();
    const live = (await deps.chats.list(caller.fleetId, crew.value.shipId)).filter(({ liveUntil }) => liveUntil > now);
    return ok({ names: [...new Set(live.map(({ name }) => name))].sort((a, b) => a.localeCompare(b)) });
  };
}

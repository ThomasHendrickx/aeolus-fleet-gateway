import type { SignInServers } from '../party-grants/ports.js';
import type { PartyStore } from './ports.js';

/** Parties published to Party Grants: an approved outside MCP server is a sign-in server, with its client where each person signs in. */
export function signInServersOf(parties: Pick<PartyStore, 'find'>): SignInServers {
  return {
    async find(fleetId, name) {
      const party = await parties.find(fleetId, name);
      if (party?.kind !== 'mcpServer') {
        return undefined;
      }
      return { fleetId: party.fleetId, name: party.name, client: party.credential.kind === 'personSignIn' ? party.credential.client : null };
    },
  };
}

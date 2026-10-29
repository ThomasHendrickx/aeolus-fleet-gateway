/** The outside parties' pages. */
export const OUTSIDE_PARTIES_PATH = '/outside-parties';

export const ADD_SERVER_PATH = `${OUTSIDE_PARTIES_PATH}/add`;

export const ADD_A2A_CLIENT_PATH = `${OUTSIDE_PARTIES_PATH}/add-a2a-client`;

export const ADD_A2A_AGENT_PATH = `${OUTSIDE_PARTIES_PATH}/add-a2a-agent`;

/** One outside party's page, or one of its own: changing it, retiring it. */
export function partyPath(name: string, action?: 'change' | 'retire'): string {
  return `${OUTSIDE_PARTIES_PATH}/${encodeURIComponent(name)}${action === undefined ? '' : `/${action}`}`;
}

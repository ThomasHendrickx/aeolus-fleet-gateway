import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { TRPCError } from '@trpc/server';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ACCOUNT_URL, CHARLOTTE, CHARLOTTE_ACCOUNT_TOKEN, CHARLOTTE_SIGN_IN, CONSOLE_URL, fakeSharedSignIn, GATEWAY_URL } from '../../../test/support/account-sign-in-fakes.js';
import { FLEET_ID, OTHER_FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { HEADS_MEETING_ID, aMeetingRead } from '../../../test/support/meeting-fakes.js';
import { createAccountInView } from '../../core/account-sign-in/account-in-view.js';
import { createAccountOfSignIn } from '../../core/account-sign-in/account-of-sign-in.js';
import type { PersonCaller } from '../../core/people/person-crew.js';
import type { MarkTool } from '../../core/mcp-out/mark-tool.js';
import type { SwitchTools } from '../../core/parties/switch-tools.js';
import type { SetScopeRequirements } from '../../core/parties/set-scope-requirements.js';
import type { AddA2aAgent } from '../../core/parties/add-a2a-agent.js';
import type { MarkA2aAgent } from '../../core/a2a-out/mark-a2a-agent.js';
import type { AddClientParty } from '../../core/parties/add-client-party.js';
import type { ApproveParty } from '../../core/parties/approve-party.js';
import type { SetOutsideParties } from '../../core/outside-parties/set-outside-parties.js';
import type { DecideRequest } from '../../core/requests/decide-request.js';
import type { PendingRequest } from '../../core/requests/ports.js';
import { err, ok } from '../../core/shared/result.js';
import { createFocusPage } from '../../core/people/focus-page.js';
import { memoryFocusedPages } from '../../../test/support/people-fakes.js';
import { createChangeHub, type ChangeHub } from '../http/live.js';
import { fakeProxyShipKinds, fakeShipNames, fakeSlackShips, fakeSlackTooling, memorySlackApps, memorySlackWorkspaces, plainInstallStates } from '../../../test/support/slack-fakes.js';
import type { CredentialOf } from '../../core/actors/credential-of.js';
import { createExposeShip } from '../../core/slack/expose-ship.js';
import { createListExposable } from '../../core/slack/list-exposable.js';
import { createRemoveBot } from '../../core/slack/remove-bot.js';
import { createConnectSlack } from '../../core/slack/connect-slack.js';
import { createDisconnectSlack } from '../../core/slack/disconnect-slack.js';
import { createReadSlack } from '../../core/slack/read-slack.js';
import { createStartInstall } from '../../core/slack/start-install.js';
import { createTakeAccessToken } from '../../core/slack/take-access-token.js';
import { gatewayRouter, type Context } from './router.js';

/** The grant a person called by from an MCP client, or the account token their shared sign-in was exchanged for. */
function grantOf(caller: PersonCaller): string {
  return 'grantId' in caller ? caller.grantId : caller.signedIn.accountToken;
}

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const OWNER = 'shp_01m3tbfspe96yf1rnr4ank9wnr';
const FOCUSED_AT = new Date('2026-10-23T10:00:00.000Z');
/** The gateway's public push key, which a browser subscribes with. */
const WEB_PUSH_KEY = 'BGatewayPublicKey';
const ARGO_COOKIE = 'aeolus_session=argo';
const VIEWER_COOKIE = 'aeolus_session=viewer';
/** A person signed in to the gateway's pages, and one whose account token no longer works. */
const PERSON_COOKIE = 'aeolus_account_session=charlotte';
const SIGNED_OUT_COOKIE = 'aeolus_account_session=ended';
/** An account signed in to the console as itself (decision 0053): no account token or person ship the gateway holds. */
const ACCOUNT_CONSOLE_COOKIE = 'aeolus_session=charlotte';
const PERSON_TOKEN = 'account-token-1';
const SHARED_ACCOUNT_TOKEN = 'account-token-shared';
const MANAGER: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9mgr';
/** A ship's own crew tokens: one holding fleet:manage, one only reading. */
const MANAGER_CREW = 'aeolus_ct_v1_manager';
const READER_CREW = 'aeolus_ct_v1_reader';
/** A ship's own crew token holding gateway:approve. */
const APPROVER_CREW = 'aeolus_ct_v1_approver';
/** A ship's own crew token holding fleet:manage and gateway:approve, so it adds a server with its tools switched. */
const MANAGING_APPROVER_CREW = 'aeolus_ct_v1_managing_approver';
const REQUEST_ID = 'req_01m5c7hmbt9f1vrkwb37az0001';
const CURSOR_CLIENT = 'https://cursor.example.com/client.json';
const DELIVERY = 'dlv_01m3tbfspe96yf1rnr4ank9dlv';
const DECIDED = 'req_01m5c7hmbt9f1vrkwb37az0002';
const ORDERBOT_REQUEST: PendingRequest = {
  fleetId: 'flt_01m3tb1zgr5h2ffee12xnch8sv',
  requestId: REQUEST_ID,
  subject: { kind: 'client', clientId: 'https://orderbot.example.com/client.json', clientName: 'Orderbot' },
  requesters: [{ accountId: 'acc-charlotte', personShipId: 'shp_01m3tbfspe96yf1rnr4ank9wnr' }],
  askedAt: new Date('2026-10-20T09:00:00.000Z'),
  expiresAt: new Date('2026-10-27T09:00:00.000Z'),
  state: 'pending',
  decidedBy: null,
  decidedAt: null,
};

/** A context with only what the parties procedures read; every approval it is asked for is recorded. */
function aContext(cookie: string | undefined, crewToken?: string): {
  context: Context;
  approvals: Parameters<ApproveParty>[0][];
  additions: Parameters<AddClientParty>[0][];
  marks: Parameters<MarkTool>[0][];
  toolSwitches: Parameters<SwitchTools>[0][];
  requirementChanges: Parameters<SetScopeRequirements>[0][];
  agentAdditions: Parameters<AddA2aAgent>[0][];
  agentMarks: Parameters<MarkA2aAgent>[0][];
  decisions: Parameters<DecideRequest>[0][];
  switched: Parameters<SetOutsideParties>[0][];
  answers: Record<string, string>[];
  changes: ChangeHub;
  focused: ReturnType<typeof memoryFocusedPages>;
  slack: { tooling: ReturnType<typeof fakeSlackTooling>; workspaces: ReturnType<typeof memorySlackWorkspaces>; apps: ReturnType<typeof memorySlackApps> };
} {
  const focused = memoryFocusedPages();
  const approvals: Parameters<ApproveParty>[0][] = [];
  const additions: Parameters<AddClientParty>[0][] = [];
  const switched: Parameters<SetOutsideParties>[0][] = [];
  const decisions: Parameters<DecideRequest>[0][] = [];
  const marks: Parameters<MarkTool>[0][] = [];
  const toolSwitches: Parameters<SwitchTools>[0][] = [];
  const requirementChanges: Parameters<SetScopeRequirements>[0][] = [];
  const agentAdditions: Parameters<AddA2aAgent>[0][] = [];
  const agentMarks: Parameters<MarkA2aAgent>[0][] = [];
  const answers: Record<string, string>[] = [];
  const unused = () => Promise.reject(new Error('not used by the parties procedures'));
  const changes = createChangeHub();
  const slackTooling = fakeSlackTooling({ now: () => SLACK_NOW });
  const slackWorkspaces = memorySlackWorkspaces();
  const slackApps = memorySlackApps();
  const context: Context = {
    cookie,
    crewToken,
    authenticateActor: (sent) => {
      if (sent.crewToken !== undefined) {
        const scopes = { [MANAGER_CREW]: ['fleet:read', 'fleet:manage'], [APPROVER_CREW]: ['fleet:read', 'gateway:approve'], [MANAGING_APPROVER_CREW]: ['fleet:read', 'fleet:manage', 'gateway:approve'] }[sent.crewToken] ?? ['fleet:read'];
        return Promise.resolve(ok({ fleetId: FLEET, kind: 'ship' as const, shipId: MANAGER, scopes }));
      }
      if (sent.signIn === CHARLOTTE_SIGN_IN && sent.fleetId === FLEET) {
        return Promise.resolve(ok({ fleetId: FLEET, kind: 'account' as const, accountId: 'acc-charlotte', personShipId: OWNER, accountToken: SHARED_ACCOUNT_TOKEN, scopes: ['fleet:read'] }));
      }
      if (sent.cookie === ACCOUNT_CONSOLE_COOKIE) {
        return Promise.resolve(ok({ fleetId: FLEET, kind: 'account' as const, accountId: 'acc-charlotte', personShipId: null, accountToken: null, scopes: ['fleet:read'] }));
      }
      if (sent.cookie === PERSON_COOKIE || sent.cookie === SIGNED_OUT_COOKIE) {
        return Promise.resolve(ok({ fleetId: FLEET, kind: 'account' as const, accountId: 'acc-charlotte', personShipId: OWNER, accountToken: sent.cookie === PERSON_COOKIE ? PERSON_TOKEN : 'account-token-ended', scopes: ['fleet:read'] }));
      }
      return Promise.resolve(ok(sent.cookie === ARGO_COOKIE ? { fleetId: FLEET, kind: 'operator' as const, scopes: ['fleet:read', 'fleet:manage'] } : { fleetId: FLEET, kind: 'viewer' as const, scopes: ['fleet:read'] }));
    },
    person: {
      readInbox: (caller) =>
        Promise.resolve(
          [PERSON_TOKEN, SHARED_ACCOUNT_TOKEN].includes(grantOf(caller))
            ? ok({ waiting: 1, deliveries: [{ deliveryId: DELIVERY, from: 'prd-writer', title: 'Publish the PRD draft to Linear?', sentAt: '2026-10-20T09:00:00.000Z' }], opened: [] })
            : err({ kind: 'SIGNED_OUT' as const, message: 'Your sign-in ended: sign in again' }),
        ),
      openDelivery: ({ caller, deliveryId }) =>
        Promise.resolve(
          deliveryId === DELIVERY && [PERSON_TOKEN, SHARED_ACCOUNT_TOKEN].includes(grantOf(caller))
            ? ok({ deliveryId: DELIVERY, from: 'prd-writer', title: 'Publish the PRD draft to Linear?', sentAt: '2026-10-20T09:00:00.000Z', contentType: 'text/plain', payload: 'Publish it?', meetingId: null })
            : err({ kind: 'NO_SUCH_DELIVERY' as const, message: `No delivery ${deliveryId} waits for you: read your inbox again` }),
        ),
      answerDelivery: (input) => {
        answers.push({ grantId: grantOf(input.caller), deliveryId: input.deliveryId, contentType: input.contentType, payload: input.payload });
        return Promise.resolve(ok({ deliveryId: DELIVERY, isHandled: true as const }));
      },
      doneDelivery: (input) => {
        answers.push({ grantId: grantOf(input.caller), deliveryId: input.deliveryId });
        return Promise.resolve(ok({ deliveryId: DELIVERY, isHandled: true as const }));
      },
      readWakeChannels: (caller) =>
        Promise.resolve(
          ok({
            email: { isOffered: true, isOn: answers.some(({ email }) => email === 'on') && grantOf(caller) === PERSON_TOKEN },
            webPush: {
              publicKey: WEB_PUSH_KEY,
              browsers: answers.flatMap(({ webPushOn, browser }) => (webPushOn === undefined || browser === undefined ? [] : [{ endpoint: webPushOn, browser, addedAt: FOCUSED_AT, isGone: false }])),
            },
          }),
        ),
      turnOnWebPush: ({ caller, fleetName, endpoint, browser }) => {
        if (!endpoint.startsWith('https://')) {
          return Promise.resolve(err({ kind: 'INVALID_SUBSCRIPTION' as const, message: "The push service's endpoint must be an https URL of at most 2048 characters" }));
        }
        answers.push({ grantId: grantOf(caller), webPushOn: endpoint, browser, fleetName });
        return Promise.resolve(ok(undefined));
      },
      turnOffWebPush: ({ caller, endpoint }) => {
        answers.push({ grantId: grantOf(caller), webPushOff: endpoint });
        return Promise.resolve(ok(undefined));
      },
      turnEmailChannel: ({ caller, isOn }) => {
        answers.push({ grantId: grantOf(caller), email: isOn ? 'on' : 'off' });
        return Promise.resolve(ok(undefined));
      },
      // Seen again only once the page lets go, as the test reads what it held meanwhile.
      focusPage: createFocusPage({
        focused,
        clock: { now: () => FOCUSED_AT },
        seenEveryMs: 20_000,
        sleep: (_ms, signal) =>
          new Promise((resolve) => {
            signal.addEventListener('abort', () => {
              resolve();
            }, { once: true });
          }),
      }),
      readMeeting: ({ meetingId }) =>
        Promise.resolve(
          meetingId === HEADS_MEETING_ID
            ? ok({ meeting: aMeetingRead(), mic: { kind: 'requested' as const, place: 1 } })
            : err({ kind: 'NO_SUCH_MEETING' as const, message: `The fleet did not read the meeting to you: Meeting ${meetingId} does not exist` }),
        ),
      sendMessage: (input) => {
        answers.push({ grantId: grantOf(input.caller), to: JSON.stringify(input.to), contentType: input.contentType, payload: input.payload, idempotencyKey: input.idempotencyKey ?? '' });
        return Promise.resolve(ok({ messageId: 'msg_01m5qa5j85mgd4z61d9c2k0009' as const }));
      },
      changeOwnMic: (input) => {
        if (input.change === 'release') {
          return Promise.resolve(err({ kind: 'MIC_REFUSED' as const, message: 'The fleet did not change the mic: You do not hold the mic' }));
        }
        answers.push({ grantId: grantOf(input.caller), meetingId: input.meetingId, change: input.change });
        return Promise.resolve(ok(undefined));
      },
    },
    changes,
    isServed: () => Promise.resolve(true),
    heldConnection: unused,
    installationTokenSent: undefined,
    installation: { mode: 'open', token: undefined },
    setFleetEnabled: unused,
    readFleet: unused,
    deleteFleet: unused,
    endSignIns: unused,
    readConnection: unused,
    connect: unused,
    approveParty: (input) => {
      approvals.push(input);
      return Promise.resolve(ok({ name: input.name, kind: 'mcpServer' as const, url: input.url, credentialKind: input.credential.kind, ownerShipId: input.ownerShipId, concurrencyLimit: input.concurrencyLimit, state: 'crewed' as const, proxyShipId: null }));
    },
    crewParty: ({ name }) =>
      Promise.resolve(
        name === 'agentcore'
          ? ok({ party: { name, kind: 'mcpClient' as const, clientId: 'client-agentcore', state: 'crewed' as const, proxyShipId: null }, clientSecret: 'new-client-secret' })
          : err({ kind: 'NOT_AWAITING_CREW' as const, message: `The proxy ship of ${name} does not await crew` }),
      ),
    addClientParty: (input) => {
      additions.push(input);
      if (!input.actor.scopes.includes('gateway:approve')) {
        return Promise.resolve(err({ kind: 'NOT_AN_APPROVER' as const, message: 'Adding a client party needs gateway:approve' }));
      }
      return Promise.resolve(ok({ party: { name: input.name, kind: 'mcpClient' as const, clientId: 'client-agentcore', state: 'crewed' as const, proxyShipId: null }, clientId: 'client-agentcore', clientSecret: 'client-secret' }));
    },
    listParties: () => Promise.resolve([]),
    listOwnerChoices: () => Promise.resolve(ok([])),
    retireParty: unused,
    changePartyOwner: unused,
    changePartyScopes: unused,
    readParty: unused,
    readAuthorization: (request) =>
      Promise.resolve(
        request.client_id === CURSOR_CLIENT
          ? ok({ clientId: CURSOR_CLIENT, clientName: 'Cursor', clientFleetId: null, redirectUri: 'http://127.0.0.1:7777/callback', codeChallenge: 'challenge', resource: 'https://gateway.example.com/mcp', scope: null, state: 'state-1' })
          : err({ kind: 'invalidClient' as const, message: 'No client client-unknown is known' }),
      ),
    watchWaiting: ({ waiting, browserSecret }) =>
      Promise.resolve(
        waiting === 'waiting-1' && browserSecret === 'secret-1'
          ? ok({ fleetId: FLEET_ID, clientName: 'Cursor', isWaiting: true, expiresAt: new Date('2026-10-28T09:00:00.000Z') })
          : waiting === 'waiting-1'
            ? err({ kind: 'otherBrowser' as const })
            : ok({ fleetId: FLEET_ID, clientName: 'Cursor', isWaiting: false, expiresAt: new Date('2026-10-28T09:00:00.000Z') }),
      ),
    registerClient: (input) => Promise.resolve(input.redirectUris.length === 0 ? err({ kind: 'INVALID_REDIRECT_URIS' as const, message: 'A client registers 1 to 10 redirect URIs' }) : ok({ clientId: 'client-1', clientSecret: input.isConfidential ? 's' : null })),
    checkServer: ({ url }) =>
      Promise.resolve(url === 'https://down.example.com/mcp' ? err({ kind: 'SERVER_UNREACHABLE' as const, message: 'The MCP server could not be listed: connect ECONNREFUSED' }) : ok({ tools: [{ name: 'list_issues', description: 'List issues', isReadOnly: true }] })),
    addA2aClient: ({ actor, name }) =>
      Promise.resolve(
        actor.scopes.includes('gateway:approve')
          ? ok({ party: { name, kind: 'a2aClient' as const, state: 'crewed' as const, proxyShipId: null }, bearer: 'bearer-1' })
          : err({ kind: 'NOT_AN_APPROVER' as const, message: 'Adding an outside A2A client needs gateway:approve' }),
      ),
    addA2aAgent: (input) => {
      agentAdditions.push(input);
      if (!input.actor.scopes.includes('gateway:approve')) {
        return Promise.resolve(err({ kind: 'NOT_AN_APPROVER' as const, message: 'Adding an outside A2A agent needs gateway:approve' }));
      }
      if (input.cardUrl.includes('down')) {
        return Promise.resolve(err({ kind: 'CARD_UNREACHABLE' as const, message: "The card of quotes could not be read: connection refused" }));
      }
      if (input.cardUrl.includes('broken')) {
        return Promise.resolve(err({ kind: 'CARD_INVALID' as const, message: 'The card has no skill to state' }));
      }
      return Promise.resolve(ok({ name: input.name, kind: 'a2aAgent' as const, cardUrl: input.cardUrl, credentialKind: input.credential.kind, concurrencyLimit: input.concurrencyLimit, isRepeatable: true, state: 'crewed' as const, proxyShipId: null }));
    },
    markA2aAgent: (input) => {
      agentMarks.push(input);
      if (!input.actor.scopes.includes('gateway:approve')) {
        return Promise.resolve(err({ kind: 'NOT_AN_APPROVER' as const, message: 'Marking an outside A2A agent needs gateway:approve' }));
      }
      return Promise.resolve(input.name === 'quotes' ? ok({ isRepeatable: input.isRepeatable, statementRefusal: null }) : err({ kind: 'NO_SUCH_PARTY' as const, message: `There is no outside A2A agent ${input.name}` }));
    },
    listReachedShips: ({ party }) =>
      Promise.resolve(party === 'supplier' ? ok([{ shipId: 'shp_01m3tbfspe96yf1rnr4ank9cr2' as const, alias: 'acrm2345', statement: null }]) : err({ kind: 'PARTY_NOT_CREWED' as const, message: `The party ${party} is not crewed` })),
    cardAddressOf: (alias) => `https://gateway.example.com/gw/a2a/${alias}/.well-known/agent-card.json`,
    readPartyTools: ({ name }) => Promise.resolve(name === 'linear' ? ok({ tools: [{ name: 'list_issues', description: 'List issues', isReadOnly: true, isOn: true, isNew: false }] }) : err({ kind: 'NO_SUCH_PARTY' as const, message: `There is no outside MCP server ${name}` })),
    stateParty: ({ name }) => Promise.resolve(name === 'crm' ? ok({ capabilities: ['list_deals'] }) : err({ kind: 'NO_SUCH_PARTY' as const, message: `No party named ${name}` })),
    markTool: (input) => {
      marks.push(input);
      return Promise.resolve(ok({ capabilities: ['list_deals'] }));
    },
    switchTools: (input) => {
      toolSwitches.push(input);
      if (!input.actor.scopes.includes('gateway:approve')) {
        return Promise.resolve(err({ kind: 'NOT_AN_APPROVER' as const, message: "Switching an outside party's tools needs gateway:approve" }));
      }
      if (input.tools.includes('delete_project')) {
        return Promise.resolve(err({ kind: 'NO_SUCH_TOOL' as const, message: 'The MCP server of crm lists no tool delete_project now' }));
      }
      return Promise.resolve(ok({ tools: [...input.tools], isOn: input.isOn, statementRefusal: null }));
    },
    readListedScopes: ({ actor }) =>
      Promise.resolve(actor.scopes.includes('gateway:approve') ? ok([{ scope: 'crm:read-leads', description: 'Read leads in the CRM' }]) : err({ kind: 'NOT_AN_APPROVER' as const, message: 'Reading the scopes to require takes gateway:approve' })),
    checkApproving: ({ actor, name }) => {
      if (name === 'claude') {
        return Promise.resolve(err({ kind: 'NO_SUCH_PARTY' as const, message: 'There is no outside MCP server or A2A agent claude' }));
      }
      if (!actor.scopes.includes('gateway:approve')) {
        return Promise.resolve(err({ kind: 'NOT_AN_APPROVER' as const, message: 'Setting the scopes an outside party needs takes gateway:approve' }));
      }
      return Promise.resolve(name === 'erp' ? err({ kind: 'NOT_REACHABLE' as const, message: 'erp is not within your manage reach' }) : ok(undefined));
    },
    readScopeRequirements: ({ name }) =>
      Promise.resolve(name === 'crm' ? ok({ version: 2, party: ['crm:use'], tools: new Map([['update_lead', ['crm:write-leads']]]) }) : err({ kind: 'NO_SUCH_PARTY' as const, message: `There is no outside MCP server or A2A agent ${name}` })),
    setScopeRequirements: (input) => {
      requirementChanges.push(input);
      if (!input.actor.scopes.includes('gateway:approve')) {
        return Promise.resolve(err({ kind: 'NOT_AN_APPROVER' as const, message: 'Setting the scopes an outside party needs takes gateway:approve' }));
      }
      if (input.name === 'erp') {
        return Promise.resolve(err({ kind: 'NOT_REACHABLE' as const, message: 'erp is not within your manage reach' }));
      }
      if (input.version !== 2) {
        return Promise.resolve(err({ kind: 'CONFLICT' as const, message: 'The requirements changed since you opened this page' }));
      }
      if (input.party?.includes('crm:admin') === true) {
        return Promise.resolve(err({ kind: 'SCOPE_NOT_LISTED' as const, message: 'The fleet lists no scope crm:admin: define it first, or pick a listed one' }));
      }
      return Promise.resolve(ok({ requirements: { version: 3, party: input.party ?? ['crm:use'], tools: input.tools }, statementRefusal: null }));
    },
    slack: slackOf({ tooling: slackTooling, workspaces: slackWorkspaces, apps: slackApps }),
    readOutsideParties: () => Promise.resolve({ isOn: false }),
    setOutsideParties: (input) => {
      switched.push(input);
      if (input.isOn && !input.isOpenNetworkConfirmed) {
        return Promise.resolve(err({ kind: 'OPEN_NETWORK' as const, message: 'This fleet applies no network rules' }));
      }
      return Promise.resolve(ok({ isOn: input.isOn }));
    },
    listMine: (actor) =>
      Promise.resolve(actor.kind === 'account' ? ok([{ ...ORDERBOT_REQUEST, state: 'denied' as const, decidedBy: { kind: 'account' as const, accountId: 'acc-pieter' }, decidedAt: new Date('2026-10-21T09:00:00.000Z') }]) : err({ kind: 'NOT_AN_ACCOUNT' as const, message: 'Only a person signed in to the gateway has requests of their own' })),
    listToDecide: (actor) =>
      Promise.resolve(actor.scopes.includes('gateway:approve') ? ok([ORDERBOT_REQUEST]) : err({ kind: 'NOT_AN_APPROVER' as const, message: 'Deciding requests needs gateway:approve' })),
    decideRequest: (input) => {
      decisions.push(input);
      if (input.requestId === DECIDED) {
        return Promise.resolve(err({ kind: 'ALREADY_DECIDED' as const, message: 'This request was denied already' }));
      }
      return Promise.resolve(ok({ state: 'denied' as const, party: null }));
    },
  };
  return { context, approvals, marks, toolSwitches, requirementChanges, agentAdditions, agentMarks, decisions, switched, answers, changes, additions, focused, slack: { tooling: slackTooling, workspaces: slackWorkspaces, apps: slackApps } };
}

const SLACK_NOW = new Date('2026-10-27T09:00:00.000Z');
const SLACK_REDIRECT_URL = 'https://gateway.acme.test/gw/slack/install';
const SLACK_SHIP: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9r1n';

/** The Slack procedures' use cases over Slack and the vault in memory. */
function slackOf({ tooling, workspaces, apps }: { tooling: ReturnType<typeof fakeSlackTooling>; workspaces: ReturnType<typeof memorySlackWorkspaces>; apps: ReturnType<typeof memorySlackApps> }): Context['slack'] {
  const clock = { now: () => SLACK_NOW };
  const takeAccessToken = createTakeAccessToken({ slack: tooling.slack, workspaces, clock });
  const ships = fakeSlackShips([{ shipId: SLACK_SHIP, name: 'release-notes', kind: 'agent', status: 'crewed', summary: 'Writes the release notes' }]).port;
  const credentialOf: CredentialOf = (_actor, sent) => Promise.resolve(ok(sent));
  const addresses = { installRedirectUrl: SLACK_REDIRECT_URL, eventsUrl: 'https://gateway.acme.test/gw/slack/events' };
  return {
    readSlack: createReadSlack({ workspaces, apps, ships }),
    listExposable: createListExposable({ ships, apps, proxyShips: fakeProxyShipKinds(), credentialOf }),
    exposeShip: createExposeShip({ slack: tooling.slack, apps, ships, proxyShips: fakeProxyShipKinds(), takeAccessToken, credentialOf, clock, addresses }),
    removeBot: createRemoveBot({ slack: tooling.slack, apps, ships, takeAccessToken, credentialOf }),
    connectSlack: createConnectSlack({ slack: tooling.slack, workspaces, apps, shipNames: fakeShipNames({ [OWNER]: 'charlotte' }), clock, installRedirectUrl: SLACK_REDIRECT_URL }),
    startInstall: createStartInstall({ slack: tooling.slack, apps, workspaces, takeAccessToken, states: plainInstallStates(), ships, credentialOf, clock, installRedirectUrl: SLACK_REDIRECT_URL }),
    disconnectSlack: createDisconnectSlack({ slack: tooling.slack, workspaces, apps, takeAccessToken }),
  };
}

const APPROVAL = { requestId: 'a-1', name: 'crm', url: 'https://crm.example.com/mcp', credential: { kind: 'bearer' as const, token: 'crm-token' }, ownerShipId: OWNER };

type ApprovalInput = Parameters<ReturnType<typeof gatewayRouter.createCaller>['parties']['approve']>[0];

/** An input as it arrives over HTTP: anything, for the router's own parsing to judge. */
const asSent = (input: unknown): ApprovalInput => z.custom<ApprovalInput>(() => true).parse(input);

describe("argo approves parties through the gateway's API", () => {
  it("approves for argo's fleet, with the default concurrency limit of 4", async () => {
    const { context, approvals } = aContext(ARGO_COOKIE);

    await gatewayRouter.createCaller(context).parties.approve(APPROVAL);

    expect(approvals).toEqual([{ operatorFleetId: FLEET, ...APPROVAL, concurrencyLimit: 4, scopes: [], toolSwitches: null }]);
  });

  it('refuses a viewer, who only reads', async () => {
    const { context, approvals } = aContext(VIEWER_COOKIE);

    await expect(gatewayRouter.createCaller(context).parties.approve(APPROVAL)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(approvals).toEqual([]);
  });

  it('approves for a ship holding fleet:manage, by its own crew token (decision 0057)', async () => {
    const { context, approvals } = aContext(undefined, MANAGER_CREW);

    await gatewayRouter.createCaller(context).parties.approve(APPROVAL);

    expect(approvals).toEqual([{ operatorFleetId: FLEET, ...APPROVAL, concurrencyLimit: 4, scopes: [], toolSwitches: null }]);
  });

  it('refuses a ship that only reads, and lets it read the parties', async () => {
    const { context, approvals } = aContext(undefined, READER_CREW);

    await expect(gatewayRouter.createCaller(context).parties.approve(APPROVAL)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(gatewayRouter.createCaller(context).parties.list()).resolves.toEqual([]);
    expect(approvals).toEqual([]);
  });

  it('lets a viewer read the parties', async () => {
    await expect(gatewayRouter.createCaller(aContext(VIEWER_COOKIE).context).parties.list()).resolves.toEqual([]);
  });

  it.each([
    ['a URL that is not http or https', { ...APPROVAL, url: 'ftp://crm.example.com/mcp' }],
    ['an empty bearer token', { ...APPROVAL, credential: { kind: 'bearer', token: '' } }],
    ['client credentials without an issuer', { ...APPROVAL, credential: { kind: 'clientCredentials', clientId: 'gw', clientSecret: 's' } }],
    ['a concurrency limit of 0', { ...APPROVAL, concurrencyLimit: 0 }],
    ['a concurrency limit of 11, over the 10 calls core hands a proxy ship at once', { ...APPROVAL, concurrencyLimit: 11 }],
    ['a name that is no ship handle', { ...APPROVAL, name: 'the CRM' }],
  ])('refuses %s', async (_what, approval) => {
    const { context, approvals } = aContext(ARGO_COOKIE);

    await expect(gatewayRouter.createCaller(context).parties.approve(asSent(approval))).rejects.toBeInstanceOf(TRPCError);
    expect(approvals).toEqual([]);
  });

  it('approves a server that asks for no credential (aeolus-fleet#1153)', async () => {
    const { context, approvals } = aContext(ARGO_COOKIE);

    await gatewayRouter.createCaller(context).parties.approve(asSent({ ...APPROVAL, credential: { kind: 'none' } }));

    expect(approvals[0]?.credential).toEqual({ kind: 'none' });
  });

  it('keeps the tools an approver switched on and off when adding a server (aeolus-fleet#1151)', async () => {
    const { context, approvals } = aContext(undefined, MANAGING_APPROVER_CREW);

    await gatewayRouter.createCaller(context).parties.approve({ ...APPROVAL, tools: [{ name: 'list_contacts', isOn: true }, { name: 'delete_project', isOn: false }] });

    expect(approvals[0]?.toolSwitches).toEqual(new Map([['list_contacts', true], ['delete_project', false]]));
  });

  it('refuses tools switched by an actor without gateway:approve, adding nothing', async () => {
    const { context, approvals } = aContext(ARGO_COOKIE);

    await expect(gatewayRouter.createCaller(context).parties.approve({ ...APPROVAL, tools: [{ name: 'list_contacts', isOn: true }] })).rejects.toMatchObject({ code: 'FORBIDDEN', message: "Switching an outside party's tools needs gateway:approve" });
    expect(approvals).toEqual([]);
  });

  it('takes a concurrency limit of 10', async () => {
    const { context, approvals } = aContext(ARGO_COOKIE);

    await gatewayRouter.createCaller(context).parties.approve({ ...APPROVAL, concurrencyLimit: 10 });

    expect(approvals[0]?.concurrencyLimit).toBe(10);
  });
});

describe("an actor holding fleet:manage checks an outside MCP server through the gateway's API (F10)", () => {
  const CHECK = { url: 'https://mcp.linear.app/mcp', credential: { kind: 'bearer' as const, token: 'linear-token' } };

  it('answers the tools the server lists', async () => {
    await expect(gatewayRouter.createCaller(aContext(ARGO_COOKIE).context).parties.check(CHECK)).resolves.toEqual({ tools: [{ name: 'list_issues', description: 'List issues', isReadOnly: true }] });
  });

  it('answers BAD_GATEWAY when the server cannot be listed', async () => {
    await expect(gatewayRouter.createCaller(aContext(ARGO_COOKIE).context).parties.check({ ...CHECK, url: 'https://down.example.com/mcp' })).rejects.toMatchObject({ code: 'BAD_GATEWAY', message: 'The MCP server could not be listed: connect ECONNREFUSED' });
  });

  it('checks a server that asks for no credential (aeolus-fleet#1153)', async () => {
    await expect(gatewayRouter.createCaller(aContext(ARGO_COOKIE).context).parties.check(z.custom<typeof CHECK>(() => true).parse({ ...CHECK, credential: { kind: 'none' } }))).resolves.toEqual({ tools: [{ name: 'list_issues', description: 'List issues', isReadOnly: true }] });
  });

  it('refuses an actor without fleet:manage', async () => {
    await expect(gatewayRouter.createCaller(aContext(VIEWER_COOKIE).context).parties.check(CHECK)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe("an actor reads an outside MCP server's tools through the gateway's API", () => {
  it('answers the tools the server lists now', async () => {
    await expect(gatewayRouter.createCaller(aContext(VIEWER_COOKIE).context).parties.tools({ name: 'linear' })).resolves.toEqual({ tools: [{ name: 'list_issues', description: 'List issues', isReadOnly: true, isOn: true, isNew: false }] });
  });

  it('answers NOT_FOUND for a server it does not know', async () => {
    await expect(gatewayRouter.createCaller(aContext(VIEWER_COOKIE).context).parties.tools({ name: 'notion' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe("an approver adds an outside A2A client through the gateway's API (decision 0060)", () => {
  const ADDITION = { requestId: 'a-2', name: 'supplier', ownerShipId: OWNER, scopes: ['fleet:read'] };

  it('answers the party and its bearer, shown once', async () => {
    await expect(gatewayRouter.createCaller(aContext(undefined, APPROVER_CREW).context).parties.addA2aClient(ADDITION)).resolves.toEqual({
      party: { name: 'supplier', kind: 'a2aClient', state: 'crewed', proxyShipId: null },
      bearer: 'bearer-1',
    });
  });

  it('refuses an actor not holding gateway:approve as FORBIDDEN', async () => {
    await expect(gatewayRouter.createCaller(aContext(ARGO_COOKIE).context).parties.addA2aClient(ADDITION)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe("an approver adds an outside A2A agent by its card address through the gateway's API (slice 5)", () => {
  const ADDITION = { requestId: 'a-3', name: 'quotes', cardUrl: 'https://agent.supplier.example/.well-known/agent-card.json', credential: { kind: 'bearer' as const, token: 'tok-1' }, ownerShipId: OWNER, scopes: ['fleet:read'] };

  it('adds it as the actor, at 4 messages at once unless told, answering the party without its credential', async () => {
    const { context, agentAdditions } = aContext(undefined, APPROVER_CREW);

    await expect(gatewayRouter.createCaller(context).parties.addA2aAgent(ADDITION)).resolves.toEqual({
      name: 'quotes',
      kind: 'a2aAgent',
      cardUrl: 'https://agent.supplier.example/.well-known/agent-card.json',
      credentialKind: 'bearer',
      concurrencyLimit: 4,
      isRepeatable: true,
      state: 'crewed',
      proxyShipId: null,
    });
    expect(agentAdditions).toMatchObject([{ name: 'quotes', credential: { kind: 'bearer', token: 'tok-1' }, concurrencyLimit: 4, actor: { scopes: ['fleet:read', 'gateway:approve'] } }]);
  });

  it('takes an agent that asks for no credential, and a card read without TLS', async () => {
    await expect(gatewayRouter.createCaller(aContext(undefined, APPROVER_CREW).context).parties.addA2aAgent({ ...ADDITION, cardUrl: 'http://agent.internal:8080/.well-known/agent-card.json', credential: { kind: 'none' } })).resolves.toMatchObject({ credentialKind: 'none' });
  });

  it('refuses an actor not holding gateway:approve as FORBIDDEN', async () => {
    await expect(gatewayRouter.createCaller(aContext(ARGO_COOKIE).context).parties.addA2aAgent(ADDITION)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('answers a card that cannot be read as BAD_GATEWAY, and an invalid one as BAD_REQUEST, saying why', async () => {
    const caller = gatewayRouter.createCaller(aContext(undefined, APPROVER_CREW).context);

    await expect(caller.parties.addA2aAgent({ ...ADDITION, cardUrl: 'https://down.example/card.json' })).rejects.toMatchObject({ code: 'BAD_GATEWAY', message: 'The card of quotes could not be read: connection refused' });
    await expect(caller.parties.addA2aAgent({ ...ADDITION, cardUrl: 'https://broken.example/card.json' })).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'The card has no skill to state' });
  });

  it.each([
    ['a card address that is no http or https URL', { cardUrl: 'ftp://agent.supplier.example/card.json' }],
    ['more than 10 messages at once', { concurrencyLimit: 11 }],
  ])('refuses %s, adding nothing', async (_what, change) => {
    const { context, agentAdditions } = aContext(undefined, APPROVER_CREW);

    await expect(gatewayRouter.createCaller(context).parties.addA2aAgent({ ...ADDITION, ...change })).rejects.toBeInstanceOf(TRPCError);
    expect(agentAdditions).toEqual([]);
  });
});

describe("an approver marks an outside A2A agent not repeatable through the gateway's API (A9)", () => {
  it('marks it as the actor, answering the mark', async () => {
    const { context, agentMarks } = aContext(undefined, APPROVER_CREW);

    await expect(gatewayRouter.createCaller(context).parties.markA2aAgent({ name: 'quotes', isRepeatable: false })).resolves.toEqual({ isRepeatable: false, statementRefusal: null });
    expect(agentMarks).toMatchObject([{ name: 'quotes', isRepeatable: false }]);
  });

  it('answers FORBIDDEN to an actor without gateway:approve, and NOT_FOUND for an agent it does not know', async () => {
    await expect(gatewayRouter.createCaller(aContext(ARGO_COOKIE).context).parties.markA2aAgent({ name: 'quotes', isRepeatable: false })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(gatewayRouter.createCaller(aContext(undefined, APPROVER_CREW).context).parties.markA2aAgent({ name: 'ledger', isRepeatable: false })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe("an actor reads an A2A client's card addresses through the gateway's API (decision 0060)", () => {
  it('answers the card address of each ship its proxy ship reaches now', async () => {
    await expect(gatewayRouter.createCaller(aContext(VIEWER_COOKIE).context).parties.cardAddresses({ name: 'supplier' })).resolves.toEqual({
      addresses: ['https://gateway.example.com/gw/a2a/acrm2345/.well-known/agent-card.json'],
    });
  });

  it('refuses a party that is not a crewed A2A client', async () => {
    await expect(gatewayRouter.createCaller(aContext(VIEWER_COOKIE).context).parties.cardAddresses({ name: 'claude' })).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });
});

type MarkInput = Parameters<ReturnType<typeof gatewayRouter.createCaller>['parties']['markTool']>[0];

describe("argo states a party's tools and marks them repeatable through the gateway's API", () => {
  it("states a party's proxy ship, answering its capabilities", async () => {
    await expect(gatewayRouter.createCaller(aContext(ARGO_COOKIE).context).parties.state({ name: 'crm' })).resolves.toEqual({ capabilities: ['list_deals'] });
  });

  it('answers NOT_FOUND for a party it does not know', async () => {
    await expect(gatewayRouter.createCaller(aContext(ARGO_COOKIE).context).parties.state({ name: 'erp' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it("marks a tool for argo's fleet", async () => {
    const { context, marks } = aContext(ARGO_COOKIE);

    await gatewayRouter.createCaller(context).parties.markTool({ name: 'crm', tool: 'create_deal', isRepeatable: true });

    expect(marks).toEqual([{ fleetId: FLEET, name: 'crm', tool: 'create_deal', isRepeatable: true }]);
  });

  it('refuses a viewer a mark or a statement', async () => {
    const { context, marks } = aContext(VIEWER_COOKIE);
    const caller = gatewayRouter.createCaller(context);

    await expect(caller.parties.markTool({ name: 'crm', tool: 'create_deal', isRepeatable: true })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(caller.parties.state({ name: 'crm' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(marks).toEqual([]);
  });

  it.each([
    ['an empty tool name', ''],
    ['a tool name over 128 characters', 'x'.repeat(129)],
  ])('refuses %s', async (_what, tool) => {
    const { context, marks } = aContext(ARGO_COOKIE);

    await expect(gatewayRouter.createCaller(context).parties.markTool(z.custom<MarkInput>(() => true).parse({ name: 'crm', tool, isRepeatable: true }))).rejects.toBeInstanceOf(TRPCError);
    expect(marks).toEqual([]);
  });
});

describe("an approver switches an outside MCP server's tools through the gateway's API (aeolus-fleet#1151)", () => {
  it('switches the tools sent as the actor, answering the switch', async () => {
    const { context, toolSwitches } = aContext(undefined, APPROVER_CREW);

    await expect(gatewayRouter.createCaller(context).parties.switchTools({ name: 'crm', tools: ['create_deal', 'list_deals'], isOn: false })).resolves.toEqual({ tools: ['create_deal', 'list_deals'], isOn: false, statementRefusal: null });
    expect(toolSwitches.map(({ name, tools, isOn }) => ({ name, tools, isOn }))).toEqual([{ name: 'crm', tools: ['create_deal', 'list_deals'], isOn: false }]);
  });

  it('answers BAD_REQUEST for a switch naming no tool', async () => {
    await expect(gatewayRouter.createCaller(aContext(undefined, APPROVER_CREW).context).parties.switchTools({ name: 'crm', tools: [], isOn: true })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('answers FORBIDDEN to an actor without gateway:approve', async () => {
    await expect(gatewayRouter.createCaller(aContext(ARGO_COOKIE).context).parties.switchTools({ name: 'crm', tools: ['create_deal'], isOn: false })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('answers NOT_FOUND for a tool the server does not list now', async () => {
    await expect(gatewayRouter.createCaller(aContext(undefined, APPROVER_CREW).context).parties.switchTools({ name: 'crm', tools: ['delete_project'], isOn: true })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe("anyone reads, and an approver sets, the scopes an outside party needs through the gateway's API (gateway scopes 4.2)", () => {
  it('reads the requirements and their version, each tool by name', async () => {
    await expect(gatewayRouter.createCaller(aContext(ARGO_COOKIE).context).parties.scopeRequirements({ name: 'crm' })).resolves.toEqual({
      version: 2,
      party: ['crm:use'],
      tools: [{ tool: 'update_lead', scopes: ['crm:write-leads'] }],
    });
  });

  it('answers NOT_FOUND for a party with no requirements to read', async () => {
    await expect(gatewayRouter.createCaller(aContext(ARGO_COOKIE).context).parties.scopeRequirements({ name: 'claude' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('sets them as the actor on the version read, answering them changed', async () => {
    const { context, requirementChanges } = aContext(undefined, APPROVER_CREW);

    await expect(
      gatewayRouter.createCaller(context).parties.setScopeRequirements({ name: 'crm', version: 2, party: ['crm:read-leads'], tools: [{ tool: 'update_lead', scopes: ['crm:write-leads'] }, { tool: 'read_lead', scopes: [] }] }),
    ).resolves.toEqual({ version: 3, party: ['crm:read-leads'], tools: [{ tool: 'update_lead', scopes: ['crm:write-leads'] }, { tool: 'read_lead', scopes: [] }], statementRefusal: null });
    expect(requirementChanges.map(({ as, name, version, party, tools }) => ({ as, name, version, party, tools }))).toEqual([
      { as: { cookie: undefined, crewToken: APPROVER_CREW }, name: 'crm', version: 2, party: ['crm:read-leads'], tools: new Map([['update_lead', ['crm:write-leads']], ['read_lead', []]]) },
    ]);
  });

  it("leaves the party's set as it is when none is sent", async () => {
    const { context, requirementChanges } = aContext(undefined, APPROVER_CREW);

    await gatewayRouter.createCaller(context).parties.setScopeRequirements({ name: 'crm', version: 2, tools: [{ tool: 'update_lead', scopes: ['crm:write-leads'] }] });

    expect(requirementChanges[0]?.party).toBeUndefined();
  });

  it.each([
    { code: 'FORBIDDEN', what: 'an actor without gateway:approve', cookie: ARGO_COOKIE, crewToken: undefined, change: { version: 2, party: ['crm:use'] } },
    { code: 'CONFLICT', what: 'a change on requirements changed since', cookie: undefined, crewToken: APPROVER_CREW, change: { version: 1, party: ['crm:use'] } },
    { code: 'BAD_REQUEST', what: 'a scope the fleet does not list', cookie: undefined, crewToken: APPROVER_CREW, change: { version: 2, party: ['crm:admin'] } },
    { code: 'FORBIDDEN', what: "an approver outside the proxy ship's manage reach", cookie: undefined, crewToken: APPROVER_CREW, change: { name: 'erp', version: 2, party: ['crm:use'] } },
  ])('answers $code to $what', async ({ code, cookie, crewToken, change }) => {
    await expect(gatewayRouter.createCaller(aContext(cookie, crewToken).context).parties.setScopeRequirements({ name: 'crm', tools: [], ...change })).rejects.toMatchObject({ code });
  });
});

describe("an approver's page reads what it may change through the gateway's API (gateway scopes 4.3)", () => {
  it('answers every scope the fleet lists, with its description, to an approver', async () => {
    await expect(gatewayRouter.createCaller(aContext(undefined, APPROVER_CREW).context).parties.listedScopes()).resolves.toEqual({ scopes: [{ scope: 'crm:read-leads', description: 'Read leads in the CRM' }] });
  });

  it('answers FORBIDDEN to an actor without gateway:approve asking the listed scopes', async () => {
    await expect(gatewayRouter.createCaller(aContext(ARGO_COOKIE).context).parties.listedScopes()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('answers that an approver within manage reach approves the party', async () => {
    await expect(gatewayRouter.createCaller(aContext(undefined, APPROVER_CREW).context).parties.approving({ name: 'crm' })).resolves.toEqual({ isApproving: true, reason: null });
  });

  it.each([
    { what: 'an actor without gateway:approve', cookie: ARGO_COOKIE, crewToken: undefined, name: 'crm', reason: 'Setting the scopes an outside party needs takes gateway:approve' },
    { what: "an approver outside the proxy ship's manage reach", cookie: undefined, crewToken: APPROVER_CREW, name: 'erp', reason: 'erp is not within your manage reach' },
  ])('answers that $what does not approve the party, and why', async ({ cookie, crewToken, name, reason }) => {
    await expect(gatewayRouter.createCaller(aContext(cookie, crewToken).context).parties.approving({ name })).resolves.toEqual({ isApproving: false, reason });
  });

  it('answers NOT_FOUND for a name that is no outside MCP server or A2A agent', async () => {
    await expect(gatewayRouter.createCaller(aContext(undefined, APPROVER_CREW).context).parties.approving({ name: 'claude' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('argo pre-registers MCP clients through the gateway\'s API', () => {
  it("registers a client for argo's fleet, answering its secret once", async () => {
    await expect(gatewayRouter.createCaller(aContext(ARGO_COOKIE).context).oauth.registerClient({ name: 'Cursor', redirectUris: ['https://cursor.example.com/callback'], isConfidential: true })).resolves.toEqual({
      clientId: 'client-1',
      clientSecret: 's',
    });
  });

  it('refuses a viewer', async () => {
    await expect(gatewayRouter.createCaller(aContext(VIEWER_COOKIE).context).oauth.registerClient({ name: 'Cursor', redirectUris: ['https://cursor.example.com/callback'], isConfidential: true })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('answers BAD_REQUEST to redirect URIs it refuses', async () => {
    await expect(gatewayRouter.createCaller(aContext(ARGO_COOKIE).context).oauth.registerClient({ name: 'Cursor', redirectUris: [], isConfidential: true })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});

type DecideInput = Parameters<ReturnType<typeof gatewayRouter.createCaller>['requests']['decide']>[0];

describe("an approver adds a client party that signs in with client credentials through the gateway's API (vendor platforms V4)", () => {
  const ADDITION = { requestId: 'a-1', name: 'agentcore', ownerShipId: OWNER, scopes: ['fleet:read'] };

  it('adds it as the actor, and answers its client id and secret', async () => {
    const { context, additions } = aContext(undefined, APPROVER_CREW);

    await expect(gatewayRouter.createCaller(context).parties.addClient(ADDITION)).resolves.toEqual({
      party: { name: 'agentcore', kind: 'mcpClient', clientId: 'client-agentcore', state: 'crewed', proxyShipId: null },
      clientId: 'client-agentcore',
      clientSecret: 'client-secret',
    });
    expect(additions).toEqual([{ actor: { fleetId: FLEET, kind: 'ship', shipId: MANAGER, scopes: ['fleet:read', 'gateway:approve'] }, ...ADDITION }]);
  });

  it('answers FORBIDDEN to an actor without gateway:approve', async () => {
    await expect(gatewayRouter.createCaller(aContext(undefined, READER_CREW).context).parties.addClient(ADDITION)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('refuses a name that is no ship handle, adding nothing', async () => {
    const { context, additions } = aContext(undefined, APPROVER_CREW);

    await expect(gatewayRouter.createCaller(context).parties.addClient({ ...ADDITION, name: 'Agent Core' })).rejects.toBeInstanceOf(TRPCError);
    expect(additions).toEqual([]);
  });

  it("answers a client party crewed again with its new client secret, this once (V8)", async () => {
    await expect(gatewayRouter.createCaller(aContext(undefined, MANAGER_CREW).context).parties.crew({ name: 'agentcore', secret: 'aeolus_sk_v1_new' })).resolves.toEqual({
      name: 'agentcore',
      kind: 'mcpClient',
      clientId: 'client-agentcore',
      state: 'crewed',
      proxyShipId: null,
      clientSecret: 'new-client-secret',
    });
  });
});

describe("an approver decides pending requests through the gateway's API (decision 0056)", () => {
  it('lists the requests to decide, their times as ISO text', async () => {
    await expect(gatewayRouter.createCaller(aContext(undefined, APPROVER_CREW).context).requests.toDecide()).resolves.toEqual([
      { ...ORDERBOT_REQUEST, askedAt: '2026-10-20T09:00:00.000Z', expiresAt: '2026-10-27T09:00:00.000Z', decidedAt: null },
    ]);
  });

  it('answers FORBIDDEN to an actor without gateway:approve', async () => {
    await expect(gatewayRouter.createCaller(aContext(undefined, READER_CREW).context).requests.toDecide()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('decides as the actor, with the owner and scopes given', async () => {
    const { context, decisions } = aContext(undefined, APPROVER_CREW);
    const decision = { kind: 'approve' as const, party: { name: 'orderbot', ownerShipId: OWNER, scopes: ['fleet:read'] } };

    await gatewayRouter.createCaller(context).requests.decide({ requestId: REQUEST_ID, decision });

    expect(decisions).toEqual([{ actor: { fleetId: FLEET, kind: 'ship', shipId: MANAGER, scopes: ['fleet:read', 'gateway:approve'] }, requestId: REQUEST_ID, decision }]);
  });

  it('approves a server that asks for no credential (aeolus-fleet#1153)', async () => {
    const { context, decisions } = aContext(undefined, APPROVER_CREW);
    const decision = { kind: 'approve', party: { name: 'vault', ownerShipId: OWNER, scopes: [] }, server: { credential: { kind: 'none' }, concurrencyLimit: 4 } };

    await gatewayRouter.createCaller(context).requests.decide(z.custom<DecideInput>(() => true).parse({ requestId: REQUEST_ID, decision }));

    expect(decisions[0]?.decision).toEqual(decision);
  });

  it('answers CONFLICT to a request decided already', async () => {
    await expect(gatewayRouter.createCaller(aContext(undefined, APPROVER_CREW).context).requests.decide({ requestId: DECIDED, decision: { kind: 'deny' } })).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it.each([
    ['a decision it does not know', { requestId: REQUEST_ID, decision: { kind: 'hold' } }],
    ['an owner that is no ship id', { requestId: REQUEST_ID, decision: { kind: 'approve', party: { name: 'orderbot', ownerShipId: 'charlotte', scopes: [] } } }],
    ['a name that is no ship handle', { requestId: REQUEST_ID, decision: { kind: 'approve', party: { name: 'Order Bot', ownerShipId: OWNER, scopes: [] } } }],
  ])('refuses %s, deciding nothing', async (_what, input) => {
    const { context, decisions } = aContext(undefined, APPROVER_CREW);

    await expect(gatewayRouter.createCaller(context).requests.decide(z.custom<DecideInput>(() => true).parse(input))).rejects.toBeInstanceOf(TRPCError);
    expect(decisions).toEqual([]);
  });
});

describe("outside parties are switched per fleet through the gateway's API (interop I-3)", () => {
  it('reads whether they are on', async () => {
    await expect(gatewayRouter.createCaller(aContext(VIEWER_COOKIE).context).outsideParties.status()).resolves.toEqual({ isOn: false });
  });

  it("switches them as the actor, with the actor's own credential to read the network", async () => {
    const { context, switched } = aContext(undefined, MANAGER_CREW);

    await gatewayRouter.createCaller(context).outsideParties.set({ isOn: true, isOpenNetworkConfirmed: true });

    expect(switched).toEqual([{ actor: { fleetId: FLEET, kind: 'ship', shipId: MANAGER, scopes: ['fleet:read', 'fleet:manage'] }, as: { cookie: undefined, crewToken: MANAGER_CREW }, isOn: true, isOpenNetworkConfirmed: true }]);
  });

  it('answers PRECONDITION_FAILED with the warning for an open network, until it is confirmed', async () => {
    await expect(gatewayRouter.createCaller(aContext(ARGO_COOKIE).context).outsideParties.set({ isOn: true, isOpenNetworkConfirmed: false })).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'This fleet applies no network rules',
    });
  });
});

describe("a person reads and deals with their person ship's deliveries through the gateway's API, signed in to its pages", () => {
  it('reads what waits, by titles only', async () => {
    const { context } = aContext(PERSON_COOKIE);

    await expect(gatewayRouter.createCaller(context).people.inbox()).resolves.toEqual({
      waiting: 1,
      deliveries: [{ deliveryId: DELIVERY, from: 'prd-writer', title: 'Publish the PRD draft to Linear?', sentAt: '2026-10-20T09:00:00.000Z' }],
      opened: [],
    });
  });

  it('opens one, whole', async () => {
    const { context } = aContext(PERSON_COOKIE);

    await expect(gatewayRouter.createCaller(context).people.open({ deliveryId: DELIVERY })).resolves.toMatchObject({ contentType: 'text/plain', payload: 'Publish it?', meetingId: null });
  });

  it('answers one it opened, and is done with another, as its own account', async () => {
    const { context, answers } = aContext(PERSON_COOKIE);
    const caller = gatewayRouter.createCaller(context);

    await caller.people.answer({ deliveryId: DELIVERY, contentType: 'text/plain', payload: 'Yes' });
    await caller.people.done({ deliveryId: DELIVERY });

    expect(answers).toEqual([
      { grantId: PERSON_TOKEN, deliveryId: DELIVERY, contentType: 'text/plain', payload: 'Yes' },
      { grantId: PERSON_TOKEN, deliveryId: DELIVERY },
    ]);
  });

  it('says a delivery that no longer waits is not found', async () => {
    const { context } = aContext(PERSON_COOKIE);

    await expect(gatewayRouter.createCaller(context).people.open({ deliveryId: 'dlv_gone' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('asks a person whose sign-in ended to sign in again', async () => {
    const { context } = aContext(SIGNED_OUT_COOKIE);

    await expect(gatewayRouter.createCaller(context).people.inbox()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it("reads, opens and answers as the account their shared sign-in names in the page's fleet (header design H5)", async () => {
    const { context, answers } = aContext(undefined);
    const caller = gatewayRouter.createCaller({ ...context, signIn: CHARLOTTE_SIGN_IN, fleetInView: FLEET });

    await expect(caller.people.inbox()).resolves.toMatchObject({ waiting: 1 });
    await expect(caller.people.open({ deliveryId: DELIVERY })).resolves.toMatchObject({ payload: 'Publish it?' });
    await caller.people.done({ deliveryId: DELIVERY });
    expect(answers).toEqual([{ grantId: SHARED_ACCOUNT_TOKEN, deliveryId: DELIVERY }]);
  });

  it("refuses an account by its console session in a sentence: its person ship's deliveries open on the gateway's pages", async () => {
    const { context } = aContext(ACCOUNT_CONSOLE_COOKIE);

    await expect(gatewayRouter.createCaller(context).people.inbox()).rejects.toMatchObject({ code: 'FORBIDDEN', message: "Open the gateway's pages, signed in with your account, to read your person ship's deliveries" });
  });

  it('refuses any other actor: only a person has a person ship', async () => {
    const { context } = aContext(ARGO_COOKIE);

    await expect(gatewayRouter.createCaller(context).people.inbox()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('a person turns on the channels that wake them, through the API (wake a person, W8)', () => {
  const FIREFOX = { endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/firefox-1', keys: { p256dh: `B${'A'.repeat(86)}`, auth: 'A'.repeat(22) }, browser: 'Firefox on Linux' };

  it('turns email on as its own account, and reads it on', async () => {
    const { context, answers } = aContext(PERSON_COOKIE);
    const caller = gatewayRouter.createCaller(context);

    await caller.people.turnEmail({ isOn: true });

    await expect(caller.people.wakeChannels()).resolves.toEqual({ email: { isOffered: true, isOn: true }, webPush: { publicKey: WEB_PUSH_KEY, browsers: [] } });
    expect(answers).toEqual([{ grantId: PERSON_TOKEN, email: 'on' }]);
  });

  it('turns web push on for a browser, with the fleet name their shared sign-in states, and reads it with when it was turned on', async () => {
    const { context, answers } = aContext(undefined);
    const signIns = fakeSharedSignIn({});
    const caller = gatewayRouter.createCaller({ ...context, signIn: CHARLOTTE_SIGN_IN, fleetInView: FLEET, accountApps: (signIn) => signIns.apps(signIn) });

    await caller.people.turnOnWebPush(FIREFOX);

    expect(answers).toEqual([{ grantId: SHARED_ACCOUNT_TOKEN, webPushOn: FIREFOX.endpoint, browser: 'Firefox on Linux', fleetName: 'Acme' }]);
    await expect(caller.people.wakeChannels()).resolves.toMatchObject({ webPush: { publicKey: WEB_PUSH_KEY, browsers: [{ endpoint: FIREFOX.endpoint, browser: 'Firefox on Linux', addedAt: '2026-10-23T10:00:00.000Z', isGone: false }] } });
  });

  it('refuses a subscription the push service could not have given, saying why', async () => {
    const { context } = aContext(undefined);
    const signIns = fakeSharedSignIn({});
    const caller = gatewayRouter.createCaller({ ...context, signIn: CHARLOTTE_SIGN_IN, fleetInView: FLEET, accountApps: (signIn) => signIns.apps(signIn) });

    await expect(caller.people.turnOnWebPush({ ...FIREFOX, endpoint: 'http://push.example/firefox' })).rejects.toMatchObject({ code: 'BAD_REQUEST', message: "The push service's endpoint must be an https URL of at most 2048 characters" });
  });

  it('says pagasae did not answer, turning nothing on, as it names the fleet', async () => {
    const { context, answers } = aContext(undefined);
    const caller = gatewayRouter.createCaller({ ...context, signIn: CHARLOTTE_SIGN_IN, fleetInView: FLEET, accountApps: (signIn) => fakeSharedSignIn({ isAvailable: false }).apps(signIn) });

    await expect(caller.people.turnOnWebPush(FIREFOX)).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    expect(answers).toEqual([]);
  });

  it('removes a browser as its own account', async () => {
    const { context, answers } = aContext(PERSON_COOKIE);

    await gatewayRouter.createCaller(context).people.turnOffWebPush({ endpoint: FIREFOX.endpoint });

    expect(answers).toEqual([{ grantId: PERSON_TOKEN, webPushOff: FIREFOX.endpoint }]);
  });

  it('refuses any other actor: only a person is woken', async () => {
    const { context } = aContext(ARGO_COOKIE);

    await expect(gatewayRouter.createCaller(context).people.turnEmail({ isOn: true })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe("a person takes part in a meeting through the gateway's API, signed in to its pages (decision 0061, M19)", () => {
  it('reads a meeting with its times in ISO 8601, and where they stand on its mic', async () => {
    const { context } = aContext(PERSON_COOKIE);

    await expect(gatewayRouter.createCaller(context).people.meeting({ meetingId: HEADS_MEETING_ID })).resolves.toMatchObject({
      meetingId: HEADS_MEETING_ID,
      openedAt: '2026-10-24T09:00:00.000Z',
      endedAt: null,
      contributions: { items: [{ payload: 'Round robin: marketing first', sentAt: '2026-10-24T09:01:00.000Z' }], nextCursor: null },
      yourMic: { kind: 'requested', place: 1 },
    });
  });

  it('says a meeting they take no part in is not found', async () => {
    const { context } = aContext(PERSON_COOKIE);

    await expect(gatewayRouter.createCaller(context).people.meeting({ meetingId: 'mtg_01m5qa5j85mgd4z61d9c2k4zzz' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('contributes to a meeting as their own account, once under the key the page gives', async () => {
    const { context, answers } = aContext(PERSON_COOKIE);

    await gatewayRouter.createCaller(context).people.contribute({ meetingId: HEADS_MEETING_ID, payload: 'Marketing is on track', idempotencyKey: 'page-1' });

    expect(answers).toEqual([{ grantId: PERSON_TOKEN, to: JSON.stringify({ kind: 'meeting', meetingId: HEADS_MEETING_ID }), contentType: 'text/plain', payload: 'Marketing is on track', idempotencyKey: 'page-1' }]);
  });

  it('requests the mic as their own account', async () => {
    const { context, answers } = aContext(PERSON_COOKIE);

    await gatewayRouter.createCaller(context).people.mic({ meetingId: HEADS_MEETING_ID, change: 'request' });

    expect(answers).toEqual([{ grantId: PERSON_TOKEN, meetingId: HEADS_MEETING_ID, change: 'request' }]);
  });

  it("says why the fleet refused a mic call, in the fleet's words", async () => {
    const { context } = aContext(PERSON_COOKIE);

    await expect(gatewayRouter.createCaller(context).people.mic({ meetingId: HEADS_MEETING_ID, change: 'release' })).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'The fleet did not change the mic: You do not hold the mic',
    });
  });
});

describe("the web app's authorize pages read the request they show through the API, as anyone", () => {
  it('reads the client an authorization request is for, to show its picks', async () => {
    await expect(gatewayRouter.createCaller(aContext(undefined).context).oauth.authorization({ client_id: CURSOR_CLIENT, state: 'state-1' })).resolves.toEqual({
      clientId: CURSOR_CLIENT,
      clientName: 'Cursor',
      redirectUri: 'http://127.0.0.1:7777/callback',
    });
  });

  it('refuses a request the gateway would not serve, saying why', async () => {
    await expect(gatewayRouter.createCaller(aContext(undefined).context).oauth.authorization({ client_id: 'client-unknown' })).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'No client client-unknown is known' });
  });

  it('reads a waiting client by the secret its browser holds, sent beside the call, with the time it is kept', async () => {
    const context = { ...aContext(undefined).context, waitingSecret: 'secret-1' };

    await expect(gatewayRouter.createCaller(context).oauth.waiting({ waiting: 'waiting-1' })).resolves.toEqual({ kind: 'waiting', clientName: 'Cursor', expiresAt: '2026-10-28T09:00:00.000Z' });
  });

  it('tells the page to go on, to the door that says why, when the client no longer waits or the browser is another', async () => {
    const decided = gatewayRouter.createCaller({ ...aContext(undefined).context, waitingSecret: 'secret-1' });
    const other = gatewayRouter.createCaller({ ...aContext(undefined).context, waitingSecret: 'other' });
    const none = gatewayRouter.createCaller(aContext(undefined).context);

    await expect(Promise.all([decided.oauth.waiting({ waiting: 'waiting-2' }), other.oauth.waiting({ waiting: 'waiting-1' }), none.oauth.waiting({ waiting: 'waiting-1' })])).resolves.toEqual([{ kind: 'goOn' }, { kind: 'goOn' }, { kind: 'goOn' }]);
  });

  it("refuses the browser's secret in the call's input, which would travel in the address", async () => {
    const caller = gatewayRouter.createCaller(aContext(undefined).context);
    const sent = { waiting: 'waiting-1', browserSecret: 'secret-1' };

    await expect(caller.oauth.waiting(sent)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});

describe("a page follows its fleet's request changes through the gateway's API, to read itself again", () => {
  it('hears each change to its own fleet, and none of another fleet', async () => {
    const { context, changes } = aContext(PERSON_COOKIE);
    const stop = new AbortController();
    const followed = await gatewayRouter.createCaller(context, { signal: stop.signal }).requests.changes();
    const heard = followed[Symbol.asyncIterator]();
    const next = heard.next();
    await expect.poll(() => changes.listeners()).toBe(1);

    changes.publish({ fleetId: OTHER_FLEET_ID, topic: 'requests' });
    changes.publish({ fleetId: FLEET, topic: 'requests' });

    await expect(next).resolves.toEqual({ done: false, value: { fleetId: FLEET } });
    stop.abort();
  });

  it("hears each change to its person's inbox, and none to another person's (wake a person, #1014)", async () => {
    const { context, changes } = aContext(PERSON_COOKIE);
    const stop = new AbortController();
    const heard = (await gatewayRouter.createCaller(context, { signal: stop.signal }).requests.changes())[Symbol.asyncIterator]();
    const next = heard.next();
    await expect.poll(() => changes.listeners()).toBe(1);
    const other = { isHeard: false };
    void next.then(() => {
      other.isHeard = true;
    });

    changes.publish({ fleetId: FLEET, topic: 'inbox', shipId: 'shp_01m3tbfspe96yf1rnr4ank9dk1' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const isHeardOfAnother = other.isHeard;
    changes.publish({ fleetId: FLEET, topic: 'inbox', shipId: OWNER });

    await expect(next).resolves.toEqual({ done: false, value: { fleetId: FLEET } });
    expect(isHeardOfAnother).toBe(false);
    stop.abort();
  });

  it('stops following once the page goes', async () => {
    const { context, changes } = aContext(PERSON_COOKIE);
    const stop = new AbortController();
    const heard = (await gatewayRouter.createCaller(context, { signal: stop.signal }).requests.changes())[Symbol.asyncIterator]();
    const next = heard.next();
    await expect.poll(() => changes.listeners()).toBe(1);

    stop.abort();

    await expect(next).resolves.toMatchObject({ done: true });
    expect(changes.listeners()).toBe(0);
  });
});

describe("a person lists the requests they asked through the gateway's API (decision 0056: Your requests)", () => {
  it('answers them as the API answers To decide, its times as ISO text', async () => {
    const { context } = aContext(PERSON_COOKIE);

    await expect(gatewayRouter.createCaller(context).requests.mine()).resolves.toEqual([
      {
        ...ORDERBOT_REQUEST,
        state: 'denied',
        askedAt: '2026-10-20T09:00:00.000Z',
        expiresAt: '2026-10-27T09:00:00.000Z',
        decidedBy: { kind: 'account', accountId: 'acc-pieter' },
        decidedAt: '2026-10-21T09:00:00.000Z',
      },
    ]);
  });

  it('refuses any other actor: only an account asks', async () => {
    const { context } = aContext(ARGO_COOKIE);

    await expect(gatewayRouter.createCaller(context).requests.mine()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe("the web app's page asks which account it shows the fleet in its address as (H5)", () => {
  const signIns = fakeSharedSignIn({ tokens: new Map([[FLEET, { ...CHARLOTTE_ACCOUNT_TOKEN, endsAt: new Date('2099-01-01T00:00:00.000Z') }]]) });
  const isServed = () => Promise.resolve(true);
  const accountInView = createAccountInView({ signIns, accountOf: createAccountOfSignIn({ signIns, clock: { now: () => new Date('2026-10-21T09:00:00.000Z') } }), isServed });

  function asked(sent: { signIn?: string; fleetInView?: FleetId }, inView: { accountInView: Context['accountInView'] } = { accountInView }) {
    return gatewayRouter.createCaller({ ...aContext(undefined).context, ...sent, ...inView }).account.inView();
  }

  it('answers the account, its fleet and its scopes, never its token', async () => {
    await expect(asked({ signIn: CHARLOTTE_SIGN_IN, fleetInView: FLEET })).resolves.toEqual({ kind: 'signedIn', fleetId: FLEET, accountId: 'acc-charlotte', scopes: ['fleet:read', 'gateway:approve'] });
  });

  it('answers the fleet to go to when the page names none', async () => {
    await expect(asked({ signIn: CHARLOTTE_SIGN_IN })).resolves.toEqual({ kind: 'goTo', fleetId: OTHER_FLEET_ID });
  });

  it('answers the app to go to where the account may not open the gateway (H9)', async () => {
    await expect(asked({ signIn: CHARLOTTE_SIGN_IN, fleetInView: OTHER_FLEET_ID })).resolves.toEqual({ kind: 'elsewhere', url: CONSOLE_URL });
  });

  it('answers that the gateway is off for the fleet of an account that may open it in none, and where its account is', async () => {
    const noGateway = fakeSharedSignIn({ apps: { account: CHARLOTTE, apps: [{ app: 'account', url: ACCOUNT_URL }], fleets: [{ fleetId: FLEET, name: 'Acme', apps: [] }] } });
    const off = createAccountInView({ signIns: noGateway, accountOf: createAccountOfSignIn({ signIns: noGateway, clock: { now: () => new Date() } }), isServed: () => Promise.resolve(false) });

    await expect(asked({ signIn: CHARLOTTE_SIGN_IN }, { accountInView: off })).resolves.toEqual({ kind: 'off', fleetName: 'Acme', accountUrl: ACCOUNT_URL });
  });

  it('refuses a browser with no shared sign-in, so the page signs it in', async () => {
    await expect(asked({ fleetInView: FLEET })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('says pagasae did not answer', async () => {
    const down = fakeSharedSignIn({ isAvailable: false });

    await expect(asked({ signIn: CHARLOTTE_SIGN_IN, fleetInView: FLEET }, { accountInView: createAccountInView({ signIns: down, accountOf: createAccountOfSignIn({ signIns: down, clock: { now: () => new Date() } }), isServed }) })).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });

  it('refuses where the gateway signs no one in to its pages', async () => {
    await expect(asked({ signIn: CHARLOTTE_SIGN_IN, fleetInView: FLEET }, { accountInView: undefined })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe("the web app's header asks which apps and fleets the account may open (H1)", () => {
  const signIns = fakeSharedSignIn({});

  function asked(sent: { signIn?: string }, apps: { accountApps: Context['accountApps'] } = { accountApps: (signIn) => signIns.apps(signIn) }) {
    return gatewayRouter.createCaller({ ...aContext(undefined).context, ...sent, ...apps }).account.apps();
  }

  it('answers the account, its apps, and each fleet with its name and apps', async () => {
    await expect(asked({ signIn: CHARLOTTE_SIGN_IN })).resolves.toEqual({
      account: { id: 'acc-charlotte', email: 'charlotte@example.com' },
      apps: [{ app: 'account', url: ACCOUNT_URL }],
      fleets: [
        { id: FLEET_ID, name: 'Acme', apps: [{ app: 'console', url: CONSOLE_URL }] },
        { id: OTHER_FLEET_ID, name: 'Labs', apps: [{ app: 'console', url: CONSOLE_URL }, { app: 'gateway', url: GATEWAY_URL }] },
      ],
    });
  });

  it('refuses a browser with no shared sign-in', async () => {
    await expect(asked({})).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('says pagasae did not answer', async () => {
    await expect(asked({ signIn: CHARLOTTE_SIGN_IN }, { accountApps: (signIn) => fakeSharedSignIn({ isAvailable: false }).apps(signIn) })).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });

  it('refuses where the gateway signs no one in to its pages', async () => {
    await expect(asked({ signIn: CHARLOTTE_SIGN_IN }, { accountApps: undefined })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('a call whose input is wrong is told so in a sentence', () => {
  it('names the fields that are missing or wrong, never the raw validation', async () => {
    const input = encodeURIComponent(JSON.stringify({ client_id: 1 }));
    const answer = await fetchRequestHandler({
      endpoint: '/trpc',
      req: new Request(`http://gateway.test/trpc/oauth.authorization?input=${input}`),
      router: gatewayRouter,
      createContext: () => aContext(undefined).context,
    });

    const body: unknown = await answer.json();

    expect(body).toMatchObject({ error: { message: 'Check what you filled in: client_id is missing or wrong.' } });
  });
});

describe("a person's page tells the gateway's API while it is in focus (wake a person, W6)", () => {
  it('counts in focus for their person ship while it follows, and no longer once it stops', async () => {
    const { context, focused } = aContext(PERSON_COOKIE);
    const stop = new AbortController();
    const following = await gatewayRouter.createCaller(context, { signal: stop.signal }).people.focus();
    const iterator = following[Symbol.asyncIterator]();

    await iterator.next();
    const isInFocus = await focused.isAnyInFocus({ fleetId: FLEET, shipId: OWNER }, FOCUSED_AT);
    stop.abort();
    await iterator.return?.();

    expect({ isInFocus, held: focused.held }).toEqual({ isInFocus: true, held: [] });
  });

  it('refuses any other actor: only a person has a person ship', async () => {
    await expect(gatewayRouter.createCaller(aContext(ARGO_COOKIE).context).people.focus()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe("an actor holding gateway:slack connects the fleet's Slack through the API (gateway scopes 9.1)", () => {
  /** Charlotte on the gateway's pages, holding the scopes given. */
  function asCharlotte(scopes: string[]) {
    const made = aContext(undefined);
    const signIns = fakeSharedSignIn({});
    const context: Context = {
      ...made.context,
      signIn: CHARLOTTE_SIGN_IN,
      fleetInView: FLEET,
      accountApps: (signIn) => signIns.apps(signIn),
      authenticateActor: () => Promise.resolve(ok({ fleetId: FLEET, kind: 'account' as const, accountId: 'acc-charlotte', personShipId: OWNER, accountToken: SHARED_ACCOUNT_TOKEN, scopes })),
    };
    return { caller: gatewayRouter.createCaller(context), slack: made.slack };
  }

  it("connects with the configuration token, making the gateway's bot named after the fleet as the shared sign-in states it", async () => {
    const { caller, slack } = asCharlotte(['fleet:read', 'gateway:slack']);

    await expect(caller.slack.connect({ refreshToken: 'xoxe-1-first' })).resolves.toEqual({ isGatewayBotMade: true });
    expect(slack.tooling.state.made.map(({ description }) => description.name)).toEqual(['Acme']);
    await expect(caller.slack.view()).resolves.toEqual({
      state: 'connected',
      workspace: { teamId: 'T0ACME', name: null },
      connectedBy: 'charlotte',
      connectedAt: SLACK_NOW.toISOString(),
      tokenState: 'fresh',
      gatewayBot: 'made',
      bots: [],
      canChange: true,
    });
  });

  it("exposes a ship from the ships offered, shows its bot, opens its install, and removes it", async () => {
    const { caller, slack } = asCharlotte(['gateway:slack']);
    await caller.slack.connect({ refreshToken: 'xoxe-1-first' });

    await expect(caller.slack.exposable()).resolves.toEqual([{ shipId: SLACK_SHIP, name: 'release-notes' }]);
    await expect(caller.slack.expose({ shipId: SLACK_SHIP })).resolves.toEqual({ appId: 'A02' });
    const installing = await caller.slack.install({ appId: 'A02' });
    await expect(caller.slack.view()).resolves.toMatchObject({ bots: [{ appId: 'A02', shipId: SLACK_SHIP, shipName: 'release-notes', botName: 'release-notes', state: 'waitingForInstall' }] });
    await caller.slack.remove({ appId: 'A02' });

    expect({ isShipBot: installing.url.includes('client_id=client-A02'), removed: slack.tooling.state.removed.map(({ appId }) => appId) }).toEqual({ isShipBot: true, removed: ['A02'] });
  });

  it('says a bot the gateway did not make is not found', async () => {
    const { caller } = asCharlotte(['gateway:slack']);
    await caller.slack.connect({ refreshToken: 'xoxe-1-first' });

    await expect(caller.slack.remove({ appId: 'A99' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('says Slack refused the configuration token as a bad request', async () => {
    const { caller } = asCharlotte(['gateway:slack']);

    await expect(caller.slack.connect({ refreshToken: 'xoxe-1-expired' })).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'Slack refused the configuration token (invalid_refresh_token): copy a new one from your Slack app management page' });
  });

  it('refuses an actor without gateway:slack, showing it the page read-only', async () => {
    const { caller } = asCharlotte(['fleet:read']);

    await expect(caller.slack.connect({ refreshToken: 'xoxe-1-first' })).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'Connecting Slack needs gateway:slack' });
    await expect(caller.slack.view()).resolves.toEqual({ state: 'notConnected', canChange: false });
  });

  it("answers Slack's install address for the gateway's bot, then disconnects, removing it in Slack", async () => {
    const { caller, slack } = asCharlotte(['gateway:slack']);
    await caller.slack.connect({ refreshToken: 'xoxe-1-first' });

    const installing = await caller.slack.install({});
    await caller.slack.disconnect();

    expect({ isSlackAddress: installing.url.startsWith('https://slack.com/oauth/v2/authorize?client_id=client-A01&state='), removed: slack.tooling.state.removed.map(({ appId }) => appId) }).toEqual({ isSlackAddress: true, removed: ['A01'] });
    await expect(caller.slack.view()).resolves.toEqual({ state: 'notConnected', canChange: true });
  });

  it('refuses Install while the fleet is connected to no workspace', async () => {
    await expect(asCharlotte(['gateway:slack']).caller.slack.install({})).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

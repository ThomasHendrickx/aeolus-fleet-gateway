/**
 * The gateway's API: one tRPC router, which the console's server and the
 * gateway's page call with the console's session cookie, as the other
 * plugins' (decision 0043), and any ship with its own crew token (decision
 * 0057). Every procedure but the installation's is an actor's: argo or a
 * viewer by a console session of a fleet at the fleet's URL, or a ship of a
 * fleet the gateway is connected to, and the procedure works on that fleet.
 * What it may call is the scopes the fleet holds for it. A fleet the gateway
 * does not serve (switched off) gets only `connection.status`. The
 * installation procedures take the installation token instead (decision 0021).
 */
import { randomUUID, timingSafeEqual } from 'node:crypto';

import { idempotencyKeySchema, idSchema, payloadSchema, scopeNameSchema, shipHandleSchema, type FleetId } from '@aeolus-fleet/common';
import { initTRPC, TRPCError } from '@trpc/server';
import { z } from 'zod';

import type { ChangeHub } from '../http/live.js';
import type { AccountInView } from '../../core/account-sign-in/account-in-view.js';
import type { SharedSignIn } from '../../core/account-sign-in/ports.js';
import type { Connect } from '../../core/connection/connect.js';
import type { ReadConnection } from '../../core/connection/read-connection.js';
import type { DeleteFleet } from '../../core/installation/delete-fleet.js';
import type { InstallationMode } from '../../core/installation/ports.js';
import type { ReadFleet } from '../../core/installation/read-fleet.js';
import type { IsServed } from '../../core/installation/served.js';
import type { SetFleetEnabled } from '../../core/installation/set-fleet-enabled.js';
import type { AccountActor, AuthenticateActor } from '../../core/actors/authenticate-actor.js';
import type { ReadOutsideParties, SetOutsideParties } from '../../core/outside-parties/set-outside-parties.js';
import type { AddClientParty, AddClientPartyRefusal } from '../../core/parties/add-client-party.js';
import type { ListReachedShips, ListReachedShipsRefusal } from '../../core/a2a-in/list-reached-ships.js';
import type { AddA2aClient, AddA2aClientRefusal } from '../../core/parties/add-a2a-client.js';
import type { AddA2aAgent, AddA2aAgentRefusal } from '../../core/parties/add-a2a-agent.js';
import type { MarkA2aAgent, MarkA2aAgentRefusal } from '../../core/a2a-out/mark-a2a-agent.js';
import type { AddSignInServer, AddSignInServerRefusal } from '../../core/parties/add-sign-in-server.js';
import type { ApprovedSignInPartyRefusal } from '../../core/party-grants/approved-sign-in-party.js';
import type { EndAccountGrants } from '../../core/party-grants/end-account-grants.js';
import type { ListGrants } from '../../core/party-grants/list-grants.js';
import type { ReadOwnGrant } from '../../core/party-grants/read-own-grant.js';
import type { RemoveGrant } from '../../core/party-grants/remove-grant.js';
import type { RemoveOwnGrant } from '../../core/party-grants/remove-own-grant.js';
import type { StartPartySignIn } from '../../core/party-grants/start-party-sign-in.js';
import type { ApproveParty } from '../../core/parties/approve-party.js';
import type { CrewParty } from '../../core/parties/crew-party.js';
import type { ListOwnerChoices } from '../../core/parties/list-owner-choices.js';
import type { ListParties, ReadParty } from '../../core/parties/list-parties.js';
import type { RetireParty, RetirePartyRefusal } from '../../core/parties/retire-party.js';
import type { ChangePartyOwner, ChangePartyRefusal, ChangePartyScopes } from '../../core/parties/change-party.js';
import type { MarkTool } from '../../core/mcp-out/mark-tool.js';
import type { StateParty } from '../../core/mcp-out/state-party.js';
import type { CheckServer } from '../../core/parties/check-server.js';
import type { ReadPartyTools } from '../../core/parties/read-party-tools.js';
import { APPROVING_SCOPE } from '../../core/parties/approver.js';
import type { SwitchTools, SwitchToolsRefusal } from '../../core/parties/switch-tools.js';
import type { CheckApproving } from '../../core/parties/check-approving.js';
import type { ReadListedScopes } from '../../core/parties/read-listed-scopes.js';
import type { ReadScopeRequirements } from '../../core/parties/read-scope-requirements.js';
import type { ScopeRequirements } from '../../core/parties/scope-requirements.js';
import type { SetScopeRequirements, SetScopeRequirementsRefusal } from '../../core/parties/set-scope-requirements.js';
import type { RegisterClient } from '../../core/oauth/register-client.js';
import type { DecideRequest, DecideRefusal } from '../../core/requests/decide-request.js';
import type { ListMine } from '../../core/requests/list-mine.js';
import type { ListToDecide } from '../../core/requests/list-to-decide.js';
import type { EndSignIns } from '../../core/sign-in/end-sign-ins.js';
import type { PendingRequest } from '../../core/requests/ports.js';
import type { AnswerDelivery } from '../../core/people/answer-delivery.js';
import type { DoneDelivery } from '../../core/people/done-delivery.js';
import type { OpenDelivery } from '../../core/people/open-delivery.js';
import type { ChangeOwnMic } from '../../core/meetings/change-own-mic.js';
import type { MeetingRead } from '../../core/meetings/ports.js';
import type { PersonMeeting, ReadMeeting } from '../../core/meetings/read-meeting.js';
import type { PersonCaller } from '../../core/people/person-crew.js';
import type { SendMessage } from '../../core/people/send-message.js';
import type { ReadInbox } from '../../core/people/read-inbox.js';
import type { ReadWakeChannels } from '../../core/people/read-wake-channels.js';
import type { FocusPage } from '../../core/people/focus-page.js';
import type { TurnOffWebPush } from '../../core/people/turn-off-web-push.js';
import type { TurnOnWebPush } from '../../core/people/turn-on-web-push.js';
import type { PersonShip } from '../../core/people/ports.js';
import type { TurnEmailChannel } from '../../core/people/turn-email-channel.js';
import type { ReadAuthorization } from '../../core/oauth/read-authorization.js';
import type { WatchWaiting } from '../../core/requests/watch-waiting.js';
import type { Result } from '../../core/shared/result.js';
import { SLACK_SCOPE, type ConnectSlack } from '../../core/slack/connect-slack.js';
import type { DisconnectSlack } from '../../core/slack/disconnect-slack.js';
import type { ExposeShip } from '../../core/slack/expose-ship.js';
import type { ListExposable } from '../../core/slack/list-exposable.js';
import type { RemoveBot } from '../../core/slack/remove-bot.js';
import type { ReadSlack } from '../../core/slack/read-slack.js';
import type { ReadSlackLink } from '../../core/slack/read-slack-link.js';
import type { ShowAllInSlack } from '../../core/slack/show-all-in-slack.js';
import type { StartLink } from '../../core/slack/start-link.js';
import type { StopSlackLink } from '../../core/slack/stop-slack-link.js';
import type { UnlinkSlack } from '../../core/slack/unlink-slack.js';
import type { StartInstall } from '../../core/slack/start-install.js';

/** The header the web app's waiting page sends its browser's secret in (web/lib/gateway-api/gateway-api.ts names the same). */
export const WAITING_SECRET_HEADER = 'aeolus-waiting-secret';

export interface Context {
  /** The Cookie header the console's server or the gateway's page forwarded. */
  cookie: string | undefined;
  /** The crew token a ship sent as its bearer token, if any. */
  crewToken: string | undefined;
  /** The shared account sign-in the web app's server forwarded in pagasae's cookie, if any (header design H5). */
  signIn?: string | undefined;
  /** The fleet the web app's page shows, which it names in the aeolus-fleet header, if any. */
  fleetInView?: FleetId | undefined;
  /** The account a page of the web app shows its fleet as; unset where the gateway is no app at pagasae. */
  accountInView?: AccountInView | undefined;
  /** The apps and fleets the account may open, as pagasae answers them; unset where the gateway is no app at pagasae. */
  accountApps?: SharedSignIn['apps'] | undefined;
  authenticateActor: AuthenticateActor;
  /** Each committed change to a fleet's requests, as the live pages hear it. */
  changes?: Pick<ChangeHub, 'subscribe'>;
  isServed: IsServed;
  /** The fleet's connection as the gateway holds it, without asking the fleet: what a fleet that is off reads. */
  heldConnection: ReadConnection;
  /** The installation token header the caller sent, if any. */
  installationTokenSent: string | undefined;
  installation: { mode: InstallationMode; token: string | undefined };
  setFleetEnabled: SetFleetEnabled;
  readFleet: ReadFleet;
  deleteFleet: DeleteFleet;
  endSignIns: EndSignIns;
  endAccountGrants: EndAccountGrants;
  stopSlackLink: StopSlackLink;
  readConnection: ReadConnection;
  connect: Connect;
  approveParty: ApproveParty;
  addSignInServer: AddSignInServer;
  /** A person's own sign-in to an outside MCP server where each person signs in (decision 0067). */
  partySignIn: { start: StartPartySignIn; readOwn: ReadOwnGrant; removeOwn: RemoveOwnGrant; list: ListGrants; remove: RemoveGrant };
  addClientParty: AddClientParty;
  crewParty: CrewParty;
  listParties: ListParties;
  listOwnerChoices: ListOwnerChoices;
  retireParty: RetireParty;
  changePartyOwner: ChangePartyOwner;
  changePartyScopes: ChangePartyScopes;
  readParty: ReadParty;
  checkServer: CheckServer;
  readPartyTools: ReadPartyTools;
  addA2aClient: AddA2aClient;
  addA2aAgent: AddA2aAgent;
  markA2aAgent: MarkA2aAgent;
  /** The ships an A2A client reaches now, by alias (decision 0060). */
  listReachedShips: ListReachedShips;
  /** The address of an alias's public card, under the gateway's public URL. */
  cardAddressOf: (alias: string) => string;
  stateParty: StateParty;
  markTool: MarkTool;
  switchTools: SwitchTools;
  readScopeRequirements: ReadScopeRequirements;
  readListedScopes: ReadListedScopes;
  checkApproving: CheckApproving;
  setScopeRequirements: SetScopeRequirements;
  registerClient: RegisterClient;
  /** An MCP client's authorization request, as the gateway reads it before it signs the person in. */
  readAuthorization?: ReadAuthorization;
  /** A client waiting for approval, as its browser follows it; unset where no pagasae signs anyone in. */
  watchWaiting?: WatchWaiting;
  /** The secret of the browser that asked for a client, sent beside the call (WAITING_SECRET_HEADER), so it never travels in an address. */
  waitingSecret?: string;
  listToDecide: ListToDecide;
  listMine: ListMine;
  decideRequest: DecideRequest;
  /** A person's own person ship's deliveries; unset where no pagasae signs anyone in. */
  person?: {
    readInbox: ReadInbox;
    openDelivery: OpenDelivery;
    answerDelivery: AnswerDelivery;
    doneDelivery: DoneDelivery;
    readWakeChannels: ReadWakeChannels;
    turnEmailChannel: TurnEmailChannel;
    turnOnWebPush: TurnOnWebPush;
    turnOffWebPush: TurnOffWebPush;
    focusPage: FocusPage;
    sendMessage: SendMessage;
    readMeeting: ReadMeeting;
    changeOwnMic: ChangeOwnMic;
  };
  /** The fleet's Slack workspace and the gateway's bot (gateway scopes, part B). */
  slack: {
    readSlack: ReadSlack;
    connectSlack: ConnectSlack;
    startInstall: StartInstall;
    disconnectSlack: DisconnectSlack;
    listExposable: ListExposable;
    exposeShip: ExposeShip;
    removeBot: RemoveBot;
    readSlackLink: ReadSlackLink;
    startLink: StartLink;
    unlinkSlack: UnlinkSlack;
    showAllInSlack: ShowAllInSlack;
  };
  readOutsideParties: ReadOutsideParties;
  setOutsideParties: SetOutsideParties;
}

/** What a caller reads of a failure: nothing of it, so no crew token, secret or query ever leaves; the log holds it whole. */
export const INTERNAL_ERROR_MESSAGE = 'Internal error';

/** What a person reads of input the API refused: the fields to look at, never the raw validation. */
function inputMessageOf(invalid: z.ZodError): string {
  const fields = [...new Set(invalid.issues.map((issue) => (issue.path.length === 0 ? 'the form' : issue.path.map(String).join(' '))))];
  return `Check what you filled in: ${fields.join(', ')} is missing or wrong.`;
}

const t = initTRPC.context<Context>().create({
  isDev: false,
  errorFormatter: ({ shape, error }) => {
    if (error.code === 'INTERNAL_SERVER_ERROR') {
      return { ...shape, message: INTERNAL_ERROR_MESSAGE };
    }
    return error.cause instanceof z.ZodError ? { ...shape, message: inputMessageOf(error.cause) } : shape;
  },
});

const actorProcedure = t.procedure.use(async ({ ctx, next }) => {
  const actor = await ctx.authenticateActor({ cookie: ctx.cookie, crewToken: ctx.crewToken, signIn: ctx.signIn, fleetId: ctx.fleetInView });
  if (!actor.isOk) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: actor.error.message });
  }
  return next({ ctx: { actor: actor.value, fleetId: actor.value.fleetId, scopes: actor.value.scopes } });
});

/**
 * What changes the fleet needs the actor to hold fleet:manage: argo does, a
 * viewer session (fleet:read only, decision 0022) does not, so it is served
 * reads only; a ship as its scopes say. Checked before the input is read.
 */
function managing(procedure: typeof actorProcedure) {
  return procedure.use(({ ctx, next }) => {
    if (!ctx.scopes.includes('fleet:manage')) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Needs fleet:manage' });
    }
    return next();
  });
}

/** Whether the token sent is the installation token, compared in constant time. */
function isInstallationToken(sent: string | undefined, token: string): boolean {
  const expected = Buffer.from(token);
  const given = Buffer.from(sent ?? '');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * The installation's procedures (decision 0021): with no installation token
 * configured they do not exist (NOT_FOUND); with one, the caller presents it
 * in `x-aeolus-installation-token` or is refused (UNAUTHORIZED).
 */
const installationProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (ctx.installation.mode === 'open' || ctx.installation.token === undefined) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'No such procedure' });
  }
  if (!isInstallationToken(ctx.installationTokenSent, ctx.installation.token)) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'The installation token is missing or wrong' });
  }
  return next();
});

/** Refuses a fleet the gateway does not serve: while it is off, FORBIDDEN. */
async function refuseUnlessServed(ctx: { fleetId: FleetId; isServed: IsServed }): Promise<void> {
  if (!(await ctx.isServed(ctx.fleetId))) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'The gateway is off for this fleet' });
  }
}

/** The operator's procedures that need the gateway to serve their fleet. */
const servedProcedure = actorProcedure.use(async ({ ctx, next }) => {
  await refuseUnlessServed(ctx);
  return next();
});

/** The refusals of connecting, as the API states them. */
const CONNECT_CODES = {
  ALREADY_CONNECTED: 'CONFLICT',
  SECRET_REFUSED: 'BAD_REQUEST',
  OTHER_FLEET: 'BAD_REQUEST',
  MISSING_SCOPES: 'BAD_REQUEST',
  SCOPE_REFUSED: 'CONFLICT',
  FLEET_UNAVAILABLE: 'BAD_GATEWAY',
} as const satisfies Record<string, TRPCError['code']>;

/** The refusals of switching a fleet, as the API states them: a fleet that does not answer is tried again with the same request id. */
const SET_ENABLED_CODES = {
  REQUEST_ID_USED: 'CONFLICT',
} as const satisfies Record<string, TRPCError['code']>;

/** The refusals of approving a party, as the API states them: a fleet that does not answer is tried again with the same request id. */
const APPROVE_CODES = {
  OUTSIDE_PARTIES_OFF: 'PRECONDITION_FAILED',
  NOT_CONNECTED: 'PRECONDITION_FAILED',
  PARTY_EXISTS: 'CONFLICT',
  COMMISSION_REFUSED: 'BAD_REQUEST',
  FLEET_UNAVAILABLE: 'BAD_GATEWAY',
} as const satisfies Record<string, TRPCError['code']>;

/** The refusals of adding an outside A2A client, as the API states them: a fleet that does not answer is tried again with the same request id. */
const ADD_A2A_CLIENT_CODES = {
  ...APPROVE_CODES,
  NOT_AN_APPROVER: 'FORBIDDEN',
  SCOPE_NOT_HELD: 'FORBIDDEN',
} as const satisfies Record<AddA2aClientRefusal['kind'], TRPCError['code']>;

/** The refusals of adding an outside A2A agent, as the API states them: a card that cannot be read now, or a fleet that does not answer, is tried again with the same request id. */
const ADD_A2A_AGENT_CODES = {
  ...ADD_A2A_CLIENT_CODES,
  CARD_UNREACHABLE: 'BAD_GATEWAY',
  CARD_INVALID: 'BAD_REQUEST',
} as const satisfies Record<AddA2aAgentRefusal['kind'], TRPCError['code']>;

/** The refusals of marking an outside A2A agent, as the API states them. */
const MARK_A2A_AGENT_CODES = {
  NOT_AN_APPROVER: 'FORBIDDEN',
  NO_SUCH_PARTY: 'NOT_FOUND',
} as const satisfies Record<MarkA2aAgentRefusal['kind'], TRPCError['code']>;

/** The refusals of reading an A2A client's card addresses, as the API states them. */
const CARD_ADDRESSES_CODES = {
  PARTY_NOT_CREWED: 'PRECONDITION_FAILED',
  FLEET_UNAVAILABLE: 'BAD_GATEWAY',
} as const satisfies Record<ListReachedShipsRefusal['kind'], TRPCError['code']>;

/** The refusals of crewing a party's proxy ship with a new secret, as the API states them. */
/** The refusals of retiring a party, as the API states them. */
/** The refusals of changing a party's owner or scopes, as the API states them. */
const CHANGE_CODES = {
  SCOPE_NOT_HELD: 'FORBIDDEN',
  NO_SUCH_PARTY: 'NOT_FOUND',
  PARTY_NOT_COMMISSIONED: 'PRECONDITION_FAILED',
  CHANGE_REFUSED: 'FORBIDDEN',
  FLEET_UNAVAILABLE: 'BAD_GATEWAY',
  NOT_AN_ACTOR: 'UNAUTHORIZED',
} as const satisfies Record<ChangePartyRefusal['kind'], TRPCError['code']>;

const RETIRE_CODES = {
  NOT_A_MANAGER: 'FORBIDDEN',
  NO_SUCH_PARTY: 'NOT_FOUND',
  RETIRE_REFUSED: 'FORBIDDEN',
  FLEET_UNAVAILABLE: 'BAD_GATEWAY',
  NOT_AN_ACTOR: 'UNAUTHORIZED',
} as const satisfies Record<RetirePartyRefusal['kind'], TRPCError['code']>;

/** The refusals of adding a client party, as the API states them: a fleet that does not answer is tried again with the same request id. */
const ADD_CLIENT_CODES = {
  NOT_AN_APPROVER: 'FORBIDDEN',
  SCOPE_NOT_HELD: 'FORBIDDEN',
  CLIENT_HAS_PARTY: 'CONFLICT',
  PARTY_EXISTS: 'CONFLICT',
  COMMISSION_REFUSED: 'BAD_REQUEST',
  OUTSIDE_PARTIES_OFF: 'PRECONDITION_FAILED',
  NOT_CONNECTED: 'PRECONDITION_FAILED',
  FLEET_UNAVAILABLE: 'BAD_GATEWAY',
} as const satisfies Record<AddClientPartyRefusal['kind'], TRPCError['code']>;

const CREW_CODES = {
  NO_SUCH_PARTY: 'NOT_FOUND',
  NOT_AWAITING_CREW: 'CONFLICT',
  SECRET_REFUSED: 'BAD_REQUEST',
  FLEET_UNAVAILABLE: 'BAD_GATEWAY',
} as const satisfies Record<string, TRPCError['code']>;

/** The refusals of reading an outside MCP server's tools, as the API states them. */
const TOOLS_CODES = {
  NO_SUCH_PARTY: 'NOT_FOUND',
  NOT_SIGNED_IN: 'PRECONDITION_FAILED',
  SERVER_UNREACHABLE: 'BAD_GATEWAY',
} as const satisfies Record<'NO_SUCH_PARTY' | 'NOT_SIGNED_IN' | 'SERVER_UNREACHABLE', TRPCError['code']>;

/** The refusals of reading the scopes the fleet lists, as the API states them. */
const LISTED_SCOPES_CODES = {
  NOT_AN_APPROVER: 'FORBIDDEN',
  NOT_CONNECTED: 'PRECONDITION_FAILED',
  FLEET_UNAVAILABLE: 'BAD_GATEWAY',
} as const satisfies Record<'NOT_AN_APPROVER' | 'NOT_CONNECTED' | 'FLEET_UNAVAILABLE', TRPCError['code']>;

/** The refusals of switching an outside MCP server's tools, as the API states them. */
const SWITCH_TOOLS_CODES = {
  NOT_AN_APPROVER: 'FORBIDDEN',
  NO_SUCH_PARTY: 'NOT_FOUND',
  PARTY_NOT_COMMISSIONED: 'PRECONDITION_FAILED',
  NOT_REACHABLE: 'FORBIDDEN',
  NOT_CONNECTED: 'PRECONDITION_FAILED',
  FLEET_UNAVAILABLE: 'BAD_GATEWAY',
  NOT_SIGNED_IN: 'PRECONDITION_FAILED',
  SERVER_UNREACHABLE: 'BAD_GATEWAY',
  NO_SUCH_TOOL: 'NOT_FOUND',
} as const satisfies Record<SwitchToolsRefusal['kind'], TRPCError['code']>;

/** The refusals of setting the scopes an outside party needs, as the API states them. */
const SET_SCOPE_REQUIREMENTS_CODES = {
  NOT_AN_APPROVER: 'FORBIDDEN',
  NO_SUCH_PARTY: 'NOT_FOUND',
  PARTY_NOT_COMMISSIONED: 'PRECONDITION_FAILED',
  NOT_REACHABLE: 'FORBIDDEN',
  NO_SUCH_TOOL: 'BAD_REQUEST',
  NOT_CONNECTED: 'PRECONDITION_FAILED',
  FLEET_UNAVAILABLE: 'BAD_GATEWAY',
  SCOPE_NOT_LISTED: 'BAD_REQUEST',
  CONFLICT: 'CONFLICT',
} as const satisfies Record<SetScopeRequirementsRefusal['kind'], TRPCError['code']>;

/** A party's required scopes as the API states them: its own set, and each tool's set by name. */
const scopeRequirementsSchema = z.object({ version: z.int().min(0), party: z.array(z.string()), tools: z.array(z.object({ tool: z.string(), scopes: z.array(z.string()) })) });

function scopeRequirementsOutputOf(requirements: ScopeRequirements): z.infer<typeof scopeRequirementsSchema> {
  return { version: requirements.version, party: [...requirements.party], tools: [...requirements.tools].map(([tool, scopes]) => ({ tool, scopes: [...scopes] })) };
}

/** The refusals of checking an outside MCP server, as the API states them. */
/** The refusals of adding a server where each person signs in, as the API states them: a fleet that does not answer is tried again with the same request id. */
const ADD_SIGN_IN_SERVER_CODES = {
  ...APPROVE_CODES,
  SERVER_UNREACHABLE: 'BAD_GATEWAY',
  NO_AUTHORIZATION_SERVER: 'BAD_REQUEST',
  SIGN_IN_CHECK_FAILED: 'BAD_REQUEST',
  NO_DYNAMIC_REGISTRATION: 'BAD_REQUEST',
  REGISTRATION_REFUSED: 'BAD_GATEWAY',
} as const satisfies Record<AddSignInServerRefusal['kind'], TRPCError['code']>;

const CHECK_CODES = {
  OUTSIDE_PARTIES_OFF: 'PRECONDITION_FAILED',
  SERVER_UNREACHABLE: 'BAD_GATEWAY',
} as const satisfies Record<'OUTSIDE_PARTIES_OFF' | 'SERVER_UNREACHABLE', TRPCError['code']>;

/** The refusals of stating a party's proxy ship, as the API states them. */
const STATE_CODES = {
  NO_SUCH_PARTY: 'NOT_FOUND',
  NOT_CREWED: 'CONFLICT',
  NOT_SIGNED_IN: 'PRECONDITION_FAILED',
  SERVER_UNREACHABLE: 'BAD_GATEWAY',
  STATEMENT_REFUSED: 'BAD_REQUEST',
} as const satisfies Record<string, TRPCError['code']>;

/** The refusals of a person's own sign-in to an outside MCP server, as the API states them. */
const PARTY_SIGN_IN_CODES = {
  NOT_A_PERSON: 'FORBIDDEN',
  NO_SUCH_PARTY: 'NOT_FOUND',
  NO_SIGN_IN: 'BAD_REQUEST',
  NOT_SIGNED_IN: 'NOT_FOUND',
} as const satisfies Record<string, TRPCError['code']>;

/** The refusals of an approver's view and removal of everyone's sign-ins to a party, as the API states them. */
const SIGN_INS_CODES = {
  NOT_AN_APPROVER: 'FORBIDDEN',
  NO_SUCH_PARTY: 'NOT_FOUND',
  PARTY_NOT_COMMISSIONED: 'PRECONDITION_FAILED',
  NOT_REACHABLE: 'FORBIDDEN',
  NOT_CONNECTED: 'PRECONDITION_FAILED',
  FLEET_UNAVAILABLE: 'BAD_GATEWAY',
  NO_SIGN_IN: 'BAD_REQUEST',
  NOT_SIGNED_IN: 'NOT_FOUND',
} as const satisfies Record<ApprovedSignInPartyRefusal['kind'] | 'NOT_SIGNED_IN', TRPCError['code']>;

const heldGrantShape = { outsideAccount: z.object({ subject: z.string().nullable(), name: z.string().nullable() }), signedInAt: z.string(), lastUsedAt: z.string().nullable() };

/** A person's own sign-in to a party, as their page shows it: never a token. A lost one says when and why. */
const ownSignInOutputSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('notSignedIn') }),
  z.object({ state: z.literal('signedIn'), ...heldGrantShape }),
  z.object({ state: z.literal('lost'), ...heldGrantShape, lost: z.object({ at: z.string(), why: z.string() }) }),
]);

/** Whose sign-in an approver sees: the person ship, its name where the fleet answers one, and whether it is the approver's own. */
const personShape = { personShipId: z.string(), personName: z.string().nullable(), isYours: z.boolean() };

/** Everyone's sign-ins to a party, a page at a time, as an approver sees them: never a token. */
const signInsOutputSchema = z.object({
  grants: z.array(
    z.discriminatedUnion('state', [
      z.object({ ...personShape, state: z.literal('signedIn'), ...heldGrantShape }),
      z.object({ ...personShape, state: z.literal('lost'), ...heldGrantShape, lost: z.object({ at: z.string(), why: z.string() }) }),
    ]),
  ),
  next: z.string().nullable(),
});

/** The longest name argo gives an MCP client. */
const CLIENT_NAME_MAX_LENGTH = 200;

/** The longest tool name MCP allows (2026-07-28), as a capability's name is capped too. */
const TOOL_NAME_MAX_LENGTH = 128;

/** What stating a party answers: the names of the capabilities its proxy ship now offers. */
const statedOutputSchema = z.object({ capabilities: z.array(z.string()) });

/** The fewest and most calls the gateway has in flight to one party at once, and the default. */
const CONCURRENCY_LIMIT_MIN = 1;
// The most core 0.27's pushReceive hands at once, own deliveries in flight first (orchestrator-1 on aeolus-fleet#876, Q8).
const CONCURRENCY_LIMIT_MAX = 10;
const CONCURRENCY_LIMIT_DEFAULT = 4;

/** The credential argo gives the vault for a party: none, a static bearer, or OAuth client credentials. */
const credentialInputSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('none') }),
  z.strictObject({ kind: z.literal('bearer'), token: z.string().min(1) }),
  z.strictObject({
    kind: z.literal('clientCredentials'),
    clientId: z.string().min(1),
    clientSecret: z.string().min(1),
    issuer: z.url({ protocol: /^https?$/ }),
    scope: z.string().min(1).optional(),
  }),
]);

/**
 * An outside MCP server's credential as the approver gives it: one of the
 * vault's, or each person signing in, for which the gateway registers the
 * party's client itself (decision 0067).
 */
const serverCredentialInputSchema = z.discriminatedUnion('kind', [...credentialInputSchema.options, z.strictObject({ kind: z.literal('personSignIn') })]);

/** A party as any actor reads it: never its credential or its crew token. */
const shownPartyBase = { name: z.string(), state: z.enum(['commissioning', 'awaitingCrew', 'crewed']), proxyShipId: z.string().nullable() };
/** An outside A2A agent's own fields: its card address, its credential's kind, its calls at once and its repeatable mark (A9). */
const agentFields = { cardUrl: z.string(), credentialKind: z.enum(['none', 'bearer', 'clientCredentials']), concurrencyLimit: z.int(), isRepeatable: z.boolean() };
const shownPartySchema = z.discriminatedUnion('kind', [
  z.object({ ...shownPartyBase, kind: z.literal('mcpServer'), url: z.string(), credentialKind: z.enum(['none', 'bearer', 'clientCredentials', 'personSignIn']), concurrencyLimit: z.int() }),
  z.object({ ...shownPartyBase, kind: z.literal('mcpClient'), clientId: z.string() }),
  z.object({ ...shownPartyBase, kind: z.literal('a2aClient') }),
  z.object({ ...shownPartyBase, kind: z.literal('a2aAgent'), ...agentFields }),
]);

/** A party with its proxy ship's name, owner and scopes, read from the fleet (decision 0056): null while unknown. */
const fromFleet = { proxyShipName: z.string().nullable(), ownerShipId: z.string().nullable(), ownerName: z.string().nullable(), scopes: z.array(z.string()).nullable() };
const listedPartySchema = z.discriminatedUnion('kind', [
  z.object({ ...shownPartyBase, ...fromFleet, kind: z.literal('mcpServer'), url: z.string(), credentialKind: z.enum(['none', 'bearer', 'clientCredentials', 'personSignIn']), concurrencyLimit: z.int() }),
  z.object({ ...shownPartyBase, ...fromFleet, kind: z.literal('mcpClient'), clientId: z.string() }),
  z.object({ ...shownPartyBase, ...fromFleet, kind: z.literal('a2aClient') }),
  z.object({ ...shownPartyBase, ...fromFleet, kind: z.literal('a2aAgent'), ...agentFields }),
]);

/** The connection as the console reads it: whether the gateway serves the fleet, and its connection. */
const connectionStatusOutputSchema = z.object({
  enabled: z.boolean(),
  state: z.enum(['not-connected', 'connected']),
  ship: z.object({ shipId: z.string(), name: z.string() }).nullable(),
  lastShipId: z.string().nullable(),
});

/** The refusals of deciding a request, as the API states them. */
const DECIDE_CODES = {
  NOT_AN_APPROVER: 'FORBIDDEN',
  SCOPE_NOT_HELD: 'FORBIDDEN',
  NO_SUCH_REQUEST: 'NOT_FOUND',
  ALREADY_DECIDED: 'CONFLICT',
  EXPIRED: 'CONFLICT',
  CLIENT_HAS_PARTY: 'CONFLICT',
  PARTY_EXISTS: 'CONFLICT',
  SERVER_DETAILS_MISSING: 'BAD_REQUEST',
  COMMISSION_REFUSED: 'BAD_REQUEST',
  OUTSIDE_PARTIES_OFF: 'PRECONDITION_FAILED',
  NOT_CONNECTED: 'PRECONDITION_FAILED',
  FLEET_UNAVAILABLE: 'BAD_GATEWAY',
} as const satisfies Record<DecideRefusal['kind'], TRPCError['code']>;

/** The refusals of switching outside parties, as the API states them: an open network's warning is confirmed by calling again. */
const OUTSIDE_PARTIES_CODES = {
  NOT_A_NETWORKER: 'FORBIDDEN',
  OPEN_NETWORK: 'PRECONDITION_FAILED',
  FLEET_UNAVAILABLE: 'BAD_GATEWAY',
  NOT_AN_ACTOR: 'UNAUTHORIZED',
} as const satisfies Record<string, TRPCError['code']>;

/** A pending request as the API answers it: its times as ISO text. */
const pendingRequestSchema = z.object({
  fleetId: z.string(),
  requestId: z.string(),
  subject: z.discriminatedUnion('kind', [z.object({ kind: z.literal('client'), clientId: z.string(), clientName: z.string() }), z.object({ kind: z.literal('server'), url: z.string() })]),
  requesters: z.array(z.object({ accountId: z.string(), personShipId: z.string().nullable() })),
  askedAt: z.string(),
  expiresAt: z.string(),
  state: z.enum(['pending', 'approving', 'approved', 'denied', 'expired']),
  decidedBy: z.union([z.object({ kind: z.literal('ship'), shipId: z.string() }), z.object({ kind: z.literal('account'), accountId: z.string() }), z.object({ kind: z.enum(['operator', 'viewer']) })]).nullable(),
  decidedAt: z.string().nullable(),
});

function shownRequestOf(request: PendingRequest): z.infer<typeof pendingRequestSchema> {
  return { ...request, requesters: [...request.requesters], askedAt: request.askedAt.toISOString(), expiresAt: request.expiresAt.toISOString(), decidedAt: request.decidedAt?.toISOString() ?? null };
}

/** A decision as the API takes it: deny, or approve naming the proxy ship, its owner and its scopes, and for a server its credential. */
const decisionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('deny') }),
  z.strictObject({
    kind: z.literal('approve'),
    party: z.strictObject({ name: shipHandleSchema, ownerShipId: idSchema('ship'), scopes: z.array(z.string()) }),
    server: z.strictObject({ credential: credentialInputSchema, concurrencyLimit: z.int().min(CONCURRENCY_LIMIT_MIN).max(CONCURRENCY_LIMIT_MAX) }).optional(),
  }),
]);

/** The refusals of a person's own deliveries, as the API states them. */
const PERSON_CODES = {
  NOT_A_PERSON: 'FORBIDDEN',
  SIGNED_OUT: 'UNAUTHORIZED',
  FLEET_UNAVAILABLE: 'BAD_GATEWAY',
  NO_SUCH_DELIVERY: 'NOT_FOUND',
  SEND_REFUSED: 'BAD_REQUEST',
  CHANNEL_NOT_OFFERED: 'PRECONDITION_FAILED',
  INVALID_SUBSCRIPTION: 'BAD_REQUEST',
  NO_SUCH_MEETING: 'NOT_FOUND',
  MIC_REFUSED: 'CONFLICT',
} as const satisfies Record<string, TRPCError['code']>;

/** A contribution a person writes on the pages: plain text. */
const CONTRIBUTION_CONTENT_TYPE = 'text/plain';

/** A meeting as the pages read it, its times in ISO 8601 as every answer of the API states them. */
function meetingViewOf({ meeting, mic }: PersonMeeting) {
  const at = (time: Date) => time.toISOString();
  const { openedAt, endedAt, contributions, ...rest }: MeetingRead = meeting;
  return {
    ...rest,
    openedAt: at(openedAt),
    endedAt: endedAt === null ? null : at(endedAt),
    mic: { ...meeting.mic, requests: meeting.mic.requests.map(({ ship, requestedAt }) => ({ ship, requestedAt: at(requestedAt) })) },
    contributions: { items: contributions.items.map(({ sentAt, ...contribution }) => ({ ...contribution, sentAt: at(sentAt) })), nextCursor: contributions.nextCursor },
    yourMic: mic,
  };
}

function personAnswerOf<T>(answered: Result<T, { kind: keyof typeof PERSON_CODES; message: string }>): T {
  if (!answered.isOk) {
    throw new TRPCError({ code: PERSON_CODES[answered.error.kind], message: answered.error.message });
  }
  return answered.value;
}

/** The person an account calls as: by the account token its shared sign-in was exchanged for. */
function personCallerOf({ fleetId, personShipId }: AccountActor, accountToken: string): PersonCaller {
  return { fleetId, signedIn: { accountToken, personShipId } };
}

/**
 * A person signed in to the pages, acting on their own person ship: only an
 * account has one, and only by its shared sign-in does the gateway hold the
 * account token that crews it.
 */
const personProcedure = actorProcedure.use(({ ctx, next }) => {
  if (ctx.actor.kind !== 'account' || ctx.person === undefined) {
    throw new TRPCError({ code: 'FORBIDDEN', message: "Only a person signed in to the gateway's pages has a person ship's deliveries here" });
  }
  if (ctx.actor.accountToken === null) {
    throw new TRPCError({ code: 'FORBIDDEN', message: "Open the gateway's pages, signed in with your account, to read your person ship's deliveries" });
  }
  return next({ ctx: { person: ctx.person, caller: personCallerOf(ctx.actor, ctx.actor.accountToken) } });
});

/** The person ship of a person signed in to the pages, as their sign-in names it (wake a person, W6). */
function personShipOf(caller: PersonCaller): PersonShip {
  const shipId = 'signedIn' in caller ? caller.signedIn.personShipId : null;
  if (shipId === null) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'You have no person ship in this fleet: your rights there do not let you message' });
  }
  return { fleetId: caller.fleetId, shipId };
}

/** A browser's push subscription as the page sends it, with the browser's name: the use case checks each part. */
const webPushSubscriptionInputSchema = z.strictObject({
  endpoint: z.string().min(1),
  keys: z.strictObject({ p256dh: z.string().min(1), auth: z.string().min(1) }),
  browser: z.string(),
});

/** The fleet's name as the account's shared sign-in states it, which their web push wakes say (wake a person, W4) and the gateway's Slack bot is named (gateway scopes B5). */
async function fleetNameOf(ctx: Pick<Context, 'accountApps' | 'signIn'>, asked: { fleetId: FleetId; toDo: string }): Promise<string> {
  if (ctx.accountApps === undefined || ctx.signIn === undefined) {
    throw new TRPCError({ code: 'FORBIDDEN', message: `Open the gateway's pages, signed in with your account, to ${asked.toDo}` });
  }
  const apps = await ctx.accountApps(ctx.signIn);
  if (!apps.isOk) {
    throw apps.error.kind === 'signedOut' ? new TRPCError({ code: 'UNAUTHORIZED', message: 'Sign in with your account' }) : new TRPCError({ code: 'SERVICE_UNAVAILABLE', message: 'The sign-in service did not answer: try again' });
  }
  const fleet = apps.value.fleets.find(({ fleetId }) => fleetId === asked.fleetId);
  if (fleet === undefined) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Your account may not open this fleet' });
  }
  return fleet.name;
}

/** The refusals of the fleet's Slack, as the API states them. */
const SLACK_CODES = {
  SLACK_SCOPE_NOT_HELD: 'FORBIDDEN',
  NOT_AN_ACCOUNT: 'FORBIDDEN',
  ALREADY_CONNECTED: 'CONFLICT',
  OTHER_WORKSPACE: 'CONFLICT',
  SLACK_NOT_CONNECTED: 'NOT_FOUND',
  SLACK_TOKEN_REFUSED: 'BAD_REQUEST',
  SLACK_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  NO_SUCH_BOT: 'NOT_FOUND',
  NOT_A_PERSON: 'FORBIDDEN',
  NOT_LINKED: 'NOT_FOUND',
  NOT_REACHABLE: 'FORBIDDEN',
  NOT_EXPOSABLE: 'BAD_REQUEST',
  CONFLICT: 'CONFLICT',
  FLEET_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
} as const;

/** The Slack procedures' answer, or its refusal as the API states it. */
function slackAnswerOf<T>(answered: Result<T, { kind: keyof typeof SLACK_CODES; message: string }>): T {
  if (!answered.isOk) {
    throw new TRPCError({ code: SLACK_CODES[answered.error.kind], message: answered.error.message });
  }
  return answered.value;
}

const slackViewOutputSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('notConnected'), canChange: z.boolean() }),
  z.object({
    state: z.literal('connected'),
    workspace: z.object({ teamId: z.string(), name: z.string().nullable() }),
    connectedBy: z.string(),
    connectedAt: z.string(),
    tokenState: z.enum(['fresh', 'refused']),
    gatewayBot: z.enum(['notMade', 'made', 'installed']),
    bots: z.array(z.object({ appId: z.string(), shipId: z.string(), shipName: z.string(), botName: z.string(), state: z.enum(['made', 'waitingForInstall', 'inSlack', 'removedInSlack']) })),
    canChange: z.boolean(),
  }),
]);

const accountInViewOutputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('signedIn'), fleetId: z.string(), accountId: z.string(), scopes: z.array(z.string()) }),
  z.object({ kind: z.literal('goTo'), fleetId: z.string() }),
  z.object({ kind: z.literal('off'), fleetName: z.string(), accountUrl: z.string() }),
  z.object({ kind: z.literal('elsewhere'), url: z.string() }),
]);

const appLinkOutputSchema = z.object({ app: z.string(), url: z.string() });
const accountAppsOutputSchema = z.object({
  account: z.object({ id: z.string(), email: z.string() }),
  apps: z.array(appLinkOutputSchema),
  fleets: z.array(z.object({ id: z.string(), name: z.string(), apps: z.array(appLinkOutputSchema) })),
});

export const gatewayRouter = t.router({
  account: t.router({
    /**
     * The account a page of the web app shows the fleet in its address as,
     * by the shared sign-in its server forwarded (header design H5): signed
     * in, with its scopes and never its token; the fleet to go to when the
     * page names none; that the gateway is off for the account's fleet when
     * it may open the gateway in none; or the app to go to where the account may not open
     * the gateway (H9). No shared sign-in, or one that ended, is UNAUTHORIZED.
     */
    inView: t.procedure.output(accountInViewOutputSchema).query(async ({ ctx }) => {
      if (ctx.accountInView === undefined) {
        throw new TRPCError({ code: 'NOT_FOUND', message: "This gateway signs no one in to its pages: it is no app at pagasae" });
      }
      const answer = await ctx.accountInView({ signIn: ctx.signIn, fleetId: ctx.fleetInView });
      if (!answer.isOk) {
        throw answer.error.kind === 'signedOut'
          ? new TRPCError({ code: 'UNAUTHORIZED', message: 'Sign in with your account' })
          : new TRPCError({ code: 'SERVICE_UNAVAILABLE', message: 'The sign-in service did not answer: try again' });
      }
      const shown = answer.value;
      return shown.kind === 'signedIn' ? { kind: 'signedIn' as const, fleetId: shown.fleetId, accountId: shown.token.accountId, scopes: [...shown.token.scopes] } : shown;
    }),
    /**
     * The apps and fleets the account may open, for the web app's header
     * (header design H1), by the shared sign-in its server forwarded. No
     * shared sign-in, or one that ended, is UNAUTHORIZED.
     */
    apps: t.procedure.output(accountAppsOutputSchema).query(async ({ ctx }) => {
      if (ctx.accountApps === undefined) {
        throw new TRPCError({ code: 'NOT_FOUND', message: "This gateway signs no one in to its pages: it is no app at pagasae" });
      }
      if (ctx.signIn === undefined) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sign in with your account' });
      }
      const answer = await ctx.accountApps(ctx.signIn);
      if (!answer.isOk) {
        throw answer.error.kind === 'signedOut'
          ? new TRPCError({ code: 'UNAUTHORIZED', message: 'Sign in with your account' })
          : new TRPCError({ code: 'SERVICE_UNAVAILABLE', message: 'The sign-in service did not answer: try again' });
      }
      const { account, apps, fleets } = answer.value;
      return { account, apps: [...apps], fleets: fleets.map(({ fleetId, name, apps: inFleet }) => ({ id: fleetId, name, apps: [...inFleet] })) };
    }),
  }),
  connection: t.router({
    /** Whether the gateway is connected to the operator's fleet, as which ship, and the ship it was last connected as. */
    status: actorProcedure.output(connectionStatusOutputSchema).query(async ({ ctx }) => {
      // A fleet that is off is read from what the gateway holds: it asks its fleet nothing then.
      const isServed = await ctx.isServed(ctx.fleetId);
      const connection = isServed ? await ctx.readConnection(ctx.fleetId) : await ctx.heldConnection(ctx.fleetId);
      return { enabled: isServed, ...connection };
    }),
    /**
     * Connects the gateway with its ship's secret, which the console's server
     * hands over server to server: it registers with it and keeps only the
     * crew token. Only while not connected, and while the gateway serves the
     * fleet.
     */
    connect: managing(servedProcedure)
      .input(z.object({ shipId: idSchema('ship'), secret: z.string().min(1) }))
      .output(connectionStatusOutputSchema)
      .mutation(async ({ ctx, input }) => {
        const connected = await ctx.connect({ operatorFleetId: ctx.fleetId, ...input });
        if (!connected.isOk) {
          throw new TRPCError({ code: CONNECT_CODES[connected.error.kind], message: connected.error.message });
        }
        // Answered as connection.status answers: connect works only while the gateway serves the fleet.
        return { enabled: true, ...connected.value };
      }),
  }),
  parties: t.router({
    /** The fleet's outside parties, by name, each with its proxy ship's owner and scopes from the fleet, read as the actor. Any actor reads them. */
    list: servedProcedure.output(z.array(listedPartySchema)).query(({ ctx }) => ctx.listParties({ actor: ctx.actor, as: { cookie: ctx.cookie, crewToken: ctx.crewToken } })),
    /** The ships a party's owner may be picked from, by name: the fleet's person ships and argo within the actor's read reach (decision 0045). */
    ownerChoices: servedProcedure.output(z.array(z.object({ shipId: z.string(), name: z.string() }))).query(async ({ ctx }) => {
      const listed = await ctx.listOwnerChoices({ actor: ctx.actor, as: { cookie: ctx.cookie, crewToken: ctx.crewToken } });
      if (!listed.isOk) {
        throw new TRPCError({ code: 'BAD_GATEWAY', message: listed.error.message });
      }
      return listed.value;
    }),
    /** One outside party, as the list shows it. */
    get: servedProcedure
      .input(z.strictObject({ name: shipHandleSchema }))
      .output(listedPartySchema)
      .query(async ({ ctx, input }) => {
        const read = await ctx.readParty({ actor: ctx.actor, as: { cookie: ctx.cookie, crewToken: ctx.crewToken }, ...input });
        if (!read.isOk) {
          throw new TRPCError({ code: 'NOT_FOUND', message: read.error.message });
        }
        return read.value;
      }),
    /** An outside MCP server's tools, as the server lists them now, asked with the credential the gateway keeps, each with its switch. Any actor reads them. */
    tools: servedProcedure
      .input(z.strictObject({ name: shipHandleSchema }))
      .output(z.object({ tools: z.array(z.object({ name: z.string(), description: z.string().optional(), isReadOnly: z.boolean().optional(), isDestructive: z.boolean().optional(), isOn: z.boolean(), isNew: z.boolean() })) }))
      .query(async ({ ctx, input }) => {
        const read = await ctx.readPartyTools({ fleetId: ctx.fleetId, ...input });
        if (!read.isOk) {
          throw new TRPCError({ code: TOOLS_CODES[read.error.kind], message: read.error.message });
        }
        return read.value;
      }),
    /**
     * An actor holding fleet:manage checks an outside MCP server before
     * approving it (F10): the tools it lists with the credential sent. The
     * gateway keeps nothing and commissions nothing. A mutation, so the
     * credential travels in the body, never in a URL.
     */
    check: managing(servedProcedure)
      .input(z.strictObject({ url: z.url({ protocol: /^https?$/ }), credential: credentialInputSchema }))
      .output(z.object({ tools: z.array(z.object({ name: z.string(), description: z.string().optional(), isReadOnly: z.boolean() })) }))
      .mutation(async ({ ctx, input }) => {
        const checked = await ctx.checkServer({ fleetId: ctx.fleetId, ...input });
        if (!checked.isOk) {
          throw new TRPCError({ code: CHECK_CODES[checked.error.kind], message: checked.error.message });
        }
        return checked.value;
      }),
    /**
     * argo approves an outside MCP server as a party: the gateway commissions
     * its app proxy ship owned by the owner argo picked, crews it, and keeps
     * the credential in its vault (interop I-5); for a server where each
     * person signs in, the client it registered for the party (0067). A repeat with the same
     * request id picks up where the last one stopped.
     */
    approve: managing(servedProcedure)
      .input(
        z.strictObject({
          requestId: idempotencyKeySchema,
          name: shipHandleSchema,
          url: z.url({ protocol: /^https?$/ }),
          credential: serverCredentialInputSchema,
          ownerShipId: idSchema('ship'),
          concurrencyLimit: z.int().min(CONCURRENCY_LIMIT_MIN).max(CONCURRENCY_LIMIT_MAX).default(CONCURRENCY_LIMIT_DEFAULT),
          /** Each tool the check answered, switched on or off; none sent means every tool the server lists at its first statement is on. */
          tools: z.array(z.strictObject({ name: z.string().min(1).max(TOOL_NAME_MAX_LENGTH), isOn: z.boolean() })).optional(),
        }),
      )
      .output(shownPartySchema)
      .mutation(async ({ ctx, input }) => {
        const { tools, ...approval } = input;
        // Adding needs fleet:manage; switching tools needs gateway:approve, as on the party's page (aeolus-fleet#1151).
        if (tools !== undefined && !ctx.scopes.includes(APPROVING_SCOPE)) {
          throw new TRPCError({ code: 'FORBIDDEN', message: `Switching an outside party's tools needs ${APPROVING_SCOPE}` });
        }
        const toolSwitches = tools === undefined ? null : new Map(tools.map(({ name, isOn }) => [name, isOn]));
        const { credential, ...server } = approval;
        if (credential.kind === 'personSignIn') {
          const added = await ctx.addSignInServer({ operatorFleetId: ctx.fleetId, ...server, scopes: [], toolSwitches });
          if (!added.isOk) {
            throw new TRPCError({ code: ADD_SIGN_IN_SERVER_CODES[added.error.kind], message: added.error.message });
          }
          return added.value;
        }
        const approved = await ctx.approveParty({ operatorFleetId: ctx.fleetId, ...server, credential, scopes: [], toolSwitches });
        if (!approved.isOk) {
          throw new TRPCError({ code: APPROVE_CODES[approved.error.kind], message: approved.error.message });
        }
        return approved.value;
      }),
    /**
     * An actor holding gateway:approve adds a client party with no human at
     * the authorize step, such as a vendor agent (vendor platforms V4): its
     * name, its owner (a person ship) and its scopes, only ones it holds. Its
     * client id and secret are answered once, the secret when its proxy ship
     * is crewed; a party left awaiting crew gets it from parties.crew. A
     * repeat with the same request id picks up where the last one stopped.
     */
    addClient: servedProcedure
      .input(z.strictObject({ requestId: idempotencyKeySchema, name: shipHandleSchema, ownerShipId: idSchema('ship'), scopes: z.array(z.string()) }))
      .output(z.object({ party: shownPartySchema, clientId: z.string(), clientSecret: z.string().nullable() }))
      .mutation(async ({ ctx, input }) => {
        const added = await ctx.addClientParty({ actor: ctx.actor, ...input });
        if (!added.isOk) {
          throw new TRPCError({ code: ADD_CLIENT_CODES[added.error.kind], message: added.error.message });
        }
        return added.value;
      }),
    /**
     * An actor holding gateway:approve adds an outside A2A client (decision
     * 0060): the gateway commissions and crews its proxy ship with the owner
     * and scopes chosen, and answers its bearer, shown only here. A repeat
     * with the same request id commissions nothing again and answers a new
     * bearer in place of the first.
     */
    addA2aClient: servedProcedure
      .input(z.strictObject({ requestId: idempotencyKeySchema, name: shipHandleSchema, ownerShipId: idSchema('ship'), scopes: z.array(z.string()) }))
      .output(z.object({ party: shownPartySchema, bearer: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const added = await ctx.addA2aClient({ actor: ctx.actor, ...input });
        if (!added.isOk) {
          throw new TRPCError({ code: ADD_A2A_CLIENT_CODES[added.error.kind], message: added.error.message });
        }
        return added.value;
      }),
    /**
     * An actor holding gateway:approve adds an outside A2A agent by its card
     * address (slice 5): the gateway reads the card first, then commissions
     * and crews its proxy ship with the owner and scopes chosen, and keeps the
     * credential in its vault. A repeat with the same request id picks up
     * where the last one stopped.
     */
    addA2aAgent: servedProcedure
      .input(
        z.strictObject({
          requestId: idempotencyKeySchema,
          name: shipHandleSchema,
          cardUrl: z.url({ protocol: /^https?$/ }),
          credential: credentialInputSchema,
          concurrencyLimit: z.int().min(CONCURRENCY_LIMIT_MIN).max(CONCURRENCY_LIMIT_MAX).default(CONCURRENCY_LIMIT_DEFAULT),
          ownerShipId: idSchema('ship'),
          scopes: z.array(z.string()),
        }),
      )
      .output(shownPartySchema)
      .mutation(async ({ ctx, input }) => {
        const added = await ctx.addA2aAgent({ actor: ctx.actor, ...input });
        if (!added.isOk) {
          throw new TRPCError({ code: ADD_A2A_AGENT_CODES[added.error.kind], message: added.error.message });
        }
        return added.value;
      }),
    /** An actor holding gateway:approve marks an outside A2A agent not repeatable, or repeatable again (A9): kept, then stated at once. */
    markA2aAgent: servedProcedure
      .input(z.strictObject({ name: shipHandleSchema, isRepeatable: z.boolean() }))
      .output(z.object({ isRepeatable: z.boolean(), statementRefusal: z.string().nullable() }))
      .mutation(async ({ ctx, input }) => {
        const marked = await ctx.markA2aAgent({ actor: ctx.actor, ...input });
        if (!marked.isOk) {
          throw new TRPCError({ code: MARK_A2A_AGENT_CODES[marked.error.kind], message: marked.error.message });
        }
        return marked.value;
      }),
    /** The card address of each ship an A2A client's proxy ship reaches now (decision 0060), for its owner to hand over. Any actor reads them. */
    cardAddresses: servedProcedure
      .input(z.strictObject({ name: shipHandleSchema }))
      .output(z.object({ addresses: z.array(z.string()) }))
      .query(async ({ ctx, input }) => {
        const reached = await ctx.listReachedShips({ fleetId: ctx.fleetId, party: input.name });
        if (!reached.isOk) {
          throw new TRPCError({ code: CARD_ADDRESSES_CODES[reached.error.kind], message: reached.error.message });
        }
        return { addresses: reached.value.map((ship) => ctx.cardAddressOf(ship.alias)) };
      }),
    /**
     * An actor holding fleet:manage retires a party (decision 0056): its proxy
     * ship is retired in the fleet as the actor, within its manage reach, and
     * the gateway forgets the party. Adding it again is a new request.
     */
    /** An actor holding fleet:owner sets a party's owner: its proxy ship's, in the fleet, as the actor (decision 0056). */
    changeOwner: servedProcedure
      .input(z.strictObject({ name: shipHandleSchema, ownerShipId: idSchema('ship') }))
      .output(z.object({}))
      .mutation(async ({ ctx, input }) => {
        const changed = await ctx.changePartyOwner({ actor: ctx.actor, as: { cookie: ctx.cookie, crewToken: ctx.crewToken }, ...input });
        if (!changed.isOk) {
          throw new TRPCError({ code: CHANGE_CODES[changed.error.kind], message: changed.error.message });
        }
        return {};
      }),
    /** An actor holding scopes:grant grants and revokes a party's scopes, only scopes it holds: every scope its proxy ship holds now (decision 0056). */
    changeScopes: servedProcedure
      .input(z.strictObject({ name: shipHandleSchema, grant: z.array(z.string()), revoke: z.array(z.string()) }))
      .output(z.object({ scopes: z.array(z.string()) }))
      .mutation(async ({ ctx, input }) => {
        const changed = await ctx.changePartyScopes({ actor: ctx.actor, as: { cookie: ctx.cookie, crewToken: ctx.crewToken }, ...input });
        if (!changed.isOk) {
          throw new TRPCError({ code: CHANGE_CODES[changed.error.kind], message: changed.error.message });
        }
        return changed.value;
      }),
    retire: servedProcedure
      .input(z.strictObject({ name: shipHandleSchema }))
      .output(z.object({}))
      .mutation(async ({ ctx, input }) => {
        const retired = await ctx.retireParty({ actor: ctx.actor, as: { cookie: ctx.cookie, crewToken: ctx.crewToken }, ...input });
        if (!retired.isOk) {
          throw new TRPCError({ code: RETIRE_CODES[retired.error.kind], message: retired.error.message });
        }
        return {};
      }),
    /**
     * argo hands over a new secret, from a new starting prompt in the console,
     * for a proxy ship that awaits crew, its crew released or never taken. A
     * client party that signs in by client credentials is answered its new
     * client secret, this once (vendor platforms V8).
     */
    crew: managing(servedProcedure)
      .input(z.strictObject({ name: shipHandleSchema, secret: z.string().min(1) }))
      .output(z.intersection(shownPartySchema, z.object({ clientSecret: z.string().nullable() })))
      .mutation(async ({ ctx, input }) => {
        const crewed = await ctx.crewParty({ operatorFleetId: ctx.fleetId, ...input });
        if (!crewed.isOk) {
          throw new TRPCError({ code: CREW_CODES[crewed.error.kind], message: crewed.error.message });
        }
        return { ...crewed.value.party, clientSecret: crewed.value.clientSecret };
      }),
    /**
     * A person presses Sign in on an outside MCP server's page, for
     * themselves (decision 0067): the address of the party's authorization
     * server to send their browser to. Every account of the fleet with a
     * person ship may.
     */
    startSignIn: servedProcedure
      .input(z.strictObject({ name: shipHandleSchema }))
      .output(z.object({ url: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const started = await ctx.partySignIn.start({ actor: ctx.actor, ...input });
        if (!started.isOk) {
          throw new TRPCError({ code: PARTY_SIGN_IN_CODES[started.error.kind], message: started.error.message });
        }
        return started.value;
      }),
    /** A person's own sign-in to an outside MCP server where each person signs in: the outside account it names, when, last used, and whether it was lost (Q12). */
    ownSignIn: servedProcedure
      .input(z.strictObject({ name: shipHandleSchema }))
      .output(ownSignInOutputSchema)
      .query(async ({ ctx, input }) => {
        const read = await ctx.partySignIn.readOwn({ actor: ctx.actor, ...input });
        if (!read.isOk) {
          throw new TRPCError({ code: PARTY_SIGN_IN_CODES[read.error.kind], message: read.error.message });
        }
        const own = read.value;
        switch (own.state) {
          case 'notSignedIn':
            return own;
          case 'signedIn':
            return { ...own, signedInAt: own.signedInAt.toISOString(), lastUsedAt: own.lastUsedAt?.toISOString() ?? null };
          case 'lost':
            return { ...own, signedInAt: own.signedInAt.toISOString(), lastUsedAt: own.lastUsedAt?.toISOString() ?? null, lost: { at: own.lost.at.toISOString(), why: own.lost.why } };
        }
      }),
    /** A person removes their own sign-in to an outside MCP server: revoked where the server offers it, then dropped (Q6). */
    removeOwnSignIn: servedProcedure
      .input(z.strictObject({ name: shipHandleSchema }))
      .output(z.object({ isRevoked: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        const removed = await ctx.partySignIn.removeOwn({ actor: ctx.actor, ...input });
        if (!removed.isOk) {
          throw new TRPCError({ code: PARTY_SIGN_IN_CODES[removed.error.kind], message: removed.error.message });
        }
        return removed.value;
      }),
    /**
     * Every person's sign-in to an outside MCP server where each person
     * signs in, 20 a page by person ship, for an actor holding
     * gateway:approve within manage reach of its proxy ship (Q12).
     */
    signIns: servedProcedure
      .input(z.strictObject({ name: shipHandleSchema, after: idSchema('ship').nullable() }))
      .output(signInsOutputSchema)
      .query(async ({ ctx, input }) => {
        const listed = await ctx.partySignIn.list({ actor: ctx.actor, as: { cookie: ctx.cookie, crewToken: ctx.crewToken }, ...input });
        if (!listed.isOk) {
          throw new TRPCError({ code: SIGN_INS_CODES[listed.error.kind], message: listed.error.message });
        }
        return {
          grants: listed.value.grants.map((grant) => {
            const shown = { ...grant, signedInAt: grant.signedInAt.toISOString(), lastUsedAt: grant.lastUsedAt?.toISOString() ?? null };
            return grant.state === 'lost' ? { ...shown, state: grant.state, lost: { at: grant.lost.at.toISOString(), why: grant.lost.why } } : { ...shown, state: grant.state };
          }),
          next: listed.value.next,
        };
      }),
    /** An actor holding gateway:approve within manage reach of the proxy ship removes any person's sign-in: revoked where the server offers it, then dropped (Q6). */
    removeSignIn: servedProcedure
      .input(z.strictObject({ name: shipHandleSchema, personShipId: idSchema('ship') }))
      .output(z.object({ isRevoked: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        const removed = await ctx.partySignIn.remove({ actor: ctx.actor, as: { cookie: ctx.cookie, crewToken: ctx.crewToken }, ...input });
        if (!removed.isOk) {
          throw new TRPCError({ code: SIGN_INS_CODES[removed.error.kind], message: removed.error.message });
        }
        return removed.value;
      }),
    /** The gateway states the party's proxy ship anew, from what its server lists now, with argo's marks. */
    state: managing(servedProcedure)
      .input(z.strictObject({ name: shipHandleSchema }))
      .output(statedOutputSchema)
      .mutation(async ({ ctx, input }) => {
        const stated = await ctx.stateParty({ fleetId: ctx.fleetId, ...input });
        if (!stated.isOk) {
          throw new TRPCError({ code: STATE_CODES[stated.error.kind], message: stated.error.message });
        }
        return stated.value;
      }),
    /** An actor holding gateway:approve within manage reach of the proxy ship switches tools of an outside MCP server on or off for the party (aeolus-fleet#1151), one or a selection (gateway scopes 4.3): kept in one change, then stated at once. */
    switchTools: servedProcedure
      .input(z.strictObject({ name: shipHandleSchema, tools: z.array(z.string().min(1).max(TOOL_NAME_MAX_LENGTH)).min(1), isOn: z.boolean() }))
      .output(z.object({ tools: z.array(z.string()), isOn: z.boolean(), statementRefusal: z.string().nullable() }))
      .mutation(async ({ ctx, input }) => {
        const switched = await ctx.switchTools({ actor: ctx.actor, as: { cookie: ctx.cookie, crewToken: ctx.crewToken }, ...input });
        if (!switched.isOk) {
          throw new TRPCError({ code: SWITCH_TOOLS_CODES[switched.error.kind], message: switched.error.message });
        }
        return switched.value;
      }),
    /** Every scope the fleet lists now, with its description: the scopes an approver may require (gateway scopes 4.3). Only an approver reads them. */
    listedScopes: servedProcedure.output(z.object({ scopes: z.array(z.object({ scope: z.string(), description: z.string() })) })).query(async ({ ctx }) => {
      const read = await ctx.readListedScopes({ actor: ctx.actor });
      if (!read.isOk) {
        throw new TRPCError({ code: LISTED_SCOPES_CODES[read.error.kind], message: read.error.message });
      }
      return { scopes: read.value };
    }),
    /**
     * Whether the actor approves the party: gateway:approve within manage
     * reach of its proxy ship (gateway scopes 4.3, A2). Its page shows the
     * controls then, and otherwise the same table read-only, saying why.
     */
    approving: servedProcedure
      .input(z.strictObject({ name: shipHandleSchema }))
      .output(z.object({ isApproving: z.boolean(), reason: z.string().nullable() }))
      .query(async ({ ctx, input }) => {
        const checked = await ctx.checkApproving({ actor: ctx.actor, as: { cookie: ctx.cookie, crewToken: ctx.crewToken }, ...input });
        if (checked.isOk) {
          return { isApproving: true, reason: null };
        }
        if (checked.error.kind === 'NO_SUCH_PARTY') {
          throw new TRPCError({ code: 'NOT_FOUND', message: checked.error.message });
        }
        return { isApproving: false, reason: checked.error.message };
      }),
    /** Which scopes a calling ship needs for an outside MCP server or A2A agent, and the version to change them on (gateway scopes 4.2). Any actor reads them. */
    scopeRequirements: servedProcedure
      .input(z.strictObject({ name: shipHandleSchema }))
      .output(scopeRequirementsSchema)
      .query(async ({ ctx, input }) => {
        const read = await ctx.readScopeRequirements({ fleetId: ctx.fleetId, ...input });
        if (!read.isOk) {
          throw new TRPCError({ code: 'NOT_FOUND', message: read.error.message });
        }
        return scopeRequirementsOutputOf(read.value);
      }),
    /**
     * An actor holding gateway:approve sets the scopes a calling ship needs
     * (gateway scopes 4.2, A2): the party's set when sent, and each tool's
     * sent, an empty one dropping it, all at once on the version it read;
     * then stated at once, as a tool switch is.
     */
    setScopeRequirements: servedProcedure
      .input(
        z.strictObject({
          name: shipHandleSchema,
          version: z.int().min(0),
          party: z.array(scopeNameSchema).optional(),
          tools: z.array(z.strictObject({ tool: z.string().min(1).max(TOOL_NAME_MAX_LENGTH), scopes: z.array(scopeNameSchema) })),
        }),
      )
      .output(z.intersection(scopeRequirementsSchema, z.object({ statementRefusal: z.string().nullable() })))
      .mutation(async ({ ctx, input }) => {
        const set = await ctx.setScopeRequirements({ actor: ctx.actor, as: { cookie: ctx.cookie, crewToken: ctx.crewToken }, name: input.name, version: input.version, ...(input.party === undefined ? {} : { party: input.party }), tools: new Map(input.tools.map(({ tool, scopes }) => [tool, scopes])) });
        if (!set.isOk) {
          throw new TRPCError({ code: SET_SCOPE_REQUIREMENTS_CODES[set.error.kind], message: set.error.message });
        }
        return { ...scopeRequirementsOutputOf(set.value.requirements), statementRefusal: set.value.statementRefusal };
      }),
    /** argo marks a party's tool repeatable, or takes the mark off (interop 5.2): kept, then stated at once. */
    markTool: managing(servedProcedure)
      .input(z.strictObject({ name: shipHandleSchema, tool: z.string().min(1).max(TOOL_NAME_MAX_LENGTH), isRepeatable: z.boolean() }))
      .output(statedOutputSchema)
      .mutation(async ({ ctx, input }) => {
        const stated = await ctx.markTool({ fleetId: ctx.fleetId, ...input });
        if (!stated.isOk) {
          throw new TRPCError({ code: STATE_CODES[stated.error.kind], message: stated.error.message });
        }
        return stated.value;
      }),
  }),
  people: t.router({
    /** What waits for the person's own ship, by titles only (Q20). */
    inbox: personProcedure.query(async ({ ctx }) => personAnswerOf(await ctx.person.readInbox(ctx.caller))),
    /** Opens one delivery, whole; the gateway acknowledges it for them. */
    open: personProcedure.input(z.strictObject({ deliveryId: z.string().min(1) })).mutation(async ({ ctx, input }) => personAnswerOf(await ctx.person.openDelivery({ caller: ctx.caller, ...input }))),
    /** Answers a delivery they opened, to its sender. */
    answer: personProcedure
      .input(z.strictObject({ deliveryId: z.string().min(1), contentType: z.string().min(1), payload: payloadSchema }))
      .mutation(async ({ ctx, input }) => personAnswerOf(await ctx.person.answerDelivery({ caller: ctx.caller, ...input }))),
    /** Is done with a delivery they opened, with no answer. */
    done: personProcedure.input(z.strictObject({ deliveryId: z.string().min(1) })).mutation(async ({ ctx, input }) => personAnswerOf(await ctx.person.doneDelivery({ caller: ctx.caller, ...input }))),
    /** The channels that wake them when something waits for their person ship, each offered or not and on or not (wake a person, W8). */
    wakeChannels: personProcedure.query(async ({ ctx }) => {
      const { email, webPush } = personAnswerOf(await ctx.person.readWakeChannels(ctx.caller));
      return { email, webPush: { publicKey: webPush.publicKey, browsers: webPush.browsers.map(({ addedAt, ...browser }) => ({ ...browser, addedAt: addedAt.toISOString() })) } };
    }),
    /** Turns email on or off, to be woken when something waits for their person ship. */
    turnEmail: personProcedure.input(z.strictObject({ isOn: z.boolean() })).mutation(async ({ ctx, input }) => { personAnswerOf(await ctx.person.turnEmailChannel({ caller: ctx.caller, ...input })); }),
    /** Turns web push on for the browser that sent its subscription; its wakes name the fleet as the person's shared sign-in states it. */
    turnOnWebPush: personProcedure.input(webPushSubscriptionInputSchema).mutation(async ({ ctx, input }) => {
      personAnswerOf(await ctx.person.turnOnWebPush({ caller: ctx.caller, fleetName: await fleetNameOf(ctx, { fleetId: ctx.caller.fleetId, toDo: 'turn web push on' }), ...input }));
    }),
    /** Removes a browser the person turned web push on in. */
    turnOffWebPush: personProcedure.input(z.strictObject({ endpoint: z.string().min(1) })).mutation(async ({ ctx, input }) => {
      personAnswerOf(await ctx.person.turnOffWebPush({ caller: ctx.caller, ...input }));
    }),
    /**
     * Held open by a page of the person while it is in focus (wake a person,
     * W6): what arrives is handed through the page, and no wake goes out. It
     * tells once that it holds; it ends when the page lets go or loses its
     * connection.
     */
    focus: personProcedure.subscription(async function* ({ ctx, signal }) {
      const stop = new AbortController();
      signal?.addEventListener('abort', () => {
        stop.abort();
      }, { once: true });
      const held = ctx.person.focusPage({ ...personShipOf(ctx.caller), pageId: randomUUID() }, stop.signal);
      try {
        yield { isInFocus: true };
        await held;
      } finally {
        stop.abort();
        await held;
      }
    }),
    /** A meeting they take part in, with a page of its contributions, newest first, and where they stand on its mic (decision 0061). */
    meeting: personProcedure
      .input(z.strictObject({ meetingId: idSchema('meeting'), cursor: idSchema('message').optional() }))
      .query(async ({ ctx, input: { meetingId, cursor } }) => meetingViewOf(personAnswerOf(await ctx.person.readMeeting({ caller: ctx.caller, meetingId, ...(cursor === undefined ? {} : { cursor }) })))),
    /** Contributes to a meeting, once under the page's key; the fleet takes it while they hold the mic or moderate. */
    contribute: personProcedure
      .input(z.strictObject({ meetingId: idSchema('meeting'), payload: payloadSchema.min(1), idempotencyKey: z.string().min(1) }))
      .mutation(async ({ ctx, input: { meetingId, payload, idempotencyKey } }) =>
        personAnswerOf(await ctx.person.sendMessage({ caller: ctx.caller, to: { kind: 'meeting', meetingId }, contentType: CONTRIBUTION_CONTENT_TYPE, payload, idempotencyKey })),
      ),
    /** Their own mic call: request it, withdraw the request, or release the mic they hold. */
    mic: personProcedure
      .input(z.strictObject({ meetingId: idSchema('meeting'), change: z.enum(['request', 'withdraw', 'release']) }))
      .mutation(async ({ ctx, input }) => {
        personAnswerOf(await ctx.person.changeOwnMic({ caller: ctx.caller, ...input }));
        return {};
      }),
  }),
  requests: t.router({
    /** The requests the account asked, in any state, the newest first (decision 0056: Your requests). */
    mine: actorProcedure.output(z.array(pendingRequestSchema)).query(async ({ ctx }) => {
      const listed = await ctx.listMine(ctx.actor);
      if (!listed.isOk) {
        throw new TRPCError({ code: 'FORBIDDEN', message: listed.error.message });
      }
      return listed.value.map(shownRequestOf);
    }),
    /**
     * Each change to the actor's fleet's requests, and to its person ship's
     * inbox when it is a person's (wake a person, #1014), carrying nothing of it:
     * the page that follows reads itself again as its own caller, so it is
     * never sent what its actor may not see. Changes heard while the last
     * was not yet taken come as one.
     */
    changes: actorProcedure.subscription(async function* ({ ctx, signal }) {
      const { fleetId, changes, actor } = ctx;
      if (changes === undefined) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'This gateway tells no changes' });
      }
      // Set by the hub between the generator's awaits, so held in an object the loop reads afresh.
      const heard = { isChanged: false, wake: (): void => undefined };
      const unsubscribe = changes.subscribe({
        fleetId,
        personShipId: actor.kind === 'account' ? actor.personShipId : null,
        read: () => {
          heard.isChanged = true;
          heard.wake();
        },
      });
      try {
        while (signal?.aborted !== true) {
          if (!heard.isChanged) {
            await new Promise<void>((resolve) => {
              heard.wake = resolve;
              signal?.addEventListener('abort', () => {
                resolve();
              }, { once: true });
            });
          }
          if (heard.isChanged) {
            heard.isChanged = false;
            yield { fleetId };
          }
        }
      } finally {
        unsubscribe();
      }
    }),
    /** Every open request of the fleet, for an actor holding gateway:approve (decision 0056). */
    toDecide: servedProcedure.output(z.array(pendingRequestSchema)).query(async ({ ctx }) => {
      const listed = await ctx.listToDecide(ctx.actor);
      if (!listed.isOk) {
        throw new TRPCError({ code: 'FORBIDDEN', message: listed.error.message });
      }
      return listed.value.map(shownRequestOf);
    }),
    /** Decides a pending request as the actor: the first decision counts. */
    decide: servedProcedure
      .input(z.strictObject({ requestId: z.string().min(1), decision: decisionSchema }))
      .output(z.object({ state: z.enum(['approved', 'denied']), party: shownPartySchema.nullable() }))
      .mutation(async ({ ctx, input }) => {
        const decided = await ctx.decideRequest({ actor: ctx.actor, ...input });
        if (!decided.isOk) {
          throw new TRPCError({ code: DECIDE_CODES[decided.error.kind], message: decided.error.message });
        }
        return decided.value;
      }),
  }),
  slack: t.router({
    /** The fleet's Slack as the Slack page shows it (gateway scopes 9.6), to any actor; canChange says whether it holds gateway:slack. */
    view: servedProcedure.output(slackViewOutputSchema).query(async ({ ctx }) => {
      const view = await ctx.slack.readSlack(ctx.actor);
      return view.state === 'connected' ? { ...view, connectedAt: view.connectedAt.toISOString(), bots: [...view.bots] } : view;
    }),
    /** Connects the fleet to a workspace by an app configuration refresh token, and makes the gateway's bot, named after the fleet (9.1). */
    connect: servedProcedure
      .input(z.strictObject({ refreshToken: z.string().trim().min(1) }))
      .output(z.object({ isGatewayBotMade: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.scopes.includes(SLACK_SCOPE)) {
          throw new TRPCError({ code: 'FORBIDDEN', message: `Connecting Slack needs ${SLACK_SCOPE}` });
        }
        const fleetName = await fleetNameOf(ctx, { fleetId: ctx.fleetId, toDo: 'connect Slack' });
        return slackAnswerOf(await ctx.slack.connectSlack({ actor: ctx.actor, refreshToken: input.refreshToken, fleetName }));
      }),
    /** Slack's install screen for the gateway's bot, made first if Slack did not make it at connect; with an app id, for a ship's bot. */
    install: servedProcedure
      .input(z.strictObject({ appId: z.string().min(1).optional() }))
      .output(z.object({ url: z.string() }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.scopes.includes(SLACK_SCOPE)) {
          throw new TRPCError({ code: 'FORBIDDEN', message: `Installing a Slack bot needs ${SLACK_SCOPE}` });
        }
        const as = { cookie: ctx.cookie, crewToken: ctx.crewToken };
        if (input.appId !== undefined) {
          return slackAnswerOf(await ctx.slack.startInstall({ actor: ctx.actor, as, bot: { kind: 'ship', appId: input.appId } }));
        }
        const fleetName = await fleetNameOf(ctx, { fleetId: ctx.fleetId, toDo: "install the gateway's Slack bot" });
        return slackAnswerOf(await ctx.slack.startInstall({ actor: ctx.actor, as, bot: { kind: 'gateway', fleetName } }));
      }),
    /** The agent ships and outside A2A agents' proxy ships Expose a ship… offers (9.2). */
    exposable: servedProcedure.output(z.array(z.object({ shipId: z.string(), name: z.string() }))).query(async ({ ctx }) => slackAnswerOf(await ctx.slack.listExposable({ actor: ctx.actor, as: { cookie: ctx.cookie, crewToken: ctx.crewToken } }))),
    /** Exposes a ship as a Slack bot, within manage reach of it: its app made from a manifest, to install next (9.2). */
    expose: servedProcedure
      .input(z.strictObject({ shipId: idSchema('ship') }))
      .output(z.object({ appId: z.string() }))
      .mutation(async ({ ctx, input }) => slackAnswerOf(await ctx.slack.exposeShip({ actor: ctx.actor, as: { cookie: ctx.cookie, crewToken: ctx.crewToken }, shipId: input.shipId }))),
    /** Deletes a ship's bot in Slack, after the page's confirm (9.2). */
    remove: servedProcedure
      .input(z.strictObject({ appId: z.string().min(1) }))
      .output(z.strictObject({}))
      .mutation(async ({ ctx, input }) => {
        slackAnswerOf(await ctx.slack.removeBot({ actor: ctx.actor, as: { cookie: ctx.cookie, crewToken: ctx.crewToken }, appId: input.appId }));
        return {};
      }),
    /** The person's Slack link as the Overview shows it (9.6): the workspace and the Slack name linked; none while the fleet's own bot is not in Slack. */
    link: servedProcedure
      .output(z.object({ workspaceName: z.string(), link: z.object({ slackName: z.string(), isShowingAll: z.boolean() }).nullable() }).nullable())
      .query(({ ctx }) => ctx.slack.readSlackLink({ actor: ctx.actor })),
    /** Sign in with Slack to link the person's Slack account, from the Overview or Slack's answer to an unlinked person (9.3). */
    startLink: servedProcedure.output(z.object({ url: z.string() })).mutation(async ({ ctx }) => slackAnswerOf(await ctx.slack.startLink({ actor: ctx.actor }))),
    /** Turns Show everything that waits in Slack on or off for the person's own link (9.6, B5). */
    showAll: servedProcedure
      .input(z.strictObject({ isOn: z.boolean() }))
      .output(z.strictObject({}))
      .mutation(async ({ ctx, input }) => {
        slackAnswerOf(await ctx.slack.showAllInSlack({ actor: ctx.actor, isOn: input.isOn }));
        return {};
      }),
    /** Unlinks the person's own Slack account (9.3). */
    unlink: servedProcedure.output(z.strictObject({})).mutation(async ({ ctx }) => {
      await ctx.slack.unlinkSlack({ actor: ctx.actor });
      return {};
    }),
    /** Removes every bot the gateway made in Slack, then forgets the workspace (after the page's confirm). */
    disconnect: servedProcedure.output(z.strictObject({})).mutation(async ({ ctx }) => {
      slackAnswerOf(await ctx.slack.disconnectSlack({ actor: ctx.actor }));
      return {};
    }),
  }),
  outsideParties: t.router({
    /** Whether the fleet's outside parties are on (interop I-3). */
    status: servedProcedure.output(z.object({ isOn: z.boolean() })).query(({ ctx }) => ctx.readOutsideParties(ctx.actor)),
    /** Turns them on or off as an actor holding fleet:network; on in an open network needs its warning confirmed. */
    set: servedProcedure
      .input(z.strictObject({ isOn: z.boolean(), isOpenNetworkConfirmed: z.boolean() }))
      .output(z.object({ isOn: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        const set = await ctx.setOutsideParties({ actor: ctx.actor, as: { cookie: ctx.cookie, crewToken: ctx.crewToken }, ...input });
        if (!set.isOk) {
          throw new TRPCError({ code: OUTSIDE_PARTIES_CODES[set.error.kind], message: set.error.message });
        }
        return set.value;
      }),
  }),
  oauth: t.router({
    /** The client an authorization request is for, as the web app's pick page shows it; a request the gateway would not serve is refused. */
    authorization: t.procedure
      .input(z.record(z.string(), z.string()))
      .output(z.object({ clientId: z.string(), clientName: z.string(), redirectUri: z.string() }))
      .query(async ({ ctx, input }) => {
        const read = ctx.readAuthorization === undefined ? undefined : await ctx.readAuthorization(input);
        if (read === undefined) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'This gateway signs no one in, so no MCP client connects' });
        }
        if (!read.isOk) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: read.error.kind === 'invalidClient' ? read.error.message : read.error.description });
        }
        const { clientId, clientName, redirectUri } = read.value;
        return { clientId, clientName, redirectUri };
      }),
    /**
     * A client waiting for approval, as the web app's waiting page shows it,
     * by the secret its browser holds, read with no side effect; anything
     * else, decided or refused, the page goes on to the gateway's own waiting
     * address, which alone issues the code or tells the account.
     */
    waiting: t.procedure
      .input(z.strictObject({ waiting: z.string() }))
      .output(z.discriminatedUnion('kind', [z.object({ kind: z.literal('waiting'), clientName: z.string(), expiresAt: z.string() }), z.object({ kind: z.literal('goOn') })]))
      .query(async ({ ctx, input }) => {
        const watched = ctx.watchWaiting === undefined ? undefined : await ctx.watchWaiting({ waiting: input.waiting, browserSecret: ctx.waitingSecret });
        return watched?.isOk === true && watched.value.isWaiting ? { kind: 'waiting' as const, clientName: watched.value.clientName, expiresAt: watched.value.expiresAt.toISOString() } : { kind: 'goOn' as const };
      }),
    /**
     * argo pre-registers an MCP client for its fleet: its name and redirect
     * URIs, and whether it keeps a secret. The secret is answered this once.
     */
    registerClient: managing(actorProcedure)
      .input(z.strictObject({ name: z.string().min(1).max(CLIENT_NAME_MAX_LENGTH), redirectUris: z.array(z.string()), isConfidential: z.boolean() }))
      .output(z.object({ clientId: z.string(), clientSecret: z.string().nullable() }))
      .mutation(async ({ ctx, input }) => {
        const registered = await ctx.registerClient({ fleetId: ctx.fleetId, ...input });
        if (!registered.isOk) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: registered.error.message });
        }
        return registered.value;
      }),
  }),
  installation: t.router({
    /** Switches the gateway on or off for a fleet; off keeps everything of it. A replayed request id answers its first answer. */
    setEnabled: installationProcedure
      .input(z.strictObject({ requestId: idempotencyKeySchema, fleetId: idSchema('fleet'), enabled: z.boolean() }))
      .output(z.object({ fleetId: z.string(), enabled: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        const set = await ctx.setFleetEnabled({ requestId: input.requestId, fleetId: input.fleetId, isEnabled: input.enabled });
        if (!set.isOk) {
          throw new TRPCError({ code: SET_ENABLED_CODES[set.error.kind], message: set.error.message });
        }
        return { fleetId: set.value.fleetId, enabled: set.value.isEnabled };
      }),
    /** Whether the gateway serves the fleet, and whether it is connected to it. */
    get: installationProcedure
      .input(z.strictObject({ fleetId: idSchema('fleet') }))
      .output(z.object({ enabled: z.boolean(), connected: z.boolean() }))
      .query(async ({ ctx, input }) => {
        const fleet = await ctx.readFleet({ fleetId: input.fleetId });
        return { enabled: fleet.isEnabled, connected: fleet.isConnected };
      }),
    /** Forgets everything the gateway holds of the fleet, telling the fleet nothing. A replayed request id answers its first answer. */
    delete: installationProcedure
      .input(z.strictObject({ requestId: idempotencyKeySchema, fleetId: idSchema('fleet') }))
      .output(z.strictObject({}))
      .mutation(async ({ ctx, input }) => {
        const deleted = await ctx.deleteFleet(input);
        if (!deleted.isOk) {
          throw new TRPCError({ code: 'CONFLICT', message: deleted.error.message });
        }
        return {};
      }),
    /** pagasae disabled the account (decision 0055): every sign-in of it in the fleet ends, its clients' tokens are revoked, its Slack link stops, and its grants of outside servers end (decision 0067, Q14). Told again, it ends nothing more. */
    accountDisabled: installationProcedure
      .input(z.strictObject({ fleetId: idSchema('fleet'), accountId: z.string().min(1) }))
      .output(z.strictObject({}))
      .mutation(async ({ ctx, input }) => {
        await ctx.endSignIns(input);
        await ctx.stopSlackLink(input);
        await ctx.endAccountGrants(input);
        return {};
      }),
  }),
});

export type GatewayRouter = typeof gatewayRouter;

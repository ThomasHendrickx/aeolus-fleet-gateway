/**
 * What aeolus_setup answers each client a person's chat runs in (gateway
 * #257): the rules for the chat in this conversation, and the steps it walks
 * the person through once, so every new conversation calls aeolus_setup
 * first. Each client's setup uses what that client offers, as its own docs
 * say (design gateway-inbox-state-and-setup, section 6): the Monitor tool
 * where the chat has one, else a look at the inbox at the start and end of
 * every turn, since a chat runs only while the person writes.
 */

/** The clients a person's chat says it runs in. */
export const SETUP_CLIENTS = ['claude', 'claude-code', 'chatgpt', 'copilot'] as const;

export type SetupClient = (typeof SETUP_CLIENTS)[number];

/** A client's setup: the chat's rules now, and the person's one-time steps. */
export interface ClientSetup {
  readonly client: SetupClient;
  readonly rules: readonly string[];
  readonly oneTimeSetup: readonly string[];
}

/** The chat never acts for the person on its own. */
const NEVER_FOR_THE_PERSON = 'Never decide, answer or mark done for the person; answer only with their choice, in their words.';

/** A chat that has the Monitor tool, as Thomas set it on #257: a tick that wakes the chat to look at the inbox. */
const MONITOR_RULES = [
  'Load the Monitor tool (ToolSearch select:Monitor).',
  'Start a Monitor with command `while true; do sleep 120; echo "tick $(date +%H:%M)"; done`, description "person ship inbox tick", timeout_ms 1800000. The shell cannot call the gateway, so the script only ticks; each tick wakes the chat.',
  'On every tick: call aeolus_inbox and compare its deliveryIds with the ones already seen. Something new: show it (sender, title, job; for a question the asker\'s pick), numbered. Do not open it. Nothing new: reply only "." and nothing else.',
  'When the Monitor expires (30 minutes), start it again right away, same command. Never let it lapse.',
  NEVER_FOR_THE_PERSON,
  'If this chat has no Monitor tool, say so, and instead call aeolus_inbox at the start and at the end of every turn.',
];

/** A chat with no Monitor tool looks whenever it runs. */
const TURN_RULES = [
  'Call aeolus_inbox at the start and at the end of every turn, and say what is new since the last look: sender, title and job, for a question the asker\'s pick, numbered. Do not open it.',
  NEVER_FOR_THE_PERSON,
];

/** The line a person keeps where their client reads it in every conversation. */
const keptLine = (client: SetupClient) => `"When the Aeolus connector is available, call aeolus_setup with client ${client} first and follow its answer."`;

const SETUPS: Record<SetupClient, ClientSetup> = {
  claude: {
    client: 'claude',
    rules: MONITOR_RULES,
    oneTimeSetup: [
      `Ask the person to add this line to their profile instructions (claude.ai, Settings, Profile), which Claude reads in every conversation, so each new conversation will call aeolus_setup with client claude first: ${keptLine('claude')}`,
      'Tell the person a connector is turned on per conversation, with the + button below the message box: turn Aeolus on in each conversation that should check the inbox.',
    ],
  },
  'claude-code': {
    client: 'claude-code',
    rules: MONITOR_RULES,
    oneTimeSetup: [
      `Ask the person to add this line to their own CLAUDE.md (~/.claude/CLAUDE.md), which Claude Code reads at the start of every session, so each session will call aeolus_setup with client claude-code first: ${keptLine('claude-code')}`,
    ],
  },
  chatgpt: {
    client: 'chatgpt',
    rules: TURN_RULES,
    oneTimeSetup: [
      `Ask the person to add this line to their custom instructions (Settings, Personalization), so each new chat will call aeolus_setup with client chatgpt first: ${keptLine('chatgpt')}`,
    ],
  },
  copilot: {
    client: 'copilot',
    rules: TURN_RULES,
    oneTimeSetup: [
      `Ask the person to add this line to their personal instructions (in VS Code, Chat: instructions, + next to User), which Copilot reads before a repository's, so each new chat will call aeolus_setup with client copilot first: ${keptLine('copilot')}`,
    ],
  },
};

/** The setup of the client a chat runs in. */
export function setupFor(client: SetupClient): ClientSetup {
  return SETUPS[client];
}

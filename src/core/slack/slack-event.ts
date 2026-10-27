/**
 * An event Slack sends for one of the gateway's apps, as its door reads it:
 * the event's type and the fields the gateway acts on, null where Slack
 * sent none.
 */
export interface SlackEventFields {
  /** Slack's id of the event, the same on each of its retries. */
  readonly eventId: string;
  readonly type: string;
  /** The workspace the event is in. */
  readonly teamId: string;
  readonly userId: string | null;
  readonly channel: string | null;
  /** im for a direct message with the bot. */
  readonly channelType: string | null;
  /** Set on an edit, a deletion, a join and the like; file_share on a new message with files. */
  readonly subtype: string | null;
  /** Set on a bot's own message. */
  readonly botId: string | null;
  /** The message's text in Slack's markup. */
  readonly text: string;
  /** The message's own timestamp, its id in the conversation. */
  readonly ts: string | null;
  /** The thread's first message, when the message is in a thread. */
  readonly threadTs: string | null;
  /** The files shared with it, each by its name and its link in Slack. */
  readonly files: readonly SlackFile[];
}

export interface SlackFile {
  readonly name: string;
  readonly permalink: string;
}

/** A person's new message to a bot: who wrote it, in which workspace, where, and what. */
export interface PersonMessage {
  readonly eventId: string;
  readonly teamId: string;
  readonly userId: string;
  readonly channel: string;
  readonly ts: string;
  readonly threadTs: string | null;
  readonly text: string;
  readonly files: readonly SlackFile[];
}

/** The subtype of a new message with files; any other subtype is no new message. */
const FILE_SHARE = 'file_share';

/**
 * The person's new message an event carries (gateway scopes 9.4 step 2): a
 * direct message to the bot, or a mention of it in a channel. A bot's
 * message (L21), an edit, a deletion or a join is none.
 */
export function personMessageOf(event: SlackEventFields): PersonMessage | undefined {
  const { eventId, type, teamId, userId, channel, channelType, subtype, botId, text, ts, threadTs, files } = event;
  const isNew = (subtype === null || subtype === FILE_SHARE) && botId === null;
  const isToBot = type === 'app_mention' || (type === 'message' && channelType === 'im');
  return isNew && isToBot && userId !== null && channel !== null && ts !== null ? { eventId, teamId, userId, channel, ts, threadTs, text, files } : undefined;
}

/** Whether the event says the app is no longer in Slack (gateway scopes 9.2). */
export function isRemovedEvent(event: SlackEventFields): boolean {
  return event.type === 'app_uninstalled' || event.type === 'tokens_revoked';
}

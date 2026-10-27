/**
 * An event Slack sends for one of the gateway's apps, as its door reads it:
 * the event's type and the fields the gateway acts on, null where Slack
 * sent none.
 */
export interface SlackEventFields {
  readonly type: string;
  /** The workspace the event is in. */
  readonly teamId: string;
  readonly userId: string | null;
  readonly channel: string | null;
  /** im for a direct message with the bot. */
  readonly channelType: string | null;
  /** Set on an edit, a deletion, a join and the like; none on a new message. */
  readonly subtype: string | null;
  /** Set on a bot's own message. */
  readonly botId: string | null;
}

/** A person's new message to a bot: who wrote it, in which workspace, and where. */
export interface PersonMessage {
  readonly teamId: string;
  readonly userId: string;
  readonly channel: string;
}

/**
 * The person's new message an event carries (gateway scopes 9.4 step 2): a
 * direct message to the bot, or a mention of it in a channel. A bot's
 * message (L21), an edit, a deletion or a join is none.
 */
export function personMessageOf(event: SlackEventFields): PersonMessage | undefined {
  const { type, teamId, userId, channel, channelType, subtype, botId } = event;
  const isNew = subtype === null && botId === null;
  const isToBot = type === 'app_mention' || (type === 'message' && channelType === 'im');
  return isNew && isToBot && userId !== null && channel !== null ? { teamId, userId, channel } : undefined;
}

/** Whether the event says the app is no longer in Slack (gateway scopes 9.2). */
export function isRemovedEvent(event: SlackEventFields): boolean {
  return event.type === 'app_uninstalled' || event.type === 'tokens_revoked';
}

/**
 * A post in Slack once something came of its item, in any place (Bridge,
 * section 7, view sync): an item's post, as views.html draws it answered,
 * keeps its heading and title, says what was done, when and to whom, and
 * where it shows, its pick and buttons gone, its side marked done or ended.
 * A message that is no item keeps its text with a line under it, as Bridge
 * says what came of it.
 */
import { outcomeTextOf, type ItemOutcome, type OutcomeKind } from '../people/item-outcome.js';
import type { SlackItem, SlackMessage, SlackTone } from './ports.js';
import { escaped } from './slack-post-of.js';

/** What came of the item, where and when. */
export type EditedOutcome = Pick<ItemOutcome, 'place' | 'kind' | 'option' | 'at'>;

const MS_PER_SECOND = 1_000;

/** How many characters of an ISO time are its hours and minutes, after its date and T. */
const CLOCK = { from: 11, to: 16 } as const;

/** The time as Slack shows it in each reader's own clock, with the time in UTC for a reader it cannot. */
function slackTimeOf(at: Date): string {
  return `<!date^${String(Math.floor(at.getTime() / MS_PER_SECOND))}^{time}|${at.toISOString().slice(CLOCK.from, CLOCK.to)} UTC>`;
}

/** Whether the item's job ended as asked: answered, done or seen; anything else ended it another way. */
const TONES: Record<OutcomeKind, SlackTone> = { answered: 'done', done: 'done', seen: 'done', cannot: 'ended', withdrawn: 'ended', replaced: 'ended', notSent: 'ended' };

/** The option answered with, as its button named it, or by its number once the button is gone. */
function optionTextOf(message: SlackMessage, option: number): string {
  const button = message.buttons.find((each) => 'option' in each && each.option === option);
  return escaped(button?.text ?? `option ${String(option)}`);
}

/** What was done, when and to whom, as the edited post says it. */
function doneLineOf(message: SlackMessage & { item: SlackItem }, outcome: EditedOutcome): string {
  const at = slackTimeOf(outcome.at);
  const asker = escaped(message.item.asker);
  switch (outcome.kind) {
    case 'answered':
      return outcome.option === null ? `✅ You answered at ${at} with your note, sent to ${asker}` : `✅ You answered at ${at}: *${optionTextOf(message, outcome.option)}*, sent to ${asker}`;
    case 'done':
      // The gateway's own step is done by what it saw, so nothing is sent for it.
      return outcome.place === 'gateway' ? `✅ Done at ${at}` : `✅ Done at ${at}, sent to ${asker}`;
    case 'cannot':
      return `Marked cannot at ${at}, sent to ${asker}`;
    case 'seen':
      return `✅ Seen at ${at}`;
    case 'withdrawn':
      return `Withdrawn by ${asker}, seen at ${at}`;
    case 'replaced':
      return `Replaced by ${asker}, seen at ${at}`;
    case 'notSent':
      return `Not sent: removed from the basket at ${at}`;
  }
}

/** Where it shows as done: in Slack, as views.html says it, the other places; elsewhere, what Bridge says of it. */
function whereLineOf(outcome: EditedOutcome, bridgeUrl: string): string {
  const said = outcomeTextOf({ place: outcome.place, kind: outcome.kind, option: null });
  const where = outcome.place === 'slack' ? `Bridge and the chat show it ${said.charAt(0).toLowerCase()}${said.slice(1)}` : said;
  return `${where} · <${bridgeUrl}|Open in Bridge>`;
}

/** Whether the item's post says already what came of it, as another gateway edited it. */
function isEditedAlready(item: SlackItem): boolean {
  return item.tone === 'done' || item.tone === 'ended';
}

/** The post edited to say what came of its item; none when it says so already. */
export function editedPostOf(message: SlackMessage, edit: { outcome: EditedOutcome; bridgeUrl: string }): SlackMessage | undefined {
  const { item } = message;
  if (item === null) {
    const line = `_${outcomeTextOf(edit.outcome)}_`;
    return { text: message.text.endsWith(line) ? message.text : `${message.text}\n\n${line}`, item: null, buttons: [] };
  }
  if (isEditedAlready(item)) {
    return undefined;
  }
  return {
    text: message.text,
    item: { ...item, body: doneLineOf({ ...message, item }, edit.outcome), aside: null, footer: whereLineOf(edit.outcome, edit.bridgeUrl), tone: TONES[edit.outcome.kind] },
    buttons: [],
  };
}

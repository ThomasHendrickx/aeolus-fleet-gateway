/**
 * What a person's chat reads aloud (#238): the inbox, an opened delivery and
 * a meeting as sentences. Times are said in UTC to the minute, and an id
 * appears only where the chat must pass it back to another tool; a content
 * type never does.
 */
import type { MeetingShip, MeetingParticipant } from '../../core/meetings/ports.js';
import type { PersonMeeting } from '../../core/meetings/read-meeting.js';
import type { MicStanding } from '../../core/meetings/mic-standing.js';
import type { ItemJob } from '../../core/people/item-job.js';
import type { ChatInboxEntry } from '../../core/people/inbox-entry.js';
import type { OpenedView } from '../../core/people/open-delivery.js';
import type { Inbox } from '../../core/people/read-inbox.js';

const MINUTE_END = 16;

/** A time of day to the minute in UTC: 2026-10-19 08:00 UTC. */
function clockOf(at: Date | string): string {
  return `${new Date(at).toISOString().slice(0, MINUTE_END).replace('T', ' ')} UTC`;
}

const JOB_WORDS: Record<ItemJob, string> = { decide: 'to decide', do: 'to do', 'stay-aware': 'to stay aware of', 'everything-else': 'a message' };

function entryWords(entry: ChatInboxEntry, position: number): string {
  const pick = entry.pick === null ? '' : ` ${entry.from} picks option ${String(entry.pick.option)}: ${entry.pick.why}.`;
  return `${String(position)}. ${entry.from}, ${clockOf(entry.sentAt)}, ${JOB_WORDS[entry.job]}: ${entry.title}${pick} (deliveryId ${entry.deliveryId})`;
}

/** The inbox: how many wait, each delivery that waits, and each one opened and not answered or done yet. */
export function inboxWords(inbox: Inbox): string {
  const waiting = inbox.waiting === 0 ? 'Nothing waits for you.' : `${String(inbox.waiting)} ${inbox.waiting === 1 ? 'waits' : 'wait'} for you.`;
  const listed = inbox.deliveries.length === 0 ? [] : ['Waiting:', ...inbox.deliveries.map((entry, index) => entryWords(entry, index + 1))];
  const opened = inbox.opened.length === 0 ? ['Opened and not answered or done yet: none.'] : ['Opened and not answered or done yet:', ...inbox.opened.map((entry, index) => entryWords(entry, index + 1))];
  return [waiting, ...listed, ...opened].join('\n');
}

/** A meeting notice as its sentence with the meeting to read; any other delivery whole, as it came. */
export function openedWords(opened: OpenedView): string {
  if (opened.said !== null) {
    return opened.meetingId === null ? opened.said : `${opened.said} (meetingId ${opened.meetingId})`;
  }
  const meeting = opened.meetingId === null ? '' : `, in the meeting ${opened.meetingId}`;
  const stale = opened.stale === null ? '' : ` It was ${opened.stale.kind} by its asker at ${clockOf(opened.stale.at)}.`;
  return `${opened.from}, ${clockOf(opened.sentAt)}${meeting}: ${opened.title}\n${opened.payload}${stale}`;
}

const names = (ships: readonly MeetingShip[]): string => ships.map(({ name }) => name).join(', ');

function standingWords(standing: MicStanding): string {
  switch (standing.kind) {
    case 'moderating':
      return 'You moderate, so you contribute without the mic.';
    case 'holding':
      return 'You hold the mic.';
    case 'requested':
      return `You wait for the mic, number ${String(standing.place)} in line.`;
    case 'none':
      return 'You do not hold the mic: request it first.';
  }
}

/** A meeting: who is in it, its mic, where the person stands on it, and a page of contributions, newest first. */
export function meetingWords({ meeting, mic }: PersonMeeting): string {
  const present = meeting.participants.filter((participant: MeetingParticipant) => participant.state === 'present');
  const opened = `open since ${clockOf(meeting.openedAt)}`;
  const state = meeting.endedAt === null ? opened : `${opened}, ended ${clockOf(meeting.endedAt)}`;
  const holder = meeting.mic.holder === null ? 'The mic is free' : `${meeting.mic.holder.name} holds the mic`;
  const passes = meeting.mic.pattern === 'fifo' ? 'passes first come, first served' : 'passes as the moderator gives it';
  const line = meeting.mic.requests.length === 0 ? 'Nobody waits for it.' : `Waiting for it, oldest first: ${names(meeting.mic.requests.map(({ ship }) => ship))}.`;
  const contributions = meeting.contributions.items.map(({ sentAt, sender, payload }) => `- ${clockOf(sentAt)} ${sender.name}: ${payload}`);
  const more = meeting.contributions.nextCursor === null ? [] : [`Older ones: call again with cursor ${meeting.contributions.nextCursor}.`];
  return [
    `Meeting ${meeting.title === null ? 'without a title' : `“${meeting.title}”`} (meetingId ${meeting.meetingId}), ${state}.`,
    `Owner ${meeting.owner.name}, moderator ${meeting.moderator.name}.`,
    `In it: ${names(present)}.`,
    `${holder} and ${passes}. ${line}`,
    standingWords(mic),
    ...(contributions.length === 0 ? ['No contributions yet.'] : ['Contributions, newest first:', ...contributions]),
    ...more,
  ].join('\n');
}

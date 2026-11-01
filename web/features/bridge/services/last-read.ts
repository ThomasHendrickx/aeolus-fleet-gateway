/**
 * A page part as last read (states.html; Bridge, section 9: core does not
 * answer): while the record cannot be read, the page goes on showing what it
 * last read, saying when. The browser keeps what it showed; the gateway keeps
 * no copy of a payload (Bridge, section 6). Pure view logic, no React.
 */

/** What the server answered for a part: read at a time, or, with no time, what to show while it could not be read. */
export interface PartAnswer<T> {
  readonly readAt: string | undefined;
  readonly part: T;
}

/** The last part read, and when. */
export interface KeptPart<T> {
  readonly readAt: string;
  readonly part: T;
}

/** What shows of a part: as read now, or, with a time, as last read then. */
export interface ShownPart<T> {
  readonly part: T;
  readonly lastReadAt: string | undefined;
}

export function nextShownOf<T>(kept: KeptPart<T> | undefined, answer: PartAnswer<T>): { kept: KeptPart<T> | undefined; shown: ShownPart<T> } {
  if (answer.readAt !== undefined) {
    return { kept: { readAt: answer.readAt, part: answer.part }, shown: { part: answer.part, lastReadAt: undefined } };
  }
  if (kept === undefined) {
    return { kept, shown: { part: answer.part, lastReadAt: undefined } };
  }
  return { kept, shown: { part: kept.part, lastReadAt: kept.readAt } };
}

/** The time of day a part was last read, in UTC to the minute, as Bridge says its other times. */
export function lastReadTimeOf(readAt: string): string {
  return `${new Date(readAt).toISOString().slice(11, 16)} UTC`;
}

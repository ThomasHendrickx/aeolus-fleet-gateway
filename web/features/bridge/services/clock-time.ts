/** The time of day of an instant (ISO 8601), in UTC to the minute, as Bridge says when something happened: 20:16 UTC. */
export function clockTimeOf(at: string): string {
  return `${new Date(at).toISOString().slice(11, 16)} UTC`;
}

/** A wake is a hint to look, never a delivery. Each lease has one queue; its consumer serializes looks. */
export interface ShipLooks {
  /** Takes the pending hint, or waits for one. False means the stream was stopped. */
  wait(): Promise<boolean>;
  /** Requests another look after a local change, coalescing with any pending wake. */
  request(): void;
  isEnded(): boolean;
  close(): void;
}

/** Opens one REST wake stream for the held lease, until its signal aborts or the lease ends. */
export type ShipWakeups = (crewToken: string, signal: AbortSignal) => ShipLooks;

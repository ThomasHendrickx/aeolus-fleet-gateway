/**
 * Stay aware as Bridge shows it (stay-aware.html, CC16): the feed of alerts
 * and notices, the ones not seen yet marked new, and an opened alert's ship,
 * its Health in the console and what Aeolus does when it clears (decision
 * 0071). Pure view logic, no React and no API client.
 */
import { ALERT_CONTENT_TYPE, alertMessageSchema, type AlertSignal } from '@aeolus-fleet/common';

import type { HomeItem, RecordItem } from './items';

type FeedItem = Pick<HomeItem, 'deliveryId' | 'from' | 'title' | 'sentAt' | 'job'>;

/** An item of the feed, new until the person sees it. */
export interface FeedRow {
  readonly item: FeedItem;
  readonly isNew: boolean;
}

/**
 * The feed: the alerts and notices not seen yet, as Bridge home reads them,
 * and the ones the record holds seen, newest first. Seeing one handles it
 * (CC16), so the seen ones live only in the record.
 */
export function feedOf({ unseen, record }: { unseen: readonly FeedItem[]; record: readonly (FeedItem & Pick<RecordItem, 'state'>)[] }): FeedRow[] {
  const isUnseen = new Set(unseen.map(({ deliveryId }) => deliveryId));
  const seen = record.filter(({ job, deliveryId }) => job === 'stay-aware' && !isUnseen.has(deliveryId));
  return [...unseen.map((item) => ({ item, isNew: true })), ...seen.map((item) => ({ item, isNew: false }))].sort((a, b) => b.item.sentAt.localeCompare(a.item.sentAt));
}

/** How many are not seen yet: "1 unseen". */
export function unseenSaidOf(count: number): string {
  return `${String(count)} unseen`;
}

/** What an opened alert is about: its ship, and the signal that parted. */
export interface AlertView {
  readonly ship: { readonly id: string; readonly name: string };
  readonly signal: AlertSignal;
}

/** The alert a delivery carries; none for a notice, or a payload that does not read as an alert. */
export function alertOf(opened: { contentType: string; payload: string }): AlertView | undefined {
  if (opened.contentType !== ALERT_CONTENT_TYPE) {
    return undefined;
  }
  try {
    const alert = alertMessageSchema.safeParse(JSON.parse(opened.payload));
    return alert.success ? { ship: alert.data.ship, signal: alert.data.signal } : undefined;
  } catch {
    return undefined;
  }
}

/** A ship's Health: its page in the fleet's console, where its open alerts and its state now show (monitoring 4.8). */
export function healthHrefOf({ consoleUrl, shipId }: { consoleUrl: string; shipId: string }): string {
  return `${consoleUrl.replace(/\/$/, '')}/ships/${shipId}`;
}

/** The info line under an opened alert: Aeolus only tells, the alert clears by itself, and nothing is sent when it does (0071). */
export function clearsSaidOf(alert: AlertView): string {
  const clears = alert.signal === 'report-unchanged' ? `The alert clears when ${alert.ship.name} reports again` : 'The alert clears by itself once what it tells of moves';
  return `Aeolus only tells you. ${clears}; nothing is sent on clear, so this stays here as it was.`;
}

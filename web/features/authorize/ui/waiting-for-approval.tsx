'use client';

import { useEffect, useState } from 'react';

import { CARD } from '../../forms/ui/look';
import { useFollowWaiting } from '../hooks/use-follow-waiting';
import { timeLeft } from '../services/authorize';

const MS_PER_MINUTE = 60_000;

/** The client waits for an approver of the fleet: its time left, and the page goes on by itself once the request is decided. */
export function WaitingForApproval({ waiting, clientName, expiresAt, shownAt }: { waiting: string; clientName: string; expiresAt: string; shownAt: string }) {
  useFollowWaiting(waiting);
  const [now, setNow] = useState(() => new Date(shownAt));
  useEffect(() => {
    const tick = setInterval(() => {
      setNow(new Date());
    }, MS_PER_MINUTE);
    return () => {
      clearInterval(tick);
    };
  }, []);
  const left = timeLeft(new Date(expiresAt), now);
  return (
    <section className={`${CARD} grid gap-3`} data-testid="authorize-waiting">
      <h1 className="text-heading font-semibold">Waiting for approval</h1>
      <p role="status" aria-live="polite" className="inline-flex w-fit rounded-md border border-tone-attention-border bg-tone-attention-bg px-3 py-1 text-tone-attention-fg">
        <span data-testid="authorize-waiting-left">{left}</span>&nbsp;left
      </p>
      <p>
        <strong>{clientName}</strong> waits for an approver of your fleet.
      </p>
      <p>Goes on by itself.</p>
      <p className="text-muted-foreground">Closed this page? Connect again later.</p>
    </section>
  );
}

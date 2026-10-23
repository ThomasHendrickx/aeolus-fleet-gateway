'use client';

import { useState, useTransition } from 'react';

import { turnEmail } from '../hooks/overview-actions';
import type { WakeChannels } from '../services/deliveries';
import { ActionButton } from '../ui/action-button';
import { Notice } from '../ui/notice';

/**
 * Where the person turns on the channels that wake them when something
 * waits for their person ship while they are away (wake a person, W8):
 * email, where the gateway sends it. Nothing is on by default. The wake says
 * only that something waits in the fleet, with a link here.
 */
export function WakePanel({ fleetId, channels }: { fleetId: string; channels: WakeChannels }) {
  const [isTurning, startTransition] = useTransition();
  const [failure, setFailure] = useState<string | undefined>();
  const { email } = channels;
  if (!email.isOffered) {
    return null;
  }

  const turn = (isOn: boolean) => {
    setFailure(undefined);
    startTransition(async () => {
      const outcome = await turnEmail(fleetId, isOn);
      if (!outcome.isOk) {
        setFailure(outcome.message);
      }
    });
  };

  return (
    <section className="grid gap-2" aria-labelledby="overview-wake-heading">
      <h2 id="overview-wake-heading" className="text-section font-semibold">
        When something waits
      </h2>
      <div className="flex items-center gap-3 rounded-md border border-border bg-card p-3">
        <span className="flex min-w-0 flex-1 flex-col">
          <span>Email</span>
          <span data-testid="overview-wake-email-state" className="text-caption text-muted-foreground">
            {email.isOn ? 'On: you get an email when something waits for you in this fleet, with a link here. Never what waits.' : 'Off: nothing tells you when something waits while you are away.'}
          </span>
        </span>
        <ActionButton data-testid="overview-wake-email" isPending={isTurning} pendingLabel={email.isOn ? 'Turning off...' : 'Turning on...'} onClick={() => { turn(!email.isOn); }}>
          {email.isOn ? 'Turn off' : 'Turn on'}
        </ActionButton>
      </div>
      {failure === undefined ? null : <Notice message={failure} isFailure />}
    </section>
  );
}

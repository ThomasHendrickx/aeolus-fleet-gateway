'use client';

import { useEffect, useState, useTransition } from 'react';

import { turnOffWebPush, turnOnWebPush } from '../hooks/overview-actions';
import type { WakeChannels } from '../services/deliveries';
import { applicationServerKeyOf, browserNameOf, subscriptionInputOf } from '../services/web-push';
import { ActionButton } from '../ui/action-button';
import { Notice } from '../ui/notice';

/** The service worker that shows a wake and opens the overview when it is pressed. */
const WORKER_PATH = '/wake-worker.js';

/** Whether this browser takes web push at all. */
function isPushTaken(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/** This browser's own push subscription with the gateway's worker, if it has one. */
async function ownSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration(WORKER_PATH);
  return (await registration?.pushManager.getSubscription()) ?? null;
}

/** Asks the browser's permission, then subscribes it with the gateway's key: the subscription to send, or why there is none. */
async function subscribed(webPushKey: string): Promise<{ readonly isOk: true; readonly value: PushSubscription } | { readonly isOk: false; readonly message: string }> {
  if ((await Notification.requestPermission()) !== 'granted') {
    return { isOk: false, message: 'Your browser did not allow notifications from this site: allow them, then turn web push on again' };
  }
  const registration = await navigator.serviceWorker.register(WORKER_PATH);
  await navigator.serviceWorker.ready;
  return { isOk: true, value: await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKeyOf(webPushKey) }) };
}

/**
 * Web push in the overview's section of wakes (wake a person, W8): the
 * person turns it on for this browser, which asks the browser's permission
 * first, sees the browsers they turned it on in, and removes one. Nothing is
 * on until they turn it on. A browser whose push service ended its
 * subscription is said to be gone.
 */
export function WebPushPanel({ fleetId, webPushKey, browsers }: { fleetId: string; webPushKey: string; browsers: WakeChannels['webPush']['browsers'] }) {
  const [isTaken, setIsTaken] = useState(true);
  const [ownEndpoint, setOwnEndpoint] = useState<string | undefined>();
  const [working, setWorking] = useState<string | undefined>();
  const [failure, setFailure] = useState<string | undefined>();
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (!isPushTaken()) {
      setIsTaken(false);
      return;
    }
    void ownSubscription().then((own) => {
      setOwnEndpoint(own?.endpoint);
    });
  }, []);

  const turnOn = () => {
    setWorking('on');
    setFailure(undefined);
    startTransition(async () => {
      try {
        const subscription = await subscribed(webPushKey);
        if (!subscription.isOk) {
          setFailure(subscription.message);
          return;
        }
        const input = subscriptionInputOf(subscription.value.toJSON(), browserNameOf(navigator.userAgent));
        if (input === undefined) {
          setFailure('Your browser gave no push subscription: try again');
          return;
        }
        const outcome = await turnOnWebPush(fleetId, input);
        if (outcome.isOk) {
          setOwnEndpoint(input.endpoint);
        } else {
          setFailure(outcome.message);
        }
      } catch {
        setFailure('Your browser could not turn web push on: try again');
      } finally {
        setWorking(undefined);
      }
    });
  };

  const remove = (endpoint: string) => {
    setWorking(endpoint);
    setFailure(undefined);
    startTransition(async () => {
      if (endpoint === ownEndpoint) {
        await (await ownSubscription())?.unsubscribe();
        setOwnEndpoint(undefined);
      }
      const outcome = await turnOffWebPush(fleetId, endpoint);
      setWorking(undefined);
      if (!outcome.isOk) {
        setFailure(outcome.message);
      }
    });
  };

  const isOwnOn = ownEndpoint !== undefined && browsers.some(({ endpoint, isGone }) => endpoint === ownEndpoint && !isGone);
  return (
    <div className="grid gap-2" data-testid="overview-wake-web-push">
      {browsers.map(({ endpoint, browser, addedAt, isGone }) => (
        <div key={endpoint} className="flex items-center gap-3 rounded-md border border-border bg-card p-3">
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate">
              Web push in {browser}
              {endpoint === ownEndpoint ? ' · this browser' : ''}
            </span>
            <span className="text-caption text-muted-foreground">
              {isGone ? 'No longer takes wakes: its push service ended them. Turn web push on again in that browser, or remove it.' : `On since ${new Date(addedAt).toLocaleDateString()}: it tells you when something waits in this fleet, with a link here. Never what waits.`}
            </span>
          </span>
          <ActionButton data-testid="overview-web-push-remove" isPending={working === endpoint} pendingLabel="Removing..." disabled={working !== undefined} onClick={() => { remove(endpoint); }}>
            Remove
          </ActionButton>
        </div>
      ))}
      {!isTaken ? (
        <p className="text-caption text-muted-foreground">This browser takes no web push.</p>
      ) : isOwnOn ? null : (
        <div>
          <ActionButton data-testid="overview-web-push-on" variant="primary" isPending={working === 'on'} pendingLabel="Turning on..." disabled={working !== undefined} onClick={turnOn}>
            Turn on web push in this browser
          </ActionButton>
        </div>
      )}
      {failure === undefined ? null : <Notice message={failure} isFailure />}
    </div>
  );
}

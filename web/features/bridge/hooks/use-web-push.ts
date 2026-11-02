'use client';

import { useEffect, useState, useTransition } from 'react';

import type { WakeChannels } from '../services/deliveries';
import { applicationServerKeyOf, browserNameOf, subscriptionInputOf } from '../services/web-push';
import { turnOffWebPush, turnOnWebPush } from './bridge-actions';

/** The service worker that shows a wake and opens Bridge when it is pressed. */
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
 * Web push in this browser (wake a person, W8): whether it takes web push,
 * its own subscription, turning it on, which asks the browser's permission
 * first, and removing a browser, this one or another.
 */
export function useWebPush({ fleetId, webPushKey }: { fleetId: string; webPushKey: string | null }) {
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
    if (webPushKey === null) {
      return;
    }
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

  return { isTaken, ownEndpoint, working, failure, turnOn, remove };
}

export type WebPushBrowsers = WakeChannels['webPush']['browsers'];

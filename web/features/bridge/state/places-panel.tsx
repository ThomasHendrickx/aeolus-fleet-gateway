'use client';

import { useState, useTransition } from 'react';

import { turnRoute, unlinkSlack } from '../hooks/bridge-actions';
import type { SlackLink } from '../hooks/read-bridge';
import { SLACK_LINK_PATH } from '../hooks/slack-link-path';
import { useWebPush } from '../hooks/use-web-push';
import type { WakeChannels } from '../services/deliveries';
import { chatCardOf, emailCardOf, emailTurnsOf, PLACE_NAMES, slackCardOf, webPushCardOf, type RoutingView } from '../services/routing';
import { ActionButton } from '../ui/action-button';
import { Notice } from '../ui/notice';
import { PlaceCard } from '../ui/place-card';
import { PLACE_ICONS } from '../ui/place-icons';

function SlackPlace({ fleetId, slackLink }: { fleetId: string; slackLink: SlackLink | null }) {
  const [isUnlinking, startTransition] = useTransition();
  const [failure, setFailure] = useState<string | undefined>();
  const card = slackCardOf(slackLink);

  const unlink = () => {
    setFailure(undefined);
    startTransition(async () => {
      const outcome = await unlinkSlack(fleetId);
      if (!outcome.isOk) {
        setFailure(outcome.message);
      }
    });
  };

  return (
    <PlaceCard place="slack" name={PLACE_NAMES.slack} Icon={PLACE_ICONS.slack} card={card}>
      {card.action === 'link' ? (
        <a
          href={`${SLACK_LINK_PATH}?${new URLSearchParams({ fleet: fleetId }).toString()}`}
          data-testid="bridge-slack-link"
          className="inline-flex h-7 items-center rounded-md bg-primary px-2.5 text-caption font-medium text-primary-foreground hover:bg-primary-hover"
        >
          Link Slack
        </a>
      ) : null}
      {card.action === 'unlink' ? (
        <ActionButton size="xs" data-testid="bridge-slack-unlink" isPending={isUnlinking} pendingLabel="Unlinking..." onClick={unlink}>
          Unlink
        </ActionButton>
      ) : null}
      {failure === undefined ? null : <Notice message={failure} isFailure />}
    </PlaceCard>
  );
}

function WebPushPlace({ fleetId, webPush }: { fleetId: string; webPush: WakeChannels['webPush'] | undefined }) {
  const browsers = webPush?.browsers ?? [];
  const { isTaken, ownEndpoint, working, failure, turnOn, remove } = useWebPush({ fleetId, webPushKey: webPush?.publicKey ?? null });
  const card = webPushCardOf({ isOffered: webPush !== undefined && webPush.publicKey !== null, isTaken, ownEndpoint, browsers });
  const others = browsers.filter(({ endpoint }) => card.action !== 'remove' || endpoint !== ownEndpoint);
  return (
    <PlaceCard place="web-push" name={PLACE_NAMES['web-push']} Icon={PLACE_ICONS['web-push']} card={card}>
      {card.action === 'remove' && ownEndpoint !== undefined ? (
        <ActionButton size="xs" data-testid="bridge-web-push-remove" isPending={working === ownEndpoint} pendingLabel="Removing..." disabled={working !== undefined} onClick={() => { remove(ownEndpoint); }}>
          Remove
        </ActionButton>
      ) : null}
      {card.action === 'turnOn' ? (
        <ActionButton size="xs" data-testid="bridge-web-push-on" isPending={working === 'on'} pendingLabel="Turning on..." disabled={working !== undefined} onClick={turnOn}>
          Turn on
        </ActionButton>
      ) : null}
      {others.map(({ endpoint, browser, isGone }) => (
        <span key={endpoint} data-testid="bridge-web-push-browser" className="flex w-full items-center gap-2 text-caption text-muted-foreground">
          <span className="min-w-0 flex-1">{isGone ? `${browser}: no longer takes wakes` : `Also on in ${browser}`}</span>
          <button type="button" data-testid="bridge-web-push-remove-other" disabled={working !== undefined} onClick={() => { remove(endpoint); }} className="underline hover:text-foreground disabled:opacity-50">
            {working === endpoint ? 'Removing...' : 'Remove'}
          </button>
        </span>
      ))}
      {failure === undefined ? null : <Notice message={failure} isFailure />}
    </PlaceCard>
  );
}

function EmailPlace({ fleetId, routing }: { fleetId: string; routing: RoutingView }) {
  const [isTurning, startTransition] = useTransition();
  const [failure, setFailure] = useState<string | undefined>();
  const card = emailCardOf({ isOffered: routing.offered.email, isOnForAnyJob: routing.jobs.some(({ places }) => places.email) });

  const turn = (isOn: boolean) => {
    setFailure(undefined);
    startTransition(async () => {
      for (const change of emailTurnsOf(routing, isOn)) {
        const outcome = await turnRoute({ fleet: fleetId, ...change });
        if (!outcome.isOk) {
          setFailure(outcome.message);
          return;
        }
      }
    });
  };

  return (
    <PlaceCard place="email" name={PLACE_NAMES.email} Icon={PLACE_ICONS.email} card={card}>
      {card.action === 'turnOn' || card.action === 'turnOff' ? (
        <ActionButton size="xs" data-testid="bridge-email-turn" isPending={isTurning} pendingLabel={card.action === 'turnOn' ? 'Turning on...' : 'Turning off...'} onClick={() => { turn(card.action === 'turnOn'); }}>
          {card.action === 'turnOn' ? 'Turn on' : 'Turn off'}
        </ActionButton>
      ) : null}
      {failure === undefined ? null : <Notice message={failure} isFailure />}
    </PlaceCard>
  );
}

/**
 * The places on top of Where things show (Bridge, section 8; the routing
 * mockup), each with its state and its one action: Slack linked or not, the
 * chats connected through the gateway, web push in this browser, and email.
 */
export function PlacesPanel({
  fleetId,
  routing,
  slackLink,
  chats,
  webPush,
}: {
  fleetId: string;
  routing: RoutingView;
  slackLink: SlackLink | null;
  chats: readonly string[];
  webPush: WakeChannels['webPush'] | undefined;
}) {
  return (
    <section aria-label="The places" className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
      <SlackPlace fleetId={fleetId} slackLink={slackLink} />
      <PlaceCard place="chat" name={PLACE_NAMES.chat} Icon={PLACE_ICONS.chat} card={chatCardOf(chats)} />
      <WebPushPlace fleetId={fleetId} webPush={webPush} />
      <EmailPlace fleetId={fleetId} routing={routing} />
    </section>
  );
}

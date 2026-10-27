'use client';

import { useState, useTransition } from 'react';

import { unlinkSlack } from '../hooks/overview-actions';
import type { SlackLink } from '../hooks/read-overview';
import { SLACK_LINK_PATH } from '../hooks/slack-link-path';
import { ActionButton } from '../ui/action-button';
import { Notice } from '../ui/notice';

/**
 * The person's Slack link (gateway scopes 9.3, 9.6): "Slack linked as
 * @mathilde in Acme" with Unlink, or Link Slack, which signs in with Slack.
 * Linked, the person talks to the fleet's bots in Slack, and sees a bot
 * ship's messages there.
 */
export function SlackLinkPanel({ fleetId, slackLink }: { fleetId: string; slackLink: SlackLink }) {
  const [isUnlinking, startTransition] = useTransition();
  const [failure, setFailure] = useState<string | undefined>();
  const { workspaceName, link } = slackLink;

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
    <section className="grid gap-2" aria-labelledby="overview-slack-heading">
      <h2 id="overview-slack-heading" className="text-section font-semibold">
        Slack
      </h2>
      <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-card p-3">
        <span data-testid="overview-slack-state" className="min-w-0 flex-1">
          {link === null ? `Not linked in ${workspaceName}` : `Slack linked as @${link.slackName} in ${workspaceName}`}
        </span>
        {link === null ? (
          <a
            href={`${SLACK_LINK_PATH}?${new URLSearchParams({ fleet: fleetId }).toString()}`}
            data-testid="overview-slack-link"
            className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-primary-foreground hover:bg-primary-hover"
          >
            Link Slack
          </a>
        ) : (
          <ActionButton data-testid="overview-slack-unlink" isPending={isUnlinking} pendingLabel="Unlinking..." onClick={unlink}>
            Unlink
          </ActionButton>
        )}
      </div>
      {failure === undefined ? null : <Notice message={failure} isFailure />}
    </section>
  );
}

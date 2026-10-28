'use client';

import { useState, useTransition } from 'react';

import { showAllInSlack, unlinkSlack } from '../hooks/overview-actions';
import type { SlackLink } from '../hooks/read-overview';
import { SLACK_LINK_PATH } from '../hooks/slack-link-path';
import { ActionButton } from '../ui/action-button';
import { Notice } from '../ui/notice';

/**
 * The person's Slack link (gateway scopes 9.3, 9.6): "Slack linked as
 * @mathilde in Acme" with Unlink, or Link Slack, which signs in with Slack.
 * Linked, the person talks to the fleet's bots in Slack, and sees a bot
 * ship's messages there; the switch Show everything that waits in Slack,
 * off until turned on, shows the other ships' messages there too (B5).
 */
export function SlackLinkPanel({ fleetId, slackLink }: { fleetId: string; slackLink: SlackLink }) {
  const [isUnlinking, startTransition] = useTransition();
  const [isTurning, startTurning] = useTransition();
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

  const turn = (isOn: boolean) => {
    setFailure(undefined);
    startTurning(async () => {
      const outcome = await showAllInSlack(fleetId, isOn);
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
      {link === null ? null : (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-card p-3">
          <span className="flex min-w-0 flex-1 flex-col">
            <span>Show everything that waits in Slack</span>
            <span data-testid="overview-slack-show-all-state" className="text-caption text-muted-foreground">
              {link.isShowingAll ? "On: every ship's messages show in Slack, the ones from ships that are not bots through the fleet's own bot." : "Off: only the bots' messages show in Slack."}
            </span>
          </span>
          <ActionButton data-testid="overview-slack-show-all" isPending={isTurning} pendingLabel={link.isShowingAll ? 'Turning off...' : 'Turning on...'} onClick={() => { turn(!link.isShowingAll); }}>
            {link.isShowingAll ? 'Turn off' : 'Turn on'}
          </ActionButton>
        </div>
      )}
      {failure === undefined ? null : <Notice message={failure} isFailure />}
    </section>
  );
}

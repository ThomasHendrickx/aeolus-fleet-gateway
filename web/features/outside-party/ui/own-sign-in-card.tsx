import type { inferRouterOutputs } from '@trpc/server';
import type { ReactNode } from 'react';

import type { GatewayRouter } from '../../../../src/adapters/trpc/router.js';
import { Outcome } from '../../forms/ui/outcome';
import { CARD } from '../../forms/ui/look';
import type { Tone } from '../../outside-parties/party-kinds';
import { StatusBadge, Tag } from '../../outside-parties/ui/status-badge';
import { dayAndTimeOf, whenWordsOf, type SignInOutcome, type SignInOutcomeKind } from '../own-sign-in';
import { Fact } from './fact';
import { RemoveSignInForm, SignInForm } from './own-sign-in-forms';

type OwnSignIn = inferRouterOutputs<GatewayRouter>['parties']['ownSignIn'];

/** Your sign-in as the page read it: the API's answer, no person ship in the fleet to sign in as, or why the API refused. */
export type OwnSignInRead = { kind: 'read'; own: OwnSignIn } | { kind: 'noPersonShip'; fleetName: string } | { kind: 'refused'; message: string };

const BADGES: Record<OwnSignIn['state'], { tone: Tone; label: string }> = {
  notSignedIn: { tone: 'ended', label: 'Not signed in' },
  signedIn: { tone: 'ok', label: 'Signed in' },
  lost: { tone: 'attention', label: 'Lost' },
};

/** How each outcome is said: its words and tone, and whether it is an alert. */
function saidOf(kind: SignInOutcomeKind, party: string): { message: string; tone: Tone; isAlert: boolean } {
  switch (kind) {
    case 'signedIn':
      return { message: `You are signed in to ${party}.`, tone: 'ok', isAlert: false };
    case 'removed':
      return { message: `Your sign-in to ${party} is removed.`, tone: 'ok', isAlert: false };
    case 'failed':
      return { message: 'The sign-in did not finish: press Sign in again.', tone: 'attention', isAlert: true };
    case 'turnedAway':
      return { message: `That ${party} account is another person's sign-in in this fleet: sign in as your own.`, tone: 'attention', isAlert: true };
    case 'cancelled':
      return { message: `You are not signed in to ${party}: the sign-in was cancelled or refused there.`, tone: 'ended', isAlert: false };
    case 'unavailable':
      return { message: `${party}'s sign-in did not answer: try again in a moment.`, tone: 'attention', isAlert: true };
  }
}

const NOTE_TONES: Record<Tone, string> = {
  waiting: 'border-tone-waiting-border bg-tone-waiting-bg text-tone-waiting-fg',
  active: 'border-tone-active-border bg-tone-active-bg text-tone-active-fg',
  ok: 'border-tone-ok-border bg-tone-ok-bg text-tone-ok-fg',
  attention: 'border-tone-attention-border bg-tone-attention-bg text-tone-attention-fg',
  ended: 'border-tone-ended-border bg-tone-ended-bg text-tone-ended-fg',
};

/** How the sign-in went, with the authorization server's error code beside it where it answered one. */
function Said({ outcome, party }: { outcome: SignInOutcome; party: string }) {
  const { message, tone, isAlert } = saidOf(outcome.kind, party);
  return (
    <>
      <p role={isAlert ? 'alert' : 'status'} className={`rounded-md border px-3 py-2 ${NOTE_TONES[tone]}`}>
        {message}
      </p>
      {outcome.serverError === null ? null : (
        <div>
          <Tag isMono>{outcome.serverError}</Tag>
        </div>
      )}
    </>
  );
}

function accountOf({ outsideAccount }: { outsideAccount: { subject: string | null; name: string | null } }): ReactNode {
  return outsideAccount.name ?? outsideAccount.subject ?? <span className="text-muted-foreground">Not known</span>;
}

function OwnBody({ own, fleetId, party, now }: { own: OwnSignIn; fleetId: string; party: string; now: Date }) {
  switch (own.state) {
    case 'notSignedIn':
      return (
        <>
          <p className="text-muted-foreground">Until you sign in, your ships&apos; calls to {party} are refused.</p>
          <SignInForm fleetId={fleetId} party={party} label="Sign in" kind="primary" />
        </>
      );
    case 'signedIn':
      return (
        <>
          <dl className="grid gap-3">
            <Fact label="Account">{accountOf(own)}</Fact>
            <Fact label="Signed in">{whenWordsOf(own.signedInAt, now)}</Fact>
            <Fact label="Last used">{own.lastUsedAt === null ? 'Not yet' : whenWordsOf(own.lastUsedAt, now)}</Fact>
          </dl>
          <div className="flex flex-wrap items-start gap-2">
            <SignInForm fleetId={fleetId} party={party} label="Sign in again" kind="secondary" />
            <RemoveSignInForm fleetId={fleetId} party={party} />
          </div>
        </>
      );
    case 'lost':
      return (
        <>
          <p>
            {party} refused to refresh it on {dayAndTimeOf(own.lost.at)}: <span className="font-mono text-code">{own.lost.why}</span>. Your ships&apos; calls to {party} are refused.
          </p>
          <dl className="grid gap-3">
            <Fact label="Account">{accountOf(own)}</Fact>
            <Fact label="Last used">{own.lastUsedAt === null ? 'Not yet' : whenWordsOf(own.lastUsedAt, now)}</Fact>
          </dl>
          <SignInForm fleetId={fleetId} party={party} label="Sign in again" kind="primary" />
        </>
      );
  }
}

/**
 * Your own sign-in to a server where each person signs in (decision 0067,
 * M2), between the server's facts and its tools: not signed in, signed in
 * as an outside account, or lost; how a sign-in went when the browser comes
 * back. Every account of the fleet with a person ship sees it (Q16).
 */
export function OwnSignInCard({ fleetId, party, read, outcome, now }: { fleetId: string; party: string; read: OwnSignInRead; outcome: SignInOutcome | null; now: Date }) {
  const badge = read.kind === 'read' ? BADGES[read.own.state] : null;
  return (
    <section className={`${CARD} grid gap-3`} data-testid="outside-party-sign-in">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-section font-semibold">Your sign-in</h2>
        {badge === null ? null : <StatusBadge tone={badge.tone} label={badge.label} />}
      </div>
      {read.kind === 'read' && outcome !== null ? <Said outcome={outcome} party={party} /> : null}
      {read.kind === 'read' ? (
        <OwnBody own={read.own} fleetId={fleetId} party={party} now={now} />
      ) : read.kind === 'noPersonShip' ? (
        <p className="text-muted-foreground">Signing in needs a person ship in {read.fleetName}.</p>
      ) : (
        <Outcome state={{ kind: 'refused', message: read.message }} />
      )}
    </section>
  );
}

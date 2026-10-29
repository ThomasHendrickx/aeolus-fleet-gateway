import type { inferRouterOutputs } from '@trpc/server';

import type { GatewayRouter } from '../../../../src/adapters/trpc/router.js';
import type { FormState } from '../../forms/form-state';
import { BUTTONS, CARD } from '../../forms/ui/look';
import { Outcome } from '../../forms/ui/outcome';
import type { Tone } from '../../outside-parties/party-kinds';
import { StatusBadge } from '../../outside-parties/ui/status-badge';
import { whenWordsOf } from '../own-sign-in';

/** A person's sign-in as the API answers it to an approver: never a token. */
export type PersonSignIn = inferRouterOutputs<GatewayRouter>['parties']['signIns']['grants'][number];

const BADGES: Record<PersonSignIn['state'], { tone: Tone; label: string }> = {
  signedIn: { tone: 'ok', label: 'Signed in' },
  lost: { tone: 'attention', label: 'Lost' },
};

/** How many rows the list shows while it is read. */
const SKELETON_ROWS = 3;

/** The person a sign-in is of: their person ship's name, or its id where the fleet answered no name. */
export function personOf(signIn: PersonSignIn): string {
  return signIn.personName ?? signIn.personShipId;
}

function accountOf({ outsideAccount }: PersonSignIn) {
  return outsideAccount.name ?? outsideAccount.subject ?? <span className="text-muted-foreground">Not known</span>;
}

function Heading({ count }: { count: number | null }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-section font-semibold">Everyone&apos;s sign-ins</h2>
      {count === null ? null : <span className="text-muted-foreground">{count}</span>}
    </div>
  );
}

function Head() {
  return (
    <thead className="max-sm:hidden">
      <tr className="border-b border-border text-left text-muted-foreground">
        <th className="h-10 px-2 font-medium">Person</th>
        <th className="h-10 px-2 font-medium">Account</th>
        <th className="h-10 px-2 font-medium">State</th>
        <th className="h-10 px-2 font-medium">Last used</th>
        <th className="h-10 px-2">
          <span className="sr-only">Remove</span>
        </th>
      </tr>
    </thead>
  );
}

/** Everyone's sign-ins while they are read: the heading and the table's shape. */
export function EveryonesSignInsSkeleton({ party }: { party: string }) {
  return (
    <section className={`${CARD} grid gap-3`} aria-busy="true" aria-label={`Reading everyone's sign-ins to ${party}`} data-testid="outside-party-sign-ins-skeleton">
      <Heading count={null} />
      <table className="w-full border-collapse max-sm:block">
        <Head />
        <tbody className="max-sm:grid">
          {Array.from({ length: SKELETON_ROWS }, (_, row) => (
            <tr key={row} className="border-b border-border last:border-b-0 max-sm:grid max-sm:gap-1 max-sm:py-3">
              <td className="h-12 px-2 max-sm:h-auto max-sm:px-0">
                <span className="block h-3.5 w-20 animate-pulse rounded-md bg-muted max-sm:w-2/5" />
              </td>
              <td className="h-12 px-2 max-sm:h-auto max-sm:px-0">
                <span className="block h-3.5 w-36 animate-pulse rounded-md bg-muted max-sm:w-3/4" />
              </td>
              <td className="h-12 px-2 max-sm:hidden">
                <span className="block h-3.5 w-16 animate-pulse rounded-md bg-muted" />
              </td>
              <td className="h-12 px-2 max-sm:hidden">
                <span className="block h-3.5 w-20 animate-pulse rounded-md bg-muted" />
              </td>
              <td className="max-sm:hidden" />
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** What the card shows now, and what each press asks of the part that holds it. */
export interface SignInsCardProps {
  party: string;
  /** When the page was read, so every row says its times from the same moment. */
  now: string;
  rows: readonly PersonSignIn[];
  /** Why the API refused the list, said in place of it. */
  refusal: string | null;
  hasMore: boolean;
  isLoadingMore: boolean;
  /** The person ship whose removal waits for a confirm. */
  confirming: string | null;
  /** The person ship whose removal is on its way. */
  removing: string | null;
  outcome: FormState;
  onRemove: (personShipId: string) => void;
  onConfirm: (signIn: PersonSignIn) => void;
  onKeep: () => void;
  onMore: () => void;
}

function Confirm({ signIn, party, isRemoving, onConfirm, onKeep }: { signIn: PersonSignIn; party: string; isRemoving: boolean; onConfirm: () => void; onKeep: () => void }) {
  const person = personOf(signIn);
  return (
    <div className="grid gap-2 rounded-md bg-muted p-3" data-testid="outside-party-sign-ins-confirm">
      <p>
        Remove {person}&apos;s sign-in? Their ships&apos; calls to {party} are refused until they sign in again.
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={BUTTONS.destructive} disabled={isRemoving} aria-busy={isRemoving} onClick={onConfirm} data-testid="outside-party-sign-ins-remove-confirmed">
          {isRemoving ? 'Removing…' : `Remove ${person}'s sign-in`}
        </button>
        <button type="button" className={BUTTONS.secondary} onClick={onKeep}>
          Keep
        </button>
      </div>
    </div>
  );
}

/**
 * Everyone's sign-ins to a server where each person signs in (decision 0067,
 * M3), for an account holding gateway:approve: each person, their outside
 * account, state and when last used, with Remove confirmed in place. A table
 * on a wide screen, a list on a phone, 20 a page with Show more.
 */
export function SignInsCard(props: SignInsCardProps) {
  const { party, now, rows, refusal, hasMore, isLoadingMore, confirming, removing, outcome } = props;
  const lastUsedOf = (signIn: PersonSignIn) => (signIn.lastUsedAt === null ? 'Not yet' : whenWordsOf(signIn.lastUsedAt, new Date(now)));
  return (
    <section className={`${CARD} grid gap-3`} data-testid="outside-party-sign-ins">
      <Heading count={refusal === null ? rows.length : null} />
      <Outcome state={outcome} />
      {refusal !== null ? (
        <Outcome state={{ kind: 'refused', message: refusal }} />
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground">Nobody has signed in yet.</p>
      ) : (
        <table className="w-full border-collapse max-sm:block">
          <Head />
          <tbody className="max-sm:grid">
            {rows.map((signIn) => {
              const badge = BADGES[signIn.state];
              const isConfirming = confirming === signIn.personShipId;
              const lastUsed = lastUsedOf(signIn);
              return [
                <tr key={signIn.personShipId} className={`border-b border-border max-sm:grid max-sm:grid-cols-[1fr_auto] max-sm:gap-1 max-sm:py-3 ${isConfirming ? 'border-b-0' : 'last:border-b-0'}`} data-testid="outside-party-sign-ins-row">
                  <td className="h-12 px-2 max-sm:col-start-1 max-sm:row-start-1 max-sm:h-auto max-sm:px-0 max-sm:font-medium">
                    {personOf(signIn)}
                    {signIn.isYours ? <span className="font-normal text-muted-foreground"> (you)</span> : null}
                  </td>
                  <td className="h-12 px-2 max-sm:col-span-2 max-sm:row-start-2 max-sm:h-auto max-sm:px-0 max-sm:text-muted-foreground">
                    {accountOf(signIn)}
                    <span className="sm:hidden"> · last used {signIn.lastUsedAt === null ? 'not yet' : lastUsed}</span>
                  </td>
                  <td className="h-12 px-2 max-sm:col-start-2 max-sm:row-start-1 max-sm:h-auto max-sm:px-0">
                    <StatusBadge tone={badge.tone} label={badge.label} />
                  </td>
                  <td className="h-12 px-2 text-muted-foreground max-sm:hidden">{lastUsed}</td>
                  <td className="h-12 px-2 text-right max-sm:col-span-2 max-sm:row-start-3 max-sm:h-auto max-sm:px-0 max-sm:text-left">
                    <button type="button" className={`${BUTTONS.secondary} ${isConfirming ? 'max-sm:hidden' : ''}`} onClick={() => { props.onRemove(signIn.personShipId); }} data-testid="outside-party-sign-ins-remove">
                      Remove
                    </button>
                  </td>
                </tr>,
                isConfirming ? (
                  <tr key={`${signIn.personShipId}-confirm`} className="border-b border-border last:border-b-0 max-sm:block max-sm:pb-3">
                    <td colSpan={5} className="pb-2 max-sm:block max-sm:pb-0">
                      <Confirm signIn={signIn} party={party} isRemoving={removing === signIn.personShipId} onConfirm={() => { props.onConfirm(signIn); }} onKeep={props.onKeep} />
                    </td>
                  </tr>
                ) : null,
              ];
            })}
          </tbody>
        </table>
      )}
      {refusal === null && hasMore ? (
        <div>
          <button type="button" className={BUTTONS.secondary} disabled={isLoadingMore} aria-busy={isLoadingMore} onClick={props.onMore} data-testid="outside-party-sign-ins-more">
            {isLoadingMore ? 'Showing more…' : 'Show more'}
          </button>
        </div>
      ) : null}
    </section>
  );
}

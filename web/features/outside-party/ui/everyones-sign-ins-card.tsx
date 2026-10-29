'use client';

import { useState, useTransition } from 'react';

import { IDLE, type FormState } from '../../forms/form-state';
import { readMoreSignIns, removePersonSignIn } from '../actions';
import { removedMessageOf, withNextPage } from '../everyones-sign-ins';
import { personOf, SignInsCard, type PersonSignIn } from './everyones-sign-ins';

/**
 * Everyone's sign-ins as an approver works on them (decision 0067, M3):
 * Remove asks to confirm in place, a removal is said above the list, and
 * Show more reads the next page only when pressed. The page refreshes from
 * the server after a removal, so your own sign-in above stays true too.
 */
export function EveryonesSignInsCard({ fleetId, party, now, first }: { fleetId: string; party: string; now: string; first: { grants: PersonSignIn[]; next: string | null } }) {
  const [more, setMore] = useState<PersonSignIn[]>([]);
  const [next, setNext] = useState(first.next);
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<FormState>(IDLE);
  const [isLoadingMore, startLoadingMore] = useTransition();
  const [, startRemoving] = useTransition();
  const rows = withNextPage(first.grants, more).filter(({ personShipId }) => !removed.has(personShipId));

  const remove = (signIn: PersonSignIn) => {
    setRemoving(signIn.personShipId);
    startRemoving(async () => {
      const done = await removePersonSignIn({ fleetId, name: party, personShipId: signIn.personShipId });
      setRemoving(null);
      setConfirming(null);
      if (done.isOk) {
        setRemoved((held) => new Set([...held, signIn.personShipId]));
        setOutcome({ kind: 'done', message: removedMessageOf({ person: personOf(signIn), party, isRevoked: done.isRevoked }) });
      } else {
        setOutcome({ kind: 'refused', message: done.message });
      }
    });
  };

  const showMore = () => {
    const after = next ?? rows.at(-1)?.personShipId;
    if (after === undefined) {
      return;
    }
    startLoadingMore(async () => {
      const page = await readMoreSignIns({ fleetId, name: party, after });
      if (page.isOk) {
        setMore((shown) => withNextPage(shown, page.grants));
        setNext(page.next);
      } else {
        setOutcome({ kind: 'refused', message: page.message });
      }
    });
  };

  return (
    <SignInsCard
      party={party}
      now={now}
      rows={rows}
      refusal={null}
      hasMore={next !== null}
      isLoadingMore={isLoadingMore}
      confirming={confirming}
      removing={removing}
      outcome={outcome}
      onRemove={(personShipId) => { setConfirming(personShipId); setOutcome(IDLE); }}
      onConfirm={remove}
      onKeep={() => { setConfirming(null); }}
      onMore={showMore}
    />
  );
}

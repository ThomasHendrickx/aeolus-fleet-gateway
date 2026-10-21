'use client';

import { useRef, useState, type SyntheticEvent } from 'react';

import { CARD } from '../../forms/ui/look';
import { HOLDER_FIELD } from '../services/authorize';

type Holder = 'account' | 'party';

/** The sign-in door that starts the sign-in through pagasae for the pick. */
const SIGN_IN_DOOR = '/authorize/sign-in';

/**
 * The two picks (Q1 a), each starting a sign-in through pagasae. The
 * button pressed says the sign-in is on its way at once; a second press
 * meanwhile sends nothing. The buttons stay enabled, so the browser still
 * sends the pick.
 */
export function PickHolder({ fields }: { fields: readonly [string, string][] }) {
  const [picked, setPicked] = useState<Holder | undefined>(undefined);
  const isSent = useRef(false);
  const onSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    if (isSent.current) {
      event.preventDefault();
      return;
    }
    isSent.current = true;
  };
  const pick = (holder: Holder) => () => {
    if (!isSent.current) {
      setPicked(holder);
    }
  };
  return (
    <form method="get" action={SIGN_IN_DOOR} onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2">
      {fields.map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <button type="submit" name={HOLDER_FIELD} value="account" onClick={pick('account')} aria-busy={picked === 'account'} data-testid="authorize-pick-account" className={`${CARD} grid gap-1 text-left hover:bg-accent`}>
        <strong>{picked === 'account' ? 'Signing in...' : 'Sign in as yourself'}</strong>
        <span className="text-muted-foreground">The client acts as you.</span>
      </button>
      <button type="submit" name={HOLDER_FIELD} value="party" onClick={pick('party')} aria-busy={picked === 'party'} data-testid="authorize-pick-party" className={`${CARD} grid gap-1 text-left hover:bg-accent`}>
        <strong>{picked === 'party' ? 'Signing in...' : 'Ask for access for this client'}</strong>
        <span className="text-muted-foreground">An approver of your fleet decides; the client then acts as its own party.</span>
      </button>
    </form>
  );
}

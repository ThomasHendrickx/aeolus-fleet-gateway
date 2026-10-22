'use client';

import { Button } from '@aeolus-fleet/common/header';
import { useState, type SyntheticEvent } from 'react';

import { HOLDER_FIELD, SIGN_IN_DOOR, signInAddressOf } from '../services/authorize';

type Holder = 'account' | 'party';

const PICKS = [
  { holder: 'account', label: 'Sign in as yourself', detail: 'The client acts as you.', variant: 'primary' },
  { holder: 'party', label: 'Ask for access for this client', detail: 'An approver of your fleet decides; the client then acts as its own party.', variant: 'secondary' },
] as const;

function isHolder(value: unknown): value is Holder {
  return value === 'account' || value === 'party';
}

/**
 * The two picks (Q1 a), each starting a sign-in through pagasae. The
 * button pressed shows the sign-in on its way at once and takes no second
 * press; as a loading button sends no pick, the page goes to the sign-in
 * door itself. Before the page's script runs, the form sends the pick.
 */
export function PickHolder({ fields }: { fields: readonly [string, string][] }) {
  const [picked, setPicked] = useState<Holder | undefined>(undefined);
  const onSubmit = (event: SyntheticEvent<HTMLFormElement, SubmitEvent>) => {
    event.preventDefault();
    const pressed = event.nativeEvent.submitter?.getAttribute('value');
    if (picked !== undefined || !isHolder(pressed)) {
      return;
    }
    setPicked(pressed);
    window.location.assign(signInAddressOf(fields, pressed));
  };
  return (
    <form method="get" action={SIGN_IN_DOOR} onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
      {fields.map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {PICKS.map(({ holder, label, detail, variant }) => (
        <div key={holder} className="grid content-start gap-2">
          <Button type="submit" name={HOLDER_FIELD} value={holder} variant={variant} isLoading={picked === holder} disabled={picked !== undefined && picked !== holder} data-testid={`authorize-pick-${holder}`}>
            {label}
          </Button>
          <span className="text-muted-foreground">{detail}</span>
        </div>
      ))}
    </form>
  );
}

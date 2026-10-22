'use client';

import { Button } from '@aeolus-fleet/common/header';
import { Hourglass, LogIn } from 'lucide-react';
import { useState, type SyntheticEvent } from 'react';

import { HOLDER_FIELD, SIGN_IN_DOOR, signInAddressOf } from '../services/authorize';

type Holder = 'account' | 'party';

const PICKS = [
  { holder: 'account', label: 'Sign in as yourself', detail: 'The client acts as you.', icon: <LogIn aria-hidden /> },
  { holder: 'party', label: 'Ask for access for this client', detail: 'An approver of your fleet decides; the client then acts as its own party.', icon: <Hourglass aria-hidden /> },
] as const;

/** A pick as a large tile: its icon above its label, what it means below, one column on a phone. */
const TILE = 'grid h-auto min-h-28 content-center justify-items-center gap-1 rounded-lg p-4 text-center whitespace-normal hover:border-primary hover:bg-card [&_svg:not([class*=size-])]:size-5';

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
    <form method="get" action={SIGN_IN_DOOR} onSubmit={onSubmit} className="grid gap-3 min-[481px]:grid-cols-2">
      {fields.map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {PICKS.map(({ holder, label, detail, icon }) => (
        <Button key={holder} type="submit" name={HOLDER_FIELD} value={holder} icon={icon} isLoading={picked === holder} disabled={picked !== undefined && picked !== holder} className={TILE} data-testid={`authorize-pick-${holder}`}>
          <strong>{label}</strong>
          <span className="font-normal text-muted-foreground">{detail}</span>
        </Button>
      ))}
    </form>
  );
}

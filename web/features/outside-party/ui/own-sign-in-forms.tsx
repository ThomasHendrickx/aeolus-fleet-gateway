'use client';

import { useActionState } from 'react';

import { FLEET_FIELD, IDLE } from '../../forms/form-state';
import type { ButtonKind } from '../../forms/ui/look';
import { Outcome } from '../../forms/ui/outcome';
import { SubmitButton } from '../../forms/ui/submit-button';
import { removeOwnSignIn, signInToParty } from '../actions';

function PartyFields({ fleetId, party }: { fleetId: string; party: string }) {
  return (
    <>
      <input type="hidden" name={FLEET_FIELD} value={fleetId} />
      <input type="hidden" name="name" value={party} />
    </>
  );
}

/** Sign in, or Sign in again: the browser goes to the server's authorization server. A refusal is said in place. */
export function SignInForm({ fleetId, party, label, kind }: { fleetId: string; party: string; label: string; kind: ButtonKind }) {
  const [refused, signIn] = useActionState(signInToParty, IDLE);
  return (
    <form action={signIn} className="grid gap-2">
      <Outcome state={refused} />
      <PartyFields fleetId={fleetId} party={party} />
      <div>
        <SubmitButton kind={kind} pending={`Opening ${party}…`} testId="outside-party-sign-in-start">
          {label}
        </SubmitButton>
      </div>
    </form>
  );
}

/** Remove: your sign-in is revoked where the server offers it, then dropped. A refusal is said in place. */
export function RemoveSignInForm({ fleetId, party }: { fleetId: string; party: string }) {
  const [refused, remove] = useActionState(removeOwnSignIn, IDLE);
  return (
    <form action={remove} className="grid gap-2">
      <Outcome state={refused} />
      <PartyFields fleetId={fleetId} party={party} />
      <div>
        <SubmitButton kind="secondary" pending="Removing…" testId="outside-party-sign-in-remove">
          Remove
        </SubmitButton>
      </div>
    </form>
  );
}

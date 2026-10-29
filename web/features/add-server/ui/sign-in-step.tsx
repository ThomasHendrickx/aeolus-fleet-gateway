'use client';

import { useActionState } from 'react';

import { FLEET_FIELD, IDLE } from '../../forms/form-state';
import { BUTTONS, CARD } from '../../forms/ui/look';
import { Outcome } from '../../forms/ui/outcome';
import { SubmitButton } from '../../forms/ui/submit-button';
import { inFleet } from '../../../lib/gateway-api/page-account';
import { partyPath } from '../../outside-parties/paths';
import { signInToParty } from '../../outside-party/actions';
import { SIGN_IN_STEPS } from '../steps';
import { Steps } from './steps';

/**
 * The last step of adding a server where each person signs in: the
 * approver signs in to it for themselves, and their sign-in reads its tools
 * (Q15). Later goes to its page, where they sign in when they choose.
 */
export function SignInStep({ fleetId, name }: { fleetId: string; name: string }) {
  const [refused, signIn] = useActionState(signInToParty, IDLE);
  return (
    <>
      <Steps names={SIGN_IN_STEPS} at={2} />
      <form action={signIn} className={`${CARD} grid gap-3`} data-testid="add-server-sign-in">
        <Outcome state={{ kind: 'done', message: `${name} is added.` }} />
        <Outcome state={refused} />
        <input type="hidden" name={FLEET_FIELD} value={fleetId} />
        <input type="hidden" name="name" value={name} />
        <p>Sign in to {name} for yourself. Its tools show after the first sign-in.</p>
        <div className="flex gap-2">
          <SubmitButton pending={`Opening ${name}…`} testId="add-server-sign-in-start">
            Sign in to {name}
          </SubmitButton>
          <a href={inFleet(partyPath(name), fleetId)} className={BUTTONS.secondary}>
            Later
          </a>
        </div>
      </form>
    </>
  );
}

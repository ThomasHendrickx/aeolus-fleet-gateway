'use client';

import { useState } from 'react';

import { FLEET_FIELD } from '../../forms/form-state';
import { addedCredentialKindOf, SIGN_IN_CREDENTIAL } from '../../forms/server-credential';
import { CredentialFields } from '../../forms/ui/credential-fields';
import { CARD, INPUT, LABEL } from '../../forms/ui/look';
import { SubmitButton } from '../../forms/ui/submit-button';
import { stepsOf } from '../steps';
import { Refused } from './refused';
import { Steps } from './steps';

/**
 * The first step: the server's address and its credential, with the check's
 * refusal where it was refused. A server where each person signs in goes on
 * to its owner with Next, unchecked; any other is checked first.
 */
export function AddressStep({ state, action, fleetId }: { state: { fields: Readonly<Record<string, string>>; refusal?: string | undefined }; action: (form: FormData) => void; fleetId: string }) {
  const [kind, setKind] = useState(addedCredentialKindOf(state.fields.credentialKind ?? ''));
  const isSignIn = kind === SIGN_IN_CREDENTIAL.kind;
  return (
    <>
      <Steps names={stepsOf(kind)} at={0} />
      <form action={action} className={`${CARD} grid gap-3`} data-testid="add-server-address">
        <input type="hidden" name={FLEET_FIELD} value={fleetId} />
        <Refused refusal={state.refusal} />
        <label className={LABEL}>
          <span>Streamable HTTP address</span>
          <input className={INPUT} type="url" name="url" defaultValue={state.fields.url ?? ''} placeholder="https://mcp.example.com/mcp" required />
        </label>
        <CredentialFields legend="The server's credential" fields={state.fields} noneHelp="The gateway sends no credential: for a server reached only on a private network." canEachPersonSignIn onKindChange={setKind} />
        <div>
          <SubmitButton pending={isSignIn ? 'Next…' : 'Checking the server…'} testId="add-server-check">
            {isSignIn ? 'Next' : 'Check the server'}
          </SubmitButton>
        </div>
      </form>
    </>
  );
}

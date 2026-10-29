/**
 * The steps of adding a server, as M1 numbers them. A server where each
 * person signs in has no tools to check before someone signs in, so the
 * gateway checks its sign-in when it is added, and the approver's own sign-in
 * comes last (decision 0067, Q15).
 */
import { SIGN_IN_CREDENTIAL, type AddedCredentialKind } from '../forms/server-credential';

export const CHECKED_STEPS = ['Address', 'Check', 'Owner'] as const;

export const SIGN_IN_STEPS = ['Address', 'Owner', 'Sign in'] as const;

/** The steps for a server with this credential. */
export function stepsOf(kind: AddedCredentialKind): typeof CHECKED_STEPS | typeof SIGN_IN_STEPS {
  return kind === SIGN_IN_CREDENTIAL.kind ? SIGN_IN_STEPS : CHECKED_STEPS;
}

'use client';

import { useActionState, type ReactNode } from 'react';

import { FLEET_FIELD, IDLE, type FormState } from '../form-state';
import type { ButtonKind } from './look';
import { Outcome } from './outcome';
import { SubmitButton } from './submit-button';

/** A page's form: its fields, the fleet it is for, its button, and how it ended. */
export function ActionForm({
  action,
  fleetId,
  children,
  submit,
  className = 'grid gap-3',
  testId,
}: {
  action: (previous: FormState, form: FormData) => Promise<FormState>;
  fleetId: string;
  children?: ReactNode;
  submit: { label: ReactNode; pending: string; kind?: ButtonKind };
  className?: string;
  testId?: string;
}) {
  const [state, formAction] = useActionState(action, IDLE);
  return (
    <form action={formAction} className={className} data-testid={testId}>
      <input type="hidden" name={FLEET_FIELD} value={fleetId} />
      {children}
      <div>
        <SubmitButton pending={submit.pending} {...(submit.kind === undefined ? {} : { kind: submit.kind })}>
          {submit.label}
        </SubmitButton>
      </div>
      <Outcome state={state} />
    </form>
  );
}

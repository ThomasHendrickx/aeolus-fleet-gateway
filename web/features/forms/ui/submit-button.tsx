'use client';

import type { ReactNode } from 'react';
import { useFormStatus } from 'react-dom';

import { BUTTONS, type ButtonKind } from './look';

/** A form's button: it says the form is on its way at once, and takes no second press meanwhile. */
export function SubmitButton({ children, pending, kind = 'primary', testId }: { children: ReactNode; pending: string; kind?: ButtonKind; testId?: string }) {
  const status = useFormStatus();
  return (
    <button type="submit" className={BUTTONS[kind]} disabled={status.pending} aria-busy={status.pending} data-testid={testId}>
      {status.pending ? pending : children}
    </button>
  );
}

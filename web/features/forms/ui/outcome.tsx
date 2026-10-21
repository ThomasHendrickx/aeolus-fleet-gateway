import type { FormState } from '../form-state';

/** How a form ended: what changed, or why it was refused. Nothing while it has not been sent. */
export function Outcome({ state, testId }: { state: FormState; testId?: string }) {
  switch (state.kind) {
    case 'idle':
      return null;
    case 'done':
      return (
        <p role="status" data-testid={testId} className="rounded-md border border-tone-ok-border bg-tone-ok-bg px-3 py-2 text-tone-ok-fg">
          {state.message}
        </p>
      );
    case 'refused':
    case 'openNetwork':
      return (
        <p role="alert" data-testid={testId} className="rounded-md border border-tone-attention-border bg-tone-attention-bg px-3 py-2 text-tone-attention-fg">
          {state.message}
        </p>
      );
  }
}

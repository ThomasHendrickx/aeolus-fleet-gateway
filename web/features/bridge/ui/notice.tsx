import { InlineError } from '@aeolus-fleet/ui';

/** What an action came to, said in place: a success as a status, a failure as an alert by the control. */
export function Notice({ message, isFailure }: { message: string; isFailure: boolean }) {
  return isFailure ? (
    <div data-testid="bridge-failure"><InlineError title={message} variant="section" /></div>
  ) : (
    <p role="status" data-testid="bridge-success" className="rounded-md border border-tone-ok-border bg-tone-ok-bg px-3 py-2 text-tone-ok-fg">
      {message}
    </p>
  );
}

/** What an action came to, said in place: a success as a status, a failure as an alert by the control. */
export function Notice({ message, isFailure }: { message: string; isFailure: boolean }) {
  return isFailure ? (
    <p role="alert" data-testid="overview-failure" className="rounded-md border border-tone-attention-border bg-tone-attention-bg px-3 py-2 text-tone-attention-fg">
      {message}
    </p>
  ) : (
    <p role="status" data-testid="overview-success" className="rounded-md border border-tone-ok-border bg-tone-ok-bg px-3 py-2 text-tone-ok-fg">
      {message}
    </p>
  );
}

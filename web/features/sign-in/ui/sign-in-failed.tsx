/** Why a sign-in or sign-out did not go through, as the gateway's server names it. */
const REASONS: Record<string, string> = {
  unknownSignIn: 'This sign-in is unknown, or took over 10 minutes.',
  otherBrowser: 'This sign-in was started in another browser, so it is not yours to finish.',
  pagasaeRefused: 'The sign-in service did not sign you in.',
  signOutUnavailable: 'The sign-in service did not answer, so you are still signed in. Try again in a moment.',
};

const UNKNOWN_REASON = 'The sign-in did not go through.';

/** A sign-in that did not go through: why, and the way to sign in again. */
export function SignInFailed({ reason }: { reason: string | undefined }) {
  return (
    <section className="rounded-lg border border-border bg-card p-6 text-card-foreground shadow-sm">
      <h2 className="text-heading font-semibold">The sign-in did not go through</h2>
      <p data-testid="sign-in-failed-reason" className="mt-2 text-muted-foreground">
        {(reason === undefined ? undefined : REASONS[reason]) ?? UNKNOWN_REASON}
      </p>
      <div className="mt-4">
        <a href="/sign-in/start" data-testid="sign-in-failed-again" className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-primary-foreground hover:bg-primary-hover">
          Sign in again
        </a>
      </div>
    </section>
  );
}

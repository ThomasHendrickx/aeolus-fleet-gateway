/** A gateway that signs no one in to its pages: said so, as there is no account to show the page as. */
export function NoSignIn() {
  return (
    <section className="rounded-lg border border-border bg-card p-6 text-card-foreground shadow-sm">
      <h2 className="text-heading font-semibold">This gateway signs no one in to its pages</h2>
      <p className="mt-2 text-muted-foreground">Its operator has not made it an app of the fleet&apos;s sign-in yet.</p>
    </section>
  );
}

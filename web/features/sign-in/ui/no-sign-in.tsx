import { CARD } from '../../forms/ui/look';

/** A gateway that is no app at pagasae signs no one in to its pages (header design H5). */
export function NoSignIn() {
  return (
    <section className={CARD} data-testid="no-sign-in">
      <h2 className="text-heading font-semibold">Nobody signs in here</h2>
      <p className="mt-2 text-muted-foreground">This gateway signs no one in to its pages: it is no app at pagasae.</p>
    </section>
  );
}

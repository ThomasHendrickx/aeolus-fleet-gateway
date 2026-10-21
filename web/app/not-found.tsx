import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Not found' };

/** An address with no page: said so, with the way to the Overview. */
export default function NotFound() {
  return (
    <section className="rounded-lg border border-border bg-card p-6 text-card-foreground shadow-sm">
      <h2 className="text-heading font-semibold">This page does not exist</h2>
      <div className="mt-4">
        <a href="/overview" data-testid="not-found-overview" className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-primary-foreground hover:bg-primary-hover">
          Go to the Overview
        </a>
      </div>
    </section>
  );
}

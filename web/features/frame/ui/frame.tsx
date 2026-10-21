import type { ReactNode } from 'react';

/**
 * Every page of the gateway's web app: the header on top, the page below.
 * The header slot takes the shared header (@aeolus-fleet/common/header,
 * header design H2) once common ships it.
 */
export function Frame({ header, children }: { header: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header data-testid="frame-header" className="flex h-14 items-center border-b border-border px-4">
        {header}
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}

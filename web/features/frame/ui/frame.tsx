import type { ReactNode } from 'react';

/**
 * Every page of the gateway's web app: the header on top, the page below.
 * The header is the one every Aeolus app shows (@aeolus-fleet/common/header,
 * header design H2) for an account signed in, else a plain bar.
 */
export function Frame({ header, children }: { header: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <div data-testid="frame-header" className="contents">
        {header}
      </div>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}

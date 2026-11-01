import type { ReactNode } from 'react';

/**
 * Bridge home's columns (home.html, states.html): what waits on the left and
 * Your fleet beside it on a wide screen, one under the other on a phone; a
 * banner, such as the record cannot be read, runs the whole width above both.
 */
export function HomeColumns({ banner, main, aside }: { banner?: ReactNode; main: ReactNode; aside: ReactNode }) {
  return (
    <div className="grid gap-4">
      {banner}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0">{main}</div>
        {aside}
      </div>
    </div>
  );
}

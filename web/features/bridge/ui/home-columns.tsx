import type { ReactNode } from 'react';

/**
 * Bridge home's columns (home.html, states.html): what waits on the left and
 * Your fleet beside it on a wide screen, one under the other on a phone; a
 * banner, such as the record cannot be read, runs the whole width above both.
 * While an item is open, it and its list take the whole width and Your fleet
 * steps out of sight, as decide.html and do.html draw it (aeolus-fleet#1538).
 */
export function HomeColumns({ banner, main, aside }: { banner?: ReactNode; main: ReactNode; aside: ReactNode }) {
  return (
    <div className="grid gap-4">
      {banner}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] has-[[data-testid=bridge-split]]:lg:grid-cols-1 has-[[data-testid=bridge-split]]:[&>:last-child]:hidden">
        <div className="min-w-0">{main}</div>
        {aside}
      </div>
    </div>
  );
}

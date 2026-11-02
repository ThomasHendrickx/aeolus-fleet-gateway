import type { ReactNode } from 'react';

/**
 * Bridge home's columns (home.html, states.html, design/bridge-fleet-width):
 * what waits on the left at its reading width, at most 44rem, and Your fleet
 * beside it taking the rest of the window, at least 20rem; one under the
 * other on a phone. The title row, then a banner, such as the record cannot
 * be read, run the whole width above both.
 * While an item is open, it and its list take the whole width and Your fleet
 * and the title row step out of sight, as decide.html and do.html draw it (aeolus-fleet#1538).
 */
export function HomeColumns({ heading, banner, main, aside }: { heading?: ReactNode; banner?: ReactNode; main: ReactNode; aside: ReactNode }) {
  return (
    <div className="grid gap-4 has-[[data-testid=bridge-split]]:[&>[data-testid=bridge-title-row]]:hidden">
      {heading}
      {banner}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,44rem)_minmax(20rem,1fr)] has-[[data-testid=bridge-split]]:lg:grid-cols-1 has-[[data-testid=bridge-split]]:[&>:last-child]:hidden">
        <div className="min-w-0">{main}</div>
        {aside}
      </div>
    </div>
  );
}

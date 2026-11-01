import type { ReactNode } from 'react';

/**
 * Bridge home's columns (home.html, states.html): what waits on the left and
 * Your fleet beside it on a wide screen, one under the other on a phone; the
 * title row, then a banner, such as the record cannot be read, run the whole
 * width above both.
 */
export function HomeColumns({ heading, banner, main, aside }: { heading?: ReactNode; banner?: ReactNode; main: ReactNode; aside: ReactNode }) {
  return (
    <div className="grid gap-4">
      {heading}
      {banner}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0">{main}</div>
        {aside}
      </div>
    </div>
  );
}

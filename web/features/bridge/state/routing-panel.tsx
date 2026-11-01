'use client';

import { useState, useTransition } from 'react';

import { turnRoute } from '../hooks/bridge-actions';
import { JOB_NAMES, PLACE_NAMES, ROUTED_PLACES, turnedMessageOf, type RoutedJob, type RoutedPlace, type RoutingView } from '../services/routing';
import { Notice } from '../ui/notice';

/** What a change came to, said by the grid. */
interface Said {
  readonly message: string;
  readonly isFailure: boolean;
}

/**
 * Routing per job (Bridge, section 8; the routing mockup): per job, the
 * places that show it besides Bridge, which always does. A switch turns a
 * place on or off at once; what it then shows is said beside the grid
 * (CC20). A place the gateway does not offer, or Slack before it is linked,
 * cannot be turned on; one on can always be turned off.
 */
export function RoutingPanel({ fleetId, routing, isSlackLinked }: { fleetId: string; routing: RoutingView; isSlackLinked: boolean }) {
  const [isTurning, startTransition] = useTransition();
  const [turning, setTurning] = useState<string | undefined>();
  const [said, setSaid] = useState<Said | undefined>();
  const isUsable = (place: RoutedPlace): boolean => routing.offered[place] && (place !== 'slack' || isSlackLinked);

  const turn = (change: { job: RoutedJob; place: RoutedPlace; isOn: boolean }) => {
    setSaid(undefined);
    setTurning(`${change.job}-${change.place}`);
    startTransition(async () => {
      const outcome = await turnRoute({ fleet: fleetId, ...change });
      setSaid(outcome.isOk ? { message: turnedMessageOf(change), isFailure: false } : { message: outcome.message, isFailure: true });
    });
  };

  return (
    <section className="grid gap-2" aria-labelledby="bridge-routing-heading">
      <h2 id="bridge-routing-heading" className="text-section font-semibold">
        Per job
      </h2>
      <div className="overflow-x-auto rounded-md border border-border bg-card">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-border text-caption text-muted-foreground">
              <th scope="col" className="p-3 font-medium">
                Job
              </th>
              <th scope="col" className="p-3 font-medium">
                Bridge
              </th>
              {ROUTED_PLACES.map((place) => (
                <th key={place} scope="col" className="p-3 font-medium">
                  {PLACE_NAMES[place]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {routing.jobs.map(({ job, places }) => (
              <tr key={job} data-testid="bridge-routing-job" className="border-b border-border last:border-b-0">
                <th scope="row" className="p-3 font-normal">
                  <span className="flex flex-col">
                    <span>{JOB_NAMES[job].name}</span>
                    <span className="text-caption text-muted-foreground">{JOB_NAMES[job].holds}</span>
                  </span>
                </th>
                <td className="p-3 text-caption text-muted-foreground">Always</td>
                {ROUTED_PLACES.map((place) => {
                  const isOn = places[place];
                  const key = `${job}-${place}`;
                  return (
                    <td key={place} className="p-3">
                      <button
                        type="button"
                        data-testid={`bridge-routing-${key}`}
                        aria-pressed={isOn}
                        aria-label={`${PLACE_NAMES[place]} for ${JOB_NAMES[job].name}`}
                        aria-busy={isTurning && turning === key}
                        disabled={isTurning || (!isOn && !isUsable(place))}
                        onClick={() => {
                          turn({ job, place, isOn: !isOn });
                        }}
                        className={`inline-flex h-7 min-w-12 items-center justify-center rounded-full px-3 text-caption disabled:cursor-not-allowed disabled:opacity-50 ${isOn ? 'bg-primary text-primary-foreground' : 'border border-border bg-card text-muted-foreground hover:bg-accent'}`}
                      >
                        {isOn ? 'On' : 'Off'}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {said === undefined ? null : <Notice message={said.message} isFailure={said.isFailure} />}
      <p className="text-caption text-muted-foreground">While a Bridge page is open in focus, web push and email do not wake you. Slack still posts: you turned it on, and Bridge keeps every item.</p>
    </section>
  );
}

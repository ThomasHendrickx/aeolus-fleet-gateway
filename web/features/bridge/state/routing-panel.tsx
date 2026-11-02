'use client';

import { CircleCheck } from 'lucide-react';
import { useState, useTransition } from 'react';

import { turnRoute } from '../hooks/bridge-actions';
import { JOB_NAMES, PLACE_NAMES, ROUTED_PLACES, turnedToastOf, type RoutedJob, type RoutedPlace, type RoutingToast, type RoutingView, type WaitingByJob } from '../services/routing';
import { Notice } from '../ui/notice';
import { BRIDGE_ICON, JOB_ICONS, PLACE_ICONS } from '../ui/place-icons';
import { RoutingSwitch } from '../ui/routing-switch';

/** Six columns on desktop: the job, Bridge, then each place. */
const ROW = 'sm:grid sm:grid-cols-[1.6fr_repeat(5,1fr)] sm:items-center sm:gap-3';

/** The toast after a change (the routing mockup): what the place now shows. */
function Toast({ toast }: { toast: RoutingToast }) {
  return (
    <div role="status" data-testid="bridge-routing-toast" className="flex max-w-[720px] gap-3 rounded-lg border border-border bg-popover py-3.5 pr-3.5 pl-4 text-popover-foreground shadow-lg">
      <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-tone-ok-fg" />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="font-medium">{toast.title}</span>
        <span className="text-caption text-muted-foreground">{toast.detail}</span>
      </span>
    </div>
  );
}

/** A place's cell: on desktop the switch in its column, on the phone a line with the place's name and the switch. */
function PlaceCell({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <span className="flex items-center justify-between sm:block">
      <span className="sm:hidden">{name}</span>
      {children}
    </span>
  );
}

/**
 * Routing per job (Bridge, section 8; the routing mockup): per job, the
 * places that show it besides Bridge, which always does. A switch turns a
 * place on or off at once; the toast then says what it shows (CC20). A
 * place the gateway does not offer, or Slack before it is linked, cannot be
 * turned on; one on can always be turned off. On desktop a table, on the
 * phone a card per job.
 */
export function RoutingPanel({ fleetId, routing, isSlackLinked, waitingByJob }: { fleetId: string; routing: RoutingView; isSlackLinked: boolean; waitingByJob: WaitingByJob }) {
  const [isTurning, startTransition] = useTransition();
  const [turning, setTurning] = useState<string | undefined>();
  const [toast, setToast] = useState<RoutingToast | undefined>();
  const [failure, setFailure] = useState<string | undefined>();
  const isUsable = (place: RoutedPlace): boolean => routing.offered[place] && (place !== 'slack' || isSlackLinked);

  const turn = (change: { job: RoutedJob; place: RoutedPlace; isOn: boolean; isChatOn: boolean }) => {
    setToast(undefined);
    setFailure(undefined);
    setTurning(`${change.job}-${change.place}`);
    startTransition(async () => {
      const { isChatOn, ...route } = change;
      const outcome = await turnRoute({ fleet: fleetId, ...route });
      if (outcome.isOk) {
        setToast(turnedToastOf({ ...route, waiting: waitingByJob[route.job], isChatOn }));
      } else {
        setFailure(outcome.message);
      }
    });
  };

  return (
    <section className="grid gap-3" aria-label="Per job">
      <div className="grid gap-3 sm:gap-0 sm:overflow-hidden sm:rounded-lg sm:border sm:border-border sm:bg-card">
        <div aria-hidden className={`hidden min-h-8 bg-muted px-4 text-caption font-medium text-muted-foreground ${ROW}`}>
          <span>Job</span>
          <span className="inline-flex items-center gap-1.5">
            <BRIDGE_ICON className="size-3.5" />
            Bridge
          </span>
          {ROUTED_PLACES.map((place) => {
            const Icon = PLACE_ICONS[place];
            return (
              <span key={place} className="inline-flex items-center gap-1.5">
                <Icon className="size-3.5" />
                {PLACE_NAMES[place]}
              </span>
            );
          })}
        </div>
        {routing.jobs.map(({ job, places }) => {
          const { Icon, tone } = JOB_ICONS[job];
          return (
            <div
              key={job}
              data-testid="bridge-routing-job"
              className={`flex flex-col gap-2 rounded-lg border border-border bg-card p-3 sm:min-h-[52px] sm:rounded-none sm:border-0 sm:border-t sm:px-4 sm:py-1.5 ${ROW}`}
            >
              <span className="flex flex-col gap-0.5">
                <span className="inline-flex items-center gap-1.5 font-semibold sm:font-medium">
                  <Icon aria-hidden className={`size-4 shrink-0 ${tone}`} />
                  {JOB_NAMES[job].name}
                </span>
                <span className="text-caption text-muted-foreground max-sm:hidden">{JOB_NAMES[job].holds}</span>
              </span>
              <PlaceCell name="Bridge">
                <RoutingSwitch isOn label={`Bridge for ${JOB_NAMES[job].name}`} isDisabled aside="Always" testId={`bridge-routing-${job}-bridge`} />
              </PlaceCell>
              {ROUTED_PLACES.map((place) => {
                const isOn = places[place];
                const key = `${job}-${place}`;
                return (
                  <PlaceCell key={place} name={PLACE_NAMES[place]}>
                    <RoutingSwitch
                      isOn={isOn}
                      label={`${PLACE_NAMES[place]} for ${JOB_NAMES[job].name}`}
                      isDisabled={isTurning || (!isOn && !isUsable(place))}
                      isBusy={isTurning && turning === key}
                      {...(job === 'everything-else' && place === 'slack' && !isOn ? { aside: 'Bots only' } : {})}
                      testId={`bridge-routing-${key}`}
                      onTurn={() => {
                        turn({ job, place, isOn: !isOn, isChatOn: places.chat });
                      }}
                    />
                  </PlaceCell>
                );
              })}
            </div>
          );
        })}
      </div>
      {toast === undefined ? null : <Toast toast={toast} />}
      {failure === undefined ? null : <Notice message={failure} isFailure />}
      <p className="text-caption text-muted-foreground max-sm:hidden">While a Bridge page is open in focus, web push and email do not wake you. Slack still posts: you turned it on, and the views stay in step.</p>
    </section>
  );
}

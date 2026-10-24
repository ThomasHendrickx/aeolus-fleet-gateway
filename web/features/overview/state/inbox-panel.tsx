'use client';

import { useState, useTransition } from 'react';

import { meetingPathOf } from '../../meeting/hooks/read-meeting';
import { answerDelivery, doneDelivery, openDelivery, type ActionOutcome } from '../hooks/overview-actions';
import type { FocusedDelivery, Inbox, InboxEntry } from '../services/deliveries';
import { DeliveryCard, type DeliveryControl } from '../ui/delivery-card';
import { InboxList } from '../ui/inbox-list';
import { Notice } from '../ui/notice';

/**
 * The person's inbox with one delivery in focus at a time. Opening is their
 * own act, so it is a press, never a link: the gateway acknowledges the
 * delivery for them, and it is shown whole, once. Answering or being done
 * says so in place, and the inbox reads itself again.
 */
export function InboxPanel({ fleetId, inbox }: { fleetId: string; inbox: Inbox }) {
  const [focus, setFocus] = useState<FocusedDelivery | undefined>();
  const [note, setNote] = useState('');
  const [openingId, setOpeningId] = useState<string | undefined>();
  const [working, setWorking] = useState<DeliveryControl | undefined>();
  const [openFailure, setOpenFailure] = useState<{ deliveryId: string; message: string } | undefined>();
  const [failure, setFailure] = useState<string | undefined>();
  const [done, setDone] = useState<string | undefined>();
  const [, startTransition] = useTransition();

  const show = (delivery: FocusedDelivery) => {
    setFocus(delivery);
    setNote('');
    setFailure(undefined);
    setDone(undefined);
  };

  const open = (entry: InboxEntry) => {
    setOpeningId(entry.deliveryId);
    setOpenFailure(undefined);
    setDone(undefined);
    startTransition(async () => {
      const outcome = await openDelivery(fleetId, entry.deliveryId);
      setOpeningId(undefined);
      if (outcome.isOk) {
        show(outcome.value);
      } else {
        setOpenFailure({ deliveryId: entry.deliveryId, message: outcome.message });
      }
    });
  };

  const settle = ({ control, action, said }: { control: DeliveryControl; action: () => Promise<ActionOutcome<undefined>>; said: string }) => {
    setWorking(control);
    setFailure(undefined);
    startTransition(async () => {
      const outcome = await action();
      setWorking(undefined);
      if (outcome.isOk) {
        setFocus(undefined);
        setDone(said);
      } else {
        setFailure(outcome.message);
      }
    });
  };

  if (focus !== undefined) {
    return (
      <DeliveryCard
        delivery={focus}
        meetingHref={focus.meetingId === undefined ? undefined : meetingPathOf({ fleetId, meetingId: focus.meetingId })}
        note={note}
        working={working}
        failure={failure}
        onNoteChange={setNote}
        onAnswer={(option) => { settle({ control: option === undefined ? { kind: 'note' } : { kind: 'option', option }, action: () => answerDelivery({ fleet: fleetId, deliveryId: focus.deliveryId, input: { questionId: focus.question?.id, option, note } }), said: `Your answer went to ${focus.from}.` }); }
        }
        onDone={() => { settle({ control: { kind: 'done' }, action: () => doneDelivery(fleetId, focus.deliveryId), said: `Done with “${focus.title}”.` }); }}
        onBack={() => { setFocus(undefined); }}
      />
    );
  }
  return (
    <div className="grid gap-4">
      {done === undefined ? null : <Notice message={done} isFailure={false} />}
      <InboxList
        waitingCount={inbox.waiting}
        waiting={inbox.deliveries}
        opened={inbox.opened}
        openingId={openingId}
        failure={openFailure}
        onOpen={open}
        onFocus={(entry) => { show({ ...entry, payload: undefined, question: undefined, meetingId: undefined }); }}
      />
    </div>
  );
}

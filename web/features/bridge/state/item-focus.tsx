'use client';

import { useState, useTransition, type ReactNode } from 'react';

import { meetingPathOf } from '../../meeting/paths';
import { inFleet } from '../../../lib/gateway-api/page-account';
import { answerDelivery, doneDelivery, openDelivery, putInBasket, removeFromBasket, type ActionOutcome } from '../hooks/bridge-actions';
import { BRIDGE_BASKET_PATH } from '../paths';
import type { FocusedDelivery } from '../services/deliveries';
import type { HomeItem } from '../services/items';
import { DeliveryCard, type DeliveryControl, type InBasket } from '../ui/delivery-card';
import { Notice } from '../ui/notice';

/** An item to open: by its delivery, with its job, and the answer to it in the basket, if any. */
export interface ToOpen {
  readonly deliveryId: string;
  readonly job: HomeItem['job'];
  readonly inBasket?: InBasket | null;
}

/** What a list of items gets to open one: the press, the one opening, and why one could not be opened. */
export interface ItemOpening {
  readonly open: (item: ToOpen) => void;
  readonly openingId: string | undefined;
  readonly failure: { deliveryId: string; message: string } | undefined;
}

/**
 * A list of Bridge's items with one in focus at a time. Opening is the
 * person's own act, so it is a press, never a link: the gateway acknowledges
 * the item for them, and it is shown whole. An alert or a notice seen is
 * done at once (CC16), so it shows with no answer to give, as does a
 * question its asker withdrew or replaced; a replaced one opens its
 * replacement. A question's answer goes in the basket (CC24), and comes
 * out of it there. Answering, being done or putting in the basket says so
 * in place, and the page reads itself again.
 */
export function ItemFocus({ fleetId, children }: { fleetId: string; children: (opening: ItemOpening) => ReactNode }) {
  const [focus, setFocus] = useState<{ delivery: FocusedDelivery; isDoneOnSeeing: boolean; inBasket: InBasket | null } | undefined>();
  const [note, setNote] = useState('');
  const [openingId, setOpeningId] = useState<string | undefined>();
  const [working, setWorking] = useState<DeliveryControl | undefined>();
  const [openFailure, setOpenFailure] = useState<{ deliveryId: string; message: string } | undefined>();
  const [failure, setFailure] = useState<string | undefined>();
  const [done, setDone] = useState<string | undefined>();
  const [, startTransition] = useTransition();

  const open = (item: ToOpen) => {
    setOpeningId(item.deliveryId);
    setOpenFailure(undefined);
    setDone(undefined);
    startTransition(async () => {
      const outcome = await openDelivery(fleetId, item.deliveryId);
      setOpeningId(undefined);
      if (outcome.isOk) {
        const inBasket = item.inBasket ?? null;
        setFocus({ delivery: outcome.value, isDoneOnSeeing: item.job === 'stay-aware', inBasket });
        setNote(inBasket?.note ?? '');
        setFailure(undefined);
      } else {
        setOpenFailure({ deliveryId: item.deliveryId, message: outcome.message });
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
    const { delivery, inBasket } = focus;
    const questionId = delivery.question?.id;
    return (
      <DeliveryCard
        key={delivery.deliveryId}
        delivery={delivery}
        isDoneOnSeeing={focus.isDoneOnSeeing}
        meetingHref={delivery.meetingId === undefined ? undefined : meetingPathOf({ fleetId, meetingId: delivery.meetingId })}
        basketHref={inFleet(BRIDGE_BASKET_PATH, fleetId)}
        inBasket={inBasket}
        note={note}
        working={working}
        failure={failure}
        onNoteChange={setNote}
        onAnswer={(option) => { settle({ control: option === undefined ? { kind: 'note' } : { kind: 'option', option }, action: () => answerDelivery({ fleet: fleetId, deliveryId: delivery.deliveryId, input: { questionId: delivery.question?.id, option, note } }), said: `Your answer went to ${delivery.from}.` }); }
        }
        onPut={(option) => { settle({ control: { kind: 'option', option }, action: () => putInBasket({ fleet: fleetId, deliveryId: delivery.deliveryId, option, note }), said: `Option ${String(option)} is in the basket, not sent: ${delivery.from} receives it when you send the basket.` }); }}
        onRemove={() => {
          if (questionId !== undefined) {
            settle({ control: { kind: 'remove' }, action: () => removeFromBasket(fleetId, questionId), said: `Your answer to “${delivery.title}” is out of the basket; the question still waits on you.` });
          }
        }}
        onDone={() => { settle({ control: { kind: 'done' }, action: () => doneDelivery(fleetId, delivery.deliveryId), said: `Done with “${delivery.title}”.` }); }}
        onOpen={(deliveryId) => { open({ deliveryId, job: 'decide' }); }}
        onBack={() => { setFocus(undefined); }}
      />
    );
  }
  return (
    <div className="grid gap-4">
      {done === undefined ? null : <Notice message={done} isFailure={false} />}
      {children({ open, openingId, failure: openFailure })}
    </div>
  );
}

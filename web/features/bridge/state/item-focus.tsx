'use client';

import { Toast } from '@base-ui/react/toast';
import { useState, useTransition, type ReactNode } from 'react';

import { meetingPathOf } from '../../meeting/paths';
import { inFleet } from '../../../lib/gateway-api/page-account';
import { answerDelivery, doneDelivery, openDelivery, putInBasket, putPickInBasket, removeFromBasket, type ActionOutcome } from '../hooks/bridge-actions';
import { BRIDGE_BASKET_PATH } from '../paths';
import type { FocusedDelivery } from '../services/deliveries';
import { openedScreenOf } from '../services/shell';
import type { HomeItem } from '../services/items';
import type { RoutedPlace } from '../services/routing';
import { BasketToasts, putToastOf } from '../ui/basket-toast';
import { DeliveryCard, type DeliveryControl, type InBasket, type Opened, type StepFinished } from '../ui/delivery-card';
import { ItemSplit } from '../ui/item-split';
import { Notice } from '../ui/notice';
import { SendMessageProvider, useSendMessage } from './send-message';
import { useOpenedItem } from './opened-item';

/** An item to open: by its delivery, with its job, whether an alert, whether it was new, and the answer to it in the basket, if any. A replacement opened from its stale item is new. */
export interface ToOpen {
  readonly deliveryId: string;
  readonly job: HomeItem['job'];
  readonly isAlert?: boolean;
  readonly state?: HomeItem['state'];
  readonly inBasket?: InBasket | null;
}

/** A question to put its asker's pick in the basket from its row: by its delivery, from its asker. */
export interface ToPut {
  readonly deliveryId: string;
  readonly from: string;
}

/** What a list of items gets to open one or put a pick in the basket from its row: the presses, the one opening or putting, and why one could not be. */
export interface ItemOpening {
  readonly open: (item: ToOpen) => void;
  readonly openingId: string | undefined;
  readonly putPick: (item: ToPut, option: number) => void;
  readonly puttingId: string | undefined;
  readonly failure: { deliveryId: string; message: string } | undefined;
  /** The item open beside the list, by its delivery and job; none while the list is shown alone. */
  readonly opened: { readonly deliveryId: string; readonly job: HomeItem['job'] } | undefined;
}

/**
 * A list of Bridge's items with one in focus at a time. Opening is the
 * person's own act, so it is a press, never a link: the gateway acknowledges
 * the item for them, and it is shown whole. An alert or a notice seen is
 * done at once (CC16), so it shows with no answer to give, as does a
 * question its asker withdrew or replaced; a replaced one opens its
 * replacement. A step ends done or cannot with the note, sent at once,
 * never through the basket (CC23), and stays open showing its outcome. A question's answer goes in the basket (CC24): the
 * question stays open saying so, with a toast (basket.html), and comes out
 * of it there; from its row, a new question's pick goes in it at once, opened by the same press. Answering or being done says so in place, and the page reads
 * itself again. A question names where it shows when the page read its places.
 * An opened alert offers to send its ship a message, as home offers to send
 * any ship one (aeolus-fleet #1547). The open item shows beside its list on
 * a desktop, and on its own screen on a phone (aeolus-fleet#1538).
 */
export function ItemFocus({ fleetId, decidePlaces, children }: { fleetId: string; decidePlaces?: readonly RoutedPlace[]; children: (opening: ItemOpening) => ReactNode }) {
  return (
    <SendMessageProvider fleetId={fleetId}>
      <Toast.Provider>
        <FocusedItems fleetId={fleetId} decidePlaces={decidePlaces}>{children}</FocusedItems>
        <BasketToasts />
      </Toast.Provider>
    </SendMessageProvider>
  );
}

function FocusedItems({ fleetId, decidePlaces, children }: { fleetId: string; decidePlaces?: readonly RoutedPlace[]; children: (opening: ItemOpening) => ReactNode }) {
  const toasts = Toast.useToastManager();
  const sendMessage = useSendMessage();
  const [focus, setFocus] = useState<{ delivery: FocusedDelivery; opened: Opened; inBasket: InBasket | null; finished: StepFinished | null } | undefined>();
  const [note, setNote] = useState('');
  const [openingId, setOpeningId] = useState<string | undefined>();
  const [puttingId, setPuttingId] = useState<string | undefined>();
  const [working, setWorking] = useState<DeliveryControl | undefined>();
  const [openFailure, setOpenFailure] = useState<{ deliveryId: string; message: string } | undefined>();
  const [failure, setFailure] = useState<string | undefined>();
  const [done, setDone] = useState<string | undefined>();
  const [, startTransition] = useTransition();
  // Each pick put from a row shows the list anew, as it is after a card: it reads the page as the action left it.
  const [shownTimes, setShownTimes] = useState(0);
  useOpenedItem(focus === undefined ? undefined : openedScreenOf(focus.opened.job), () => {
    setFocus(undefined);
  });

  const open = (item: ToOpen) => {
    setOpeningId(item.deliveryId);
    setOpenFailure(undefined);
    setDone(undefined);
    startTransition(async () => {
      const outcome = await openDelivery(fleetId, item.deliveryId);
      setOpeningId(undefined);
      if (outcome.isOk) {
        const inBasket = item.inBasket ?? null;
        setFocus({ delivery: outcome.value, opened: { job: item.job, isAlert: item.isAlert ?? false, wasNew: item.state !== 'seen' }, inBasket, finished: null });
        setNote(inBasket?.note ?? '');
        setFailure(undefined);
      } else {
        setOpenFailure({ deliveryId: item.deliveryId, message: outcome.message });
      }
    });
  };

  /** Opens a question and puts its asker's pick in the basket, with no note, from its row: nothing is sent (CC24). */
  const putPick = (item: ToPut, option: number) => {
    setPuttingId(item.deliveryId);
    setOpenFailure(undefined);
    setDone(undefined);
    startTransition(async () => {
      const outcome = await putPickInBasket({ fleet: fleetId, deliveryId: item.deliveryId, option });
      setPuttingId(undefined);
      if (outcome.isOk) {
        setDone(`Option ${String(option)} is in the basket, not sent: ${item.from} receives it when you send the basket.`);
        setShownTimes((times) => times + 1);
      } else {
        setOpenFailure({ deliveryId: item.deliveryId, message: outcome.message });
      }
    });
  };

  const settle = <T,>({ control, action, onSettled }: { control: DeliveryControl; action: () => Promise<ActionOutcome<T>>; onSettled: (value: T) => void }) => {
    setWorking(control);
    setFailure(undefined);
    startTransition(async () => {
      const outcome = await action();
      setWorking(undefined);
      if (outcome.isOk) {
        onSettled(outcome.value);
      } else {
        setFailure(outcome.message);
      }
    });
  };

  /** Back to the list, saying what was done. */
  const leave = (said: string) => () => {
    setFocus(undefined);
    setDone(said);
  };

  const cardOf = ({ delivery, inBasket, opened, finished }: NonNullable<typeof focus>) => {
    const questionId = delivery.question?.id;
    return (
      <DeliveryCard
        key={delivery.deliveryId}
        delivery={delivery}
        opened={opened}
        meetingHref={delivery.meetingId === undefined ? undefined : meetingPathOf({ fleetId, meetingId: delivery.meetingId })}
        basketHref={inFleet(BRIDGE_BASKET_PATH, fleetId)}
        inBasket={inBasket}
        finished={finished}
        places={decidePlaces}
        note={note}
        working={working}
        failure={failure}
        onNoteChange={setNote}
        onAnswer={(option) => { settle({ control: option === undefined ? { kind: 'note' } : { kind: 'option', option }, action: () => answerDelivery({ fleet: fleetId, deliveryId: delivery.deliveryId, input: { questionId: delivery.question?.id, option, note } }), onSettled: leave(`Your answer went to ${delivery.from}.`) }); }
        }
        onPut={(option) => { settle({ control: option === null ? { kind: 'note' } : { kind: 'option', option }, action: () => putInBasket({ fleet: fleetId, deliveryId: delivery.deliveryId, option, note }), onSettled: (put) => {
              setFocus({ delivery, opened, finished, inBasket: put });
              toasts.add(putToastOf(put.option));
            } }); }}
        onRemove={() => {
          if (questionId !== undefined) {
            settle({ control: { kind: 'remove' }, action: () => removeFromBasket(fleetId, questionId), onSettled: leave(`Your answer to “${delivery.title}” is out of the basket; the question still waits on you.`) });
          }
        }}
        onDone={() => { settle({ control: { kind: 'done' }, action: () => doneDelivery({ fleet: fleetId, deliveryId: delivery.deliveryId }), onSettled: leave(`Done with “${delivery.title}”.`) }); }}
        onFinishStep={(outcome) => {
          settle({
            control: { kind: outcome },
            action: () => doneDelivery({ fleet: fleetId, deliveryId: delivery.deliveryId, step: { outcome, note } }),
            onSettled: () => { setFocus({ delivery, inBasket, opened, finished: { outcome, note: note.trim(), at: new Date().toISOString() } }); },
          });
        }}
        onOpen={(deliveryId) => { open({ deliveryId, job: opened.job }); }}
        onSendMessage={delivery.alertShip === undefined || sendMessage === undefined ? undefined : (alertShip) => { sendMessage({ alertShip }); }}
        onBack={() => { setFocus(undefined); }}
      />
    );
  };

  const opened = focus === undefined ? undefined : { deliveryId: focus.delivery.deliveryId, job: focus.opened.job };
  return (
    <ItemSplit
      list={
        <div key={shownTimes} className="grid gap-4">
          {done === undefined ? null : <Notice message={done} isFailure={false} />}
          {children({ open, openingId, putPick, puttingId, failure: openFailure, opened })}
        </div>
      }
      item={focus === undefined ? undefined : cardOf(focus)}
    />
  );
}

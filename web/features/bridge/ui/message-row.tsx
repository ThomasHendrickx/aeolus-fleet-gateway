import { Check, CircleAlert } from 'lucide-react';

import type { BridgeHome } from '../services/items';
import { plainTextOf } from '../services/messages';
import { seenTextOf } from '../services/items';
import { ActionButton } from './action-button';
import { ItemRow } from './item-row';

type Message = BridgeHome['messages'][number];

/** What the row says of where it stands: Seen while it is the one open beside the list, else where it was seen; nothing while new. */
function outcomeOf({ message, isOpen }: { message: Message; isOpen: boolean }): string | undefined {
  if (isOpen) {
    return 'Seen';
  }
  return message.state === 'seen' ? seenTextOf(message.seenIn) : undefined;
}

/**
 * A plain message's row (#242, design/bridge-messages): the message icon, a
 * dot while new, its first line as the title and two lines of its text, both
 * as plain words; Message, its sender, where it was seen and its age; Done in
 * place and Open beneath. Done says Marking done... until the fleet answers,
 * and the row says so when it did not, Done staying to try again. Beside an
 * open item, no buttons.
 */
export function MessageRow({
  message,
  now,
  isOpen,
  isMarkingDone,
  isOpening,
  isBusy,
  failure,
  onDone,
  onOpen,
}: {
  message: Message;
  now: Date;
  isOpen: boolean;
  isMarkingDone: boolean;
  isOpening: boolean;
  /** Whether another press on the page is still waiting for its answer, so this one waits too. */
  isBusy: boolean;
  failure: string | undefined;
  /** Marks it done in place; none beside an open item, where the row has no buttons. */
  onDone: (() => void) | undefined;
  onOpen: (() => void) | undefined;
}) {
  const isBeside = onDone === undefined;
  const excerpt = isBeside ? '' : plainTextOf(message.excerpt);
  return (
    <ItemRow
      item={{ ...message, title: plainTextOf(message.title) }}
      now={now}
      isNew={message.state === 'new'}
      isOpen={isOpen}
      outcome={outcomeOf({ message, isOpen })}
      failure={undefined}
      onOpen={isBusy ? undefined : onOpen}
      detail={excerpt === '' ? undefined : <p className="line-clamp-2 max-w-[560px] break-words text-meta text-muted-foreground">{excerpt}</p>}
      actions={
        isBeside ? undefined : (
          <>
            <ActionButton data-testid="bridge-message-done" size="row" isPending={isMarkingDone} pendingLabel="Marking done..." disabled={isBusy} onClick={onDone}>
              <Check aria-hidden="true" className="size-3.5" />
              Done
            </ActionButton>
            <ActionButton data-testid="bridge-message-open" size="row" isPending={isOpening} pendingLabel="Opening..." disabled={isBusy} onClick={onOpen}>
              Open
            </ActionButton>
            {failure === undefined ? null : (
              <p role="alert" data-testid="bridge-message-failure" className="flex basis-full items-center gap-1.5 text-meta text-destructive-text">
                <CircleAlert aria-hidden="true" className="size-3.5 shrink-0" />
                {failure}
              </p>
            )}
          </>
        )
      }
    />
  );
}

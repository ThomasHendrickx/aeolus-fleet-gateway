import type { BridgeHome } from '../services/items';
import { plainTextOf } from '../services/messages';
import { seenTextOf } from '../services/items';
import { ActionButton } from './action-button';
import { ItemRow } from './item-row';

type Message = BridgeHome['messages'][number];

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
  const excerpt = plainTextOf(message.excerpt);
  return (
    <ItemRow
      item={{ ...message, title: plainTextOf(message.title) }}
      now={now}
      isNew={message.state === 'new'}
      isOpen={isOpen}
      outcome={message.state === 'seen' ? seenTextOf(message.seenIn) : undefined}
      failure={failure}
      onOpen={isBusy ? undefined : onOpen}
      detail={excerpt === '' ? undefined : <p className="line-clamp-2 break-words text-muted-foreground">{excerpt}</p>}
      actions={
        onDone === undefined ? undefined : (
          <>
            <ActionButton data-testid="bridge-message-done" size="row" isPending={isMarkingDone} pendingLabel="Marking done..." disabled={isBusy} onClick={onDone}>
              Done
            </ActionButton>
            <ActionButton data-testid="bridge-message-open" size="row" isPending={isOpening} pendingLabel="Opening..." disabled={isBusy} onClick={onOpen}>
              Open
            </ActionButton>
          </>
        )
      }
    />
  );
}

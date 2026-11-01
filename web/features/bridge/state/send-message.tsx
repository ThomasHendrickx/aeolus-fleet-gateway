'use client';

import { Dialog } from '@base-ui/react/dialog';
import { Toast } from '@base-ui/react/toast';
import { createContext, useContext, useRef, useState, useTransition, type ReactNode } from 'react';

import { readSendTo, sendShipMessage } from '../hooks/bridge-actions';
import { keyToSend, sendFailureOf, sentNoticeOf, type LastSend } from '../services/send-message';
import { SendMessageForm, type SendPhase, type SendToRead } from '../ui/send-message-form';
import { SentToasts } from '../ui/sent-toasts';

/** Opens the form to send a ship a message, with the ship filled in when it opens from an alert. */
type OpenSendMessage = (from?: { alertShip: string }) => void;

const SendMessageContext = createContext<OpenSendMessage | undefined>(undefined);

/** The opener of the form to send a ship a message, where a page offers it. */
export function useSendMessage(): OpenSendMessage | undefined {
  return useContext(SendMessageContext);
}

/** The form as it stands while open. */
interface Draft {
  readonly to: string | null;
  readonly isFromAlert: boolean;
  readonly message: string;
  readonly phase: SendPhase;
}

/**
 * Bridge's form to send a ship a message (aeolus-fleet #1547,
 * send-message.html), for the pages under it to open: from home, or from an
 * opened alert with its ship filled in. Opening reads who the person can
 * send to; Send goes as the person ship and waits until the fleet stored
 * it, then closes with a toast. It opens on what the person fills in first:
 * the ship from home, the message from an alert. A message is not an answer, so it never
 * goes through the basket. Cancel or close keeps nothing. A send sent again
 * with the same ship and message carries the same key, so it arrives once.
 */
function SendMessageDialog({ fleetId, children }: { fleetId: string; children: ReactNode }) {
  const [draft, setDraft] = useState<Draft | undefined>();
  const [sendTo, setSendTo] = useState<SendToRead>({ kind: 'reading' });
  const lastSend = useRef<LastSend | null>(null);
  const [, startTransition] = useTransition();
  const toasts = Toast.useToastManager();

  const open: OpenSendMessage = (from) => {
    lastSend.current = null;
    setDraft({ to: from?.alertShip ?? null, isFromAlert: from !== undefined, message: '', phase: { kind: 'writing' } });
    setSendTo({ kind: 'reading' });
    startTransition(async () => {
      const read = await readSendTo(fleetId);
      setSendTo(read.isOk ? { kind: 'read', value: read.value } : { kind: 'unreadable', message: read.message });
    });
  };

  const close = () => {
    setDraft(undefined);
  };

  const send = (sending: Draft & { to: string }) => {
    const key = keyToSend({ last: lastSend.current, to: sending.to, message: sending.message, newKey: crypto.randomUUID() });
    lastSend.current = { key, to: sending.to, message: sending.message };
    setDraft({ ...sending, phase: { kind: 'sending' } });
    startTransition(async () => {
      const sent = await sendShipMessage({ fleet: fleetId, to: sending.to, payload: sending.message, idempotencyKey: key });
      if (sent.isOk) {
        setDraft(undefined);
        const sentAs = sendTo.kind === 'read' ? sendTo.value.sentAs : 'your person ship';
        toasts.add({ ...sentNoticeOf({ to: sending.to, sentAs, storedAt: sent.value.storedAt }), timeout: 0 });
      } else {
        setDraft({ ...sending, phase: { kind: 'failed', failure: sendFailureOf(sent) } });
      }
    });
  };

  return (
    <SendMessageContext value={open}>
      {children}
      <Dialog.Root
        open={draft !== undefined}
        onOpenChange={(isOpen) => {
          if (!isOpen && draft?.phase.kind !== 'sending') {
            close();
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-40 bg-(--overlay)" />
          <Dialog.Popup
            data-testid="bridge-send-dialog"
            aria-label="Send a ship a message"
            initialFocus={() => document.getElementById(draft?.to === null ? 'bridge-send-to' : 'bridge-send-message')}
            className="fixed inset-0 z-50 bg-popover text-popover-foreground sm:inset-auto sm:top-[10vh] sm:left-1/2 sm:max-h-[80vh] sm:w-[min(34rem,calc(100vw-2rem))] sm:-translate-x-1/2 sm:overflow-auto sm:rounded-lg sm:border sm:border-border sm:shadow-lg"
          >
            {draft === undefined ? null : (
              <SendMessageForm
                sendTo={sendTo}
                to={draft.to}
                isFromAlert={draft.isFromAlert}
                message={draft.message}
                phase={draft.phase}
                onPick={(to) => { setDraft({ ...draft, to, isFromAlert: false, phase: { kind: 'writing' } }); }}
                onWrite={(message) => { setDraft({ ...draft, message, phase: draft.phase.kind === 'failed' && draft.phase.failure.kind === 'refused' ? draft.phase : { kind: 'writing' } }); }}
                onSend={() => {
                  if (draft.to !== null) {
                    send({ ...draft, to: draft.to });
                  }
                }}
                onClose={close}
              />
            )}
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
      <SentToasts />
    </SendMessageContext>
  );
}

/** Offers the pages under it the form to send a ship a message, and the toasts it raises once a message is stored. */
export function SendMessageProvider({ fleetId, children }: { fleetId: string; children: ReactNode }) {
  return (
    <Toast.Provider>
      <SendMessageDialog fleetId={fleetId}>{children}</SendMessageDialog>
    </Toast.Provider>
  );
}

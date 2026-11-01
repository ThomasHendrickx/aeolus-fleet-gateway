'use client';

import { Combobox } from '@base-ui/react/combobox';
import { CircleAlert, Info, LoaderCircle, RotateCw, Search, Send, Ship, X } from 'lucide-react';
import { useState } from 'react';

import { BUTTONS } from '../../forms/ui/look';
import { STATE_LABELS, type ShipState } from '../fleet/services/your-fleet';
import { isSendable, shipsMatching, type SendableShip, type SendFailure } from '../services/send-message';

/** Where the form stands: written in, on its way to the fleet, or failed, kept for the person. */
export type SendPhase = { readonly kind: 'writing' } | { readonly kind: 'sending' } | { readonly kind: 'failed'; readonly failure: SendFailure };

/** Who the person can send to, as the form read it on opening: reading, read, or why it could not be read. */
export type SendToRead =
  | { readonly kind: 'reading' }
  | { readonly kind: 'read'; readonly value: { readonly sentAs: string; readonly ships: readonly SendableShip[] } }
  | { readonly kind: 'unreadable'; readonly message: string };

/** Each state's tone, as Your fleet colours its word. */
const STATE_TONES: Record<ShipState, string> = {
  alert: 'bg-tone-attention-bg text-tone-attention-fg',
  waiting: 'bg-tone-waiting-bg text-tone-waiting-fg',
  working: 'bg-tone-ok-bg text-tone-ok-fg',
  idle: 'bg-tone-ended-bg text-tone-ended-fg',
};

const FIELD = 'flex min-h-9 w-full items-center gap-2 rounded-md border border-input bg-background px-2';

/** The ship picked, as a chip with its ship mark, and the button that clears it, on even while the form sends, as drawn. */
function PickedShip({ to, isLocked, onClear, isRefused }: { to: string; isLocked: boolean; onClear: () => void; isRefused: boolean }) {
  return (
    <div data-testid="bridge-send-to" className={`${FIELD} justify-between py-1 ${isLocked ? 'bg-muted' : ''} ${isRefused ? 'border-destructive ring-2 ring-tone-attention-border' : ''}`}>
      <span className="inline-flex items-center gap-1.5 rounded-sm border border-border bg-secondary px-1.5 py-0.5 font-mono text-code">
        <Ship aria-hidden="true" className="size-3.5 text-muted-foreground" />
        {to}
      </span>
      <button type="button" aria-label={`Clear ${to}`} onClick={onClear} className="inline-flex size-7 items-center justify-center rounded-md hover:bg-accent disabled:opacity-60">
        <X aria-hidden="true" className="size-4" />
      </button>
    </div>
  );
}

/**
 * Picks the ship to send to, filtered as the person types: the ships their
 * person ship may send to. The list opens in the form, under To and at its
 * full width, pushing Message down, as drawn.
 */
function ShipSearch({ sendTo, onPick }: { sendTo: SendToRead; onPick: (to: string) => void }) {
  const [typed, setTyped] = useState('');
  const [isListOpen, setIsListOpen] = useState(false);
  const ships = sendTo.kind === 'read' ? sendTo.value.ships : [];
  return (
    <Combobox.Root
      inline
      open={isListOpen}
      onOpenChange={setIsListOpen}
      items={ships}
      filteredItems={shipsMatching(ships, typed)}
      inputValue={typed}
      onInputValueChange={(value: string) => {
        setTyped(value);
        setIsListOpen(true);
      }}
      itemToStringLabel={(ship: SendableShip) => ship.name}
      value={null}
      onValueChange={(picked: SendableShip | null) => {
        if (picked !== null) {
          onPick(picked.name);
        }
      }}
      autoHighlight
    >
      <div className={`${FIELD} focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30`}>
        <Search aria-hidden="true" className="size-4 text-muted-foreground" />
        <Combobox.Input id="bridge-send-to" data-testid="bridge-send-to-search" placeholder="Search your fleet's ships" onFocus={() => { setIsListOpen(true); }} className="h-9 w-full bg-transparent outline-none" />
      </div>
      {isListOpen ? (
        <div data-testid="bridge-send-ships" className="max-h-72 overflow-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md">
          <div className="px-2 py-1 text-caption text-muted-foreground">Ships you can send to</div>
          <Combobox.Empty className="px-2 py-1 text-muted-foreground">
            {sendTo.kind === 'reading' ? 'Reading the ships you can send to...' : sendTo.kind === 'unreadable' ? sendTo.message : 'No ship you can send to matches.'}
          </Combobox.Empty>
          <Combobox.List>
            {(ship: SendableShip) => (
              <Combobox.Item key={ship.name} value={ship} className="flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 data-highlighted:bg-accent">
                <Ship aria-hidden="true" className="size-4 text-muted-foreground" />
                <span className="flex-1">{ship.name}</span>
                {ship.state === null ? null : <span className={`rounded-sm px-1 text-caption ${STATE_TONES[ship.state]}`}>{STATE_LABELS[ship.state]}</span>}
              </Combobox.Item>
            )}
          </Combobox.List>
        </div>
      ) : null}
    </Combobox.Root>
  );
}

/** What the form says under the message: sending, or why the last send failed and what the person can do. */
function PhaseLine({ phase }: { phase: SendPhase }) {
  switch (phase.kind) {
    case 'writing':
      return null;
    case 'sending':
      return (
        <p role="status" data-testid="bridge-send-sending" className="flex items-center gap-2">
          <LoaderCircle aria-hidden="true" className="size-4 animate-spin text-tone-waiting-fg" />
          Sending. Bridge waits until the fleet has stored it.
        </p>
      );
    case 'failed':
      return (
        <p role="alert" data-testid="bridge-send-failure" className="flex items-start gap-2 text-destructive-text">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {phase.failure.kind === 'noAnswer' ? 'The fleet did not answer, so it may not be stored. Your message is kept here. Send again: it carries the same key, so it arrives once.' : 'Not sent. Your message is kept here: pick another ship, or cancel.'}
        </p>
      );
  }
}

/**
 * The form to send a ship a message (send-message.html), inside its dialog:
 * To, the ship picked or searched among those the person ship may send to;
 * the message; and Send, off until both are there. While it sends the form
 * locks. Failed, the message stays: no answer offers Send again, under the
 * same key; a refusal says the fleet's reason under To, for another ship
 * to be picked. Sending locks the message, Cancel and Send only; Close and
 * the clear of the ship stay on, as drawn. The line saying the ship came
 * from the alert goes once a send was tried. On the phone it fills the
 * screen, Send full width.
 */
export function SendMessageForm({
  sendTo,
  to,
  isFromAlert,
  message,
  phase,
  onPick,
  onWrite,
  onSend,
  onClose,
}: {
  sendTo: SendToRead;
  to: string | null;
  /** Whether To was filled in from an opened alert and not changed since. */
  isFromAlert: boolean;
  message: string;
  phase: SendPhase;
  onPick: (to: string | null) => void;
  onWrite: (message: string) => void;
  onSend: () => void;
  onClose: () => void;
}) {
  const isSending = phase.kind === 'sending';
  const failure = phase.kind === 'failed' ? phase.failure : undefined;
  const isNoAnswer = failure?.kind === 'noAnswer';
  const sentAs = sendTo.kind === 'read' ? sendTo.value.sentAs : undefined;
  const sendLabel = isSending ? (
    <>
      <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
      Sending...
    </>
  ) : isNoAnswer ? (
    <>
      <RotateCw aria-hidden="true" className="size-4" />
      Send again
    </>
  ) : (
    <>
      <Send aria-hidden="true" className="size-4" />
      Send
    </>
  );
  const isSendOff = isSending || !isSendable({ to, message }) || failure?.kind === 'refused';
  return (
    <form
      data-testid="bridge-send-form"
      className="flex h-full flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        if (!isSendOff) {
          onSend();
        }
      }}
    >
      <div className="flex items-center gap-3 border-b border-border px-4 py-3 sm:border-0 sm:px-5 sm:pt-5 sm:pb-0">
        <button type="button" aria-label="Close" onClick={onClose} className="inline-flex size-8 items-center justify-center rounded-md hover:bg-accent disabled:opacity-60 sm:order-last sm:ml-auto">
          <X aria-hidden="true" className="size-5" />
        </button>
        <h2 className="text-heading font-semibold">Send a ship a message</h2>
      </div>
      <div className="grid flex-1 content-start gap-4 overflow-auto px-4 py-4 sm:px-5">
        <div className="grid gap-1.5">
          <label htmlFor="bridge-send-to" className="font-semibold">
            To
          </label>
          {to === null ? (
            <ShipSearch sendTo={sendTo} onPick={onPick} />
          ) : (
            <PickedShip to={to} isLocked={isSending} isRefused={failure?.kind === 'refused'} onClear={() => { onPick(null); }} />
          )}
          {failure?.kind === 'refused' ? (
            <span data-testid="bridge-send-refusal" className="text-destructive-text">
              {failure.reason}
            </span>
          ) : isFromAlert && to !== null && phase.kind === 'writing' ? (
            <span className="text-caption text-muted-foreground">Filled in from the alert; change it if you like.</span>
          ) : null}
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="bridge-send-message" className="font-semibold">
            Message
          </label>
          <textarea
            id="bridge-send-message"
            data-testid="bridge-send-message"
            disabled={isSending}
            rows={5}
            value={message}
            placeholder="Write what the ship should know or do."
            onChange={(event) => { onWrite(event.target.value); }}
            className="min-h-32 rounded-md border border-input bg-background px-3 py-2 disabled:bg-muted disabled:text-muted-foreground"
          />
          <span className="text-caption text-muted-foreground">Text or Markdown, up to 256 KB.</span>
        </div>
        <PhaseLine phase={phase} />
      </div>
      <div className="grid gap-3 border-t border-border px-4 py-3 sm:flex sm:items-center sm:justify-between sm:px-5">
        <span className="flex items-center gap-2 text-caption text-muted-foreground">
          <Info aria-hidden="true" className="size-4" />
          {sentAs === undefined ? 'Sent as your person ship.' : `Sent as ${sentAs}, your person ship.`}
        </span>
        <div className="flex gap-2">
          <button type="button" disabled={isSending} onClick={onClose} className="hidden h-9 items-center rounded-md px-4 font-medium hover:bg-accent disabled:opacity-60 sm:inline-flex">
            Cancel
          </button>
          <button type="submit" data-testid="bridge-send" disabled={isSendOff} aria-busy={isSending} className={`${BUTTONS.primary} h-11 w-full sm:h-9 sm:w-auto`}>
            {sendLabel}
          </button>
        </div>
      </div>
    </form>
  );
}

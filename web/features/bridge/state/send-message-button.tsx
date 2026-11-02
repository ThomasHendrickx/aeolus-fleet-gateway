'use client';

import { Send } from 'lucide-react';

import { useSendMessage } from './send-message';

/** In words beside home's title on a wider screen; its icon alone in the phone's top bar (the #1560 sheet). */
export type SendMessageLook = 'words' | 'icon';

/** Opens the form to send any ship a message (aeolus-fleet #1547), where the shell offers it. */
export function SendMessageButton({ look }: { look: SendMessageLook }) {
  const sendMessage = useSendMessage();
  if (sendMessage === undefined) {
    return null;
  }
  return (
    <button type="button" data-testid="bridge-send-message" aria-label="Send a ship a message" onClick={() => { sendMessage(); }} className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-md hover:bg-accent ${look === 'words' ? 'h-9 border border-border bg-card px-4 font-semibold' : 'size-8'}`}>
      <Send aria-hidden="true" className="size-4" />
      {look === 'words' ? <span>Send a ship a message</span> : null}
    </button>
  );
}

import { SendMessageButton } from '../../../web/features/bridge/state/send-message-button';

/**
 * Send a ship a message at a page heading's right end, in words, as home's
 * Waiting on you shows it and Messages too (#284). Kept off the phone, which
 * sends from its top bar.
 */
export function HeadingSendMessage() {
  return (
    <span className="max-sm:hidden">
      <SendMessageButton look="words" />
    </span>
  );
}

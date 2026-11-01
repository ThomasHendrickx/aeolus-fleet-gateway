import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SendMessageForm, type SendPhase, type SendToRead } from './send-message-form';

// The form to send a ship a message, as send-message.html draws each state.

const READ: SendToRead = { kind: 'read', value: { sentAs: 'argo', ships: ['builder-core', 'builder-gateway', 'builder-ui'] } };

const MESSAGE = "You have not reported for 2 h. Are you stuck on the waiter's restart test?";

function render(shown: { to?: string | null; isFromAlert?: boolean; message?: string; phase?: SendPhase; sendTo?: SendToRead }): string {
  const noop = () => undefined;
  const { to = null, isFromAlert = false, message = '', phase = { kind: 'writing' }, sendTo = READ } = shown;
  return renderToStaticMarkup(createElement(SendMessageForm, { sendTo, to, isFromAlert, message, phase, onPick: noop, onWrite: noop, onSend: noop, onClose: noop }));
}

function isSendOff(markup: string): boolean {
  return markup.includes('<button type="submit" data-testid="bridge-send" disabled=""');
}

describe('the form to send a ship a message (aeolus-fleet #1547)', () => {
  it('opens from home with nothing filled in, Send off, saying which person ship it is sent as', () => {
    const markup = render({});

    expect({
      search: markup.includes('data-testid="bridge-send-to-search"'),
      isSendOff: isSendOff(markup),
      sentAs: markup.includes('Sent as argo, your person ship.'),
      limit: markup.includes('Text or Markdown, up to 256 KB.'),
    }).toEqual({ search: true, isSendOff: true, sentAs: true, limit: true });
  });

  it("opens from an alert with the alert's ship filled in, saying so", () => {
    const markup = render({ to: 'builder-gateway', isFromAlert: true });

    expect({ picked: markup.includes('builder-gateway'), said: markup.includes('Filled in from the alert; change it if you like.'), isSendOff: isSendOff(markup) }).toEqual({ picked: true, said: true, isSendOff: true });
  });

  it('turns Send on once a ship is picked and something is written', () => {
    expect(isSendOff(render({ to: 'builder-gateway', message: MESSAGE }))).toBe(false);
  });

  it('locks while it sends, saying Bridge waits until the fleet stored it', () => {
    const markup = render({ to: 'builder-gateway', message: MESSAGE, phase: { kind: 'sending' } });

    expect({ locked: markup.includes('<fieldset disabled=""'), said: markup.includes('Sending. Bridge waits until the fleet has stored it.'), sending: markup.includes('Sending...') }).toEqual({ locked: true, said: true, sending: true });
  });

  it('keeps the message when the fleet did not answer, offering Send again under the same key', () => {
    const markup = render({ to: 'builder-gateway', message: MESSAGE, phase: { kind: 'failed', failure: { kind: 'noAnswer' } } });

    expect({
      kept: markup.includes('Are you stuck on the waiter'),
      said: markup.includes('The fleet did not answer, so it may not be stored. Your message is kept here. Send again: it carries the same key, so it arrives once.'),
      again: markup.includes('Send again'),
      isSendOff: isSendOff(markup),
    }).toEqual({ kept: true, said: true, again: true, isSendOff: false });
  });

  it("keeps the message when the fleet refused it, with the fleet's reason under To, Send off until another ship is picked", () => {
    const markup = render({ to: 'builder-gateway', message: MESSAGE, phase: { kind: 'failed', failure: { kind: 'refused', reason: 'The fleet did not take your message: No active ship is named builder-gateway' } } });

    expect({
      reason: markup.includes('The fleet did not take your message: No active ship is named builder-gateway'),
      said: markup.includes('Not sent. Your message is kept here: pick another ship, or cancel.'),
      isSendOff: isSendOff(markup),
    }).toEqual({ reason: true, said: true, isSendOff: true });
  });
});

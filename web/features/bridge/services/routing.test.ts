import { describe, expect, it } from 'vitest';

import { chatCardOf, emailCardOf, emailTurnsOf, slackCardOf, turnedToastOf, waitingByJobOf, webPushCardOf } from './routing';

// Where things show (Bridge, section 8; the routing mockup): the toast after
// a change says what the place now shows (CC20), and each place card says its
// state.

describe('the toast after a change of routing', () => {
  it('says a push place turned on shows only what arrives from now on, those already waiting staying in Bridge and in a chat', () => {
    expect(turnedToastOf({ job: 'decide', place: 'slack', isOn: true, waiting: 2, isChatOn: true })).toEqual({
      title: 'Slack is on for Decide',
      detail: 'Slack shows questions that arrive from now on. The 2 already waiting stay in Bridge and in a chat.',
    });
  });

  it('says the one already waiting stays in Bridge alone while no chat shows the job', () => {
    expect(turnedToastOf({ job: 'do', place: 'web-push', isOn: true, waiting: 1, isChatOn: false })).toEqual({
      title: 'Web push is on for Do what only you can',
      detail: 'Web push shows steps that arrive from now on. The 1 already waiting stays in Bridge.',
    });
  });

  it('says nothing of what waits when none of the job waits', () => {
    expect(turnedToastOf({ job: 'stay-aware', place: 'email', isOn: true, waiting: 0, isChatOn: true }).detail).toBe('Email shows alerts and notices that arrive from now on.');
  });

  it('says nothing of what waits for a job with no count', () => {
    expect(turnedToastOf({ job: 'everything-else', place: 'slack', isOn: true, waiting: undefined, isChatOn: true }).detail).toBe('Slack shows messages that arrive from now on.');
  });

  it('says a chat turned on lists every item of the job not done', () => {
    expect(turnedToastOf({ job: 'decide', place: 'chat', isOn: true, waiting: 2, isChatOn: true })).toEqual({
      title: 'A chat is on for Decide',
      detail: 'A chat lists every question not done when you ask it.',
    });
  });

  it('says a place turned off no longer shows the job, Bridge keeping every item', () => {
    expect(turnedToastOf({ job: 'stay-aware', place: 'web-push', isOn: false, waiting: 3, isChatOn: true })).toEqual({ title: 'Web push is off for Stay aware', detail: 'Bridge keeps every item.' });
  });

  it("says Slack off for everything else still shows a bot ship's messages there", () => {
    expect(turnedToastOf({ job: 'everything-else', place: 'slack', isOn: false, waiting: undefined, isChatOn: true }).detail).toBe("Bots only: a bot ship's messages and replies to Slack still show there. Bridge keeps every item.");
  });
});

describe('what already waits per job, for the toast', () => {
  it('counts what waits by its job, and the unseen to stay aware of', () => {
    const waiting = [{ job: 'decide' }, { job: 'do' }, { job: 'decide' }] as const;

    expect(waitingByJobOf({ waiting, stayAware: 4 })).toEqual({ decide: 2, do: 1, 'stay-aware': 4, 'everything-else': undefined });
  });
});

describe("Slack's place card", () => {
  it('says Linked as the Slack name in the workspace', () => {
    expect(slackCardOf({ workspaceName: 'Aeolus', link: { slackName: 'thomas' } })).toEqual({
      state: { label: 'Linked', isOk: true },
      description: 'As @thomas in Aeolus. A button press or a thread reply there is yours.',
      action: 'unlink',
    });
  });

  it('says Not linked, with Link Slack', () => {
    expect(slackCardOf({ workspaceName: 'Aeolus', link: null })).toEqual({
      state: { label: 'Not linked', isOk: false },
      description: 'Link your Slack account in Aeolus to see items there and answer them.',
      action: 'link',
    });
  });

  it('says Not connected, with nothing to do, where the fleet has no Slack workspace', () => {
    expect(slackCardOf(null)).toEqual({ state: { label: 'Not connected', isOk: false }, description: 'This fleet has no Slack workspace.', action: 'none' });
  });
});

describe("a chat's place card", () => {
  it('says Connected, naming the chats', () => {
    expect(chatCardOf(['ChatGPT', 'claude.ai'])).toEqual({ state: { label: 'Connected', isOk: true }, description: 'ChatGPT and claude.ai, through the gateway. Lists what waits when you ask it.', action: 'none' });
  });

  it('says Not connected while no chat is signed in', () => {
    expect(chatCardOf([])).toEqual({
      state: { label: 'Not connected', isOk: false },
      description: 'claude.ai or another MCP client, through the gateway. Lists what waits when you ask it.',
      action: 'none',
    });
  });
});

describe("web push's place card", () => {
  const CHROME = { endpoint: 'https://push.example/chrome', browser: 'Chrome on Linux', isGone: false };

  it('says This browser, with Remove, while it is on here', () => {
    expect(webPushCardOf({ isOffered: true, isTaken: true, ownEndpoint: CHROME.endpoint, browsers: [CHROME] })).toEqual({
      state: { label: 'This browser', isOk: true },
      description: 'Chrome on Linux. Says only that something waits, with a link here.',
      action: 'remove',
    });
  });

  it('says Off, with Turn on, while it is not on here', () => {
    expect(webPushCardOf({ isOffered: true, isTaken: true, ownEndpoint: undefined, browsers: [CHROME] })).toEqual({
      state: { label: 'Off', isOk: false },
      description: 'Says only that something waits, with a link here. Nothing is on until you turn it on.',
      action: 'turnOn',
    });
  });

  it('says Off where this browser was on and its push service ended it', () => {
    expect(webPushCardOf({ isOffered: true, isTaken: true, ownEndpoint: CHROME.endpoint, browsers: [{ ...CHROME, isGone: true }] }).action).toBe('turnOn');
  });

  it('says this browser takes no web push, with nothing to do', () => {
    expect(webPushCardOf({ isOffered: true, isTaken: false, ownEndpoint: undefined, browsers: [] })).toEqual({ state: { label: 'Off', isOk: false }, description: 'This browser takes no web push.', action: 'none' });
  });

  it('says Not offered where the gateway sends no web push', () => {
    expect(webPushCardOf({ isOffered: false, isTaken: true, ownEndpoint: undefined, browsers: [] })).toEqual({ state: { label: 'Not offered', isOk: false }, description: 'This gateway sends no web push.', action: 'none' });
  });
});

describe("email's place card", () => {
  it('says Off, with Turn on, while no job wakes by email', () => {
    expect(emailCardOf({ isOffered: true, isOnForAnyJob: false })).toEqual({
      state: { label: 'Off', isOk: false },
      description: 'Says only that something waits, with a link here. Nothing is on until you turn it on.',
      action: 'turnOn',
    });
  });

  it('says On, with Turn off, while a job wakes by email', () => {
    expect(emailCardOf({ isOffered: true, isOnForAnyJob: true })).toEqual({ state: { label: 'On', isOk: true }, description: 'Says only that something waits, with a link here.', action: 'turnOff' });
  });

  it('says Not offered where the gateway sends no email', () => {
    expect(emailCardOf({ isOffered: false, isOnForAnyJob: false })).toEqual({ state: { label: 'Not offered', isOk: false }, description: 'This gateway sends no email.', action: 'none' });
  });
});

describe("what email's Turn on and Turn off change", () => {
  const routing = {
    offered: { slack: true, chat: true, 'web-push': true, email: true },
    jobs: [
      { job: 'decide', places: { slack: false, chat: true, 'web-push': false, email: false } },
      { job: 'do', places: { slack: false, chat: true, 'web-push': false, email: true } },
      { job: 'stay-aware', places: { slack: false, chat: true, 'web-push': false, email: true } },
      { job: 'everything-else', places: { slack: false, chat: true, 'web-push': false, email: false } },
    ],
  } as const;

  it('turns email on for what waits on you, Decide and Do, where it is off', () => {
    expect(emailTurnsOf(routing, true)).toEqual([{ job: 'decide', place: 'email', isOn: true }]);
  });

  it('turns email off for every job it is on for', () => {
    expect(emailTurnsOf(routing, false)).toEqual([
      { job: 'do', place: 'email', isOn: false },
      { job: 'stay-aware', place: 'email', isOn: false },
    ]);
  });
});

import { describe, expect, it } from 'vitest';

import { aClientCall, aCallReply } from '../../../test/support/mcp-in-fakes.js';
import { stateOf, stateSince } from './client-call.js';

const SENT_AT = new Date('2026-10-19T12:00:00.000Z');
const DEADLINE = new Date('2026-10-19T12:10:00.000Z');
const BEFORE_DEADLINE = new Date('2026-10-19T12:09:59.999Z');
const RESULT_TYPE = 'application/vnd.aeolus.mcp-result+json; name=list_deals';

describe("which reply completes an outside client's call, and when it fails (interop 3.4)", () => {
  it('is submitted while no reply came', () => {
    expect(stateOf(aClientCall({ sentAt: SENT_AT, deadlineAt: DEADLINE }), BEFORE_DEADLINE)).toEqual({ state: 'submitted' });
  });

  it("is working once a reply of another type came: a status, not the answer", () => {
    const call = aClientCall({ outputContentType: RESULT_TYPE, deadlineAt: DEADLINE, replies: [aCallReply({ contentType: 'text/plain', payload: 'Looking it up.' })] });

    expect(stateOf(call, BEFORE_DEADLINE)).toEqual({ state: 'working' });
  });

  it("is completed by the first reply of the capability's stated output type, which is its answer", () => {
    const call = aClientCall({
      outputContentType: RESULT_TYPE,
      deadlineAt: DEADLINE,
      replies: [aCallReply({ contentType: 'text/plain', payload: 'Looking it up.' }), aCallReply({ contentType: RESULT_TYPE, payload: '{"content":[]}' }), aCallReply({ contentType: RESULT_TYPE, payload: 'later' })],
    });

    expect(stateOf(call, BEFORE_DEADLINE)).toEqual({ state: 'completed', answer: { contentType: RESULT_TYPE, payload: '{"content":[]}' } });
  });

  it('reads the output type as a media type: its case and the spaces around its parameters do not matter', () => {
    const call = aClientCall({ outputContentType: RESULT_TYPE, deadlineAt: DEADLINE, replies: [aCallReply({ contentType: 'Application/Vnd.Aeolus.Mcp-Result+JSON;name=list_deals' })] });

    expect(stateOf(call, BEFORE_DEADLINE)).toMatchObject({ state: 'completed' });
  });

  it.each([
    { what: 'plain text completes it', contentType: 'text/plain; charset=utf-8', state: 'completed' },
    { what: 'JSON does not', contentType: 'application/json', state: 'working' },
  ])('from a ship that stated no output type, $what', ({ contentType, state }) => {
    const call = aClientCall({ outputContentType: null, deadlineAt: DEADLINE, replies: [aCallReply({ contentType })] });

    expect(stateOf(call, BEFORE_DEADLINE)).toMatchObject({ state });
  });

  it('fails at its deadline with no completing reply, and not a millisecond before', () => {
    const call = aClientCall({ deadlineAt: DEADLINE });

    expect([stateOf(call, BEFORE_DEADLINE), stateOf(call, DEADLINE)]).toEqual([{ state: 'submitted' }, { state: 'failed' }]);
  });

  it('never fails by time when its capability states no deadline, and is completed by a reply however late', () => {
    const late = new Date('2027-10-19T12:00:00.000Z');
    const call = aClientCall({ outputContentType: null, deadlineAt: null });

    expect([stateOf(call, late), stateOf({ ...call, replies: [aCallReply({ contentType: 'text/plain', receivedAt: late })] }, late)]).toEqual([{ state: 'submitted' }, expect.objectContaining({ state: 'completed' })]);
  });

  it('stays failed when its completing reply comes after the deadline', () => {
    const call = aClientCall({ outputContentType: null, deadlineAt: DEADLINE, replies: [aCallReply({ contentType: 'text/plain', receivedAt: DEADLINE })] });

    expect(stateOf(call, new Date('2026-10-19T12:20:00.000Z'))).toEqual({ state: 'failed' });
  });

  it('stays completed after its deadline', () => {
    const call = aClientCall({ outputContentType: null, deadlineAt: DEADLINE, replies: [aCallReply({ contentType: 'text/plain', receivedAt: BEFORE_DEADLINE })] });

    expect(stateOf(call, new Date('2026-10-19T12:20:00.000Z'))).toMatchObject({ state: 'completed' });
  });
});

describe("where the call's delivery stands moves its state (interop 3.4)", () => {
  const ACKNOWLEDGED_AT = new Date('2026-10-19T12:00:30.000Z');

  it('is working once its delivery is acknowledged, before any reply', () => {
    const call = aClientCall({ deadlineAt: DEADLINE, delivery: { state: 'acknowledged', since: ACKNOWLEDGED_AT } });

    expect({ state: stateOf(call, BEFORE_DEADLINE), since: stateSince(call, BEFORE_DEADLINE) }).toEqual({ state: { state: 'working' }, since: ACKNOWLEDGED_AT });
  });

  it.each(['notHandled', 'undeliverable', 'dismissed', 'abandoned'] as const)('fails once its delivery is %s, since then', (state) => {
    const call = aClientCall({ deadlineAt: DEADLINE, delivery: { state, since: ACKNOWLEDGED_AT } });

    expect({ state: stateOf(call, BEFORE_DEADLINE), since: stateSince(call, BEFORE_DEADLINE) }).toEqual({ state: { state: 'failed' }, since: ACKNOWLEDGED_AT });
  });

  it('stays failed when its answer comes after its delivery failed', () => {
    const call = aClientCall({ deadlineAt: DEADLINE, delivery: { state: 'undeliverable', since: ACKNOWLEDGED_AT }, replies: [aCallReply({ receivedAt: new Date('2026-10-19T12:01:00.000Z') })] });

    expect(stateOf(call, BEFORE_DEADLINE)).toEqual({ state: 'failed' });
  });

  it('stays completed when its delivery fails after its answer came', () => {
    const call = aClientCall({ deadlineAt: DEADLINE, delivery: { state: 'notHandled', since: new Date('2026-10-19T12:05:00.000Z') }, replies: [aCallReply()] });

    expect(stateOf(call, BEFORE_DEADLINE)).toMatchObject({ state: 'completed' });
  });
});

describe('a call that matched no capability (decision 0060)', () => {
  it('is completed by its first reply, of whatever type', () => {
    const call = aClientCall({ capability: null, deadlineAt: null, replies: [aCallReply({ contentType: 'application/json', payload: '{"ok":true}' })] });

    expect(stateOf(call, BEFORE_DEADLINE)).toEqual({ state: 'completed', answer: { contentType: 'application/json', payload: '{"ok":true}' } });
  });

  it('is not completed by a question, which asks for input, nor by an A2A reply, which carries its own state (interop 3.4)', () => {
    const replies = [aCallReply({ contentType: 'application/vnd.aeolus.question+json', payload: '{"id":"q-1"}' }), aCallReply({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank9r02', contentType: 'application/a2a+json', payload: '{}' })];

    expect(stateOf(aClientCall({ capability: null, deadlineAt: null, replies }), BEFORE_DEADLINE)).toEqual({ state: 'working' });
  });
});

describe("since when an outside client's call is in its state", () => {
  const STATUS = aCallReply({ contentType: 'text/plain', payload: 'Looking it up.', receivedAt: new Date('2026-10-19T12:01:00.000Z') });
  const LATER_STATUS = aCallReply({ contentType: 'text/plain', payload: 'Still looking.', receivedAt: new Date('2026-10-19T12:02:00.000Z') });
  const ANSWER = aCallReply({ contentType: RESULT_TYPE, payload: '{"content":[]}', receivedAt: new Date('2026-10-19T12:03:00.000Z') });

  it('is submitted since it was sent', () => {
    expect(stateSince(aClientCall({ sentAt: SENT_AT, deadlineAt: DEADLINE }), BEFORE_DEADLINE)).toEqual(SENT_AT);
  });

  it('is working since its first reply', () => {
    const call = aClientCall({ outputContentType: RESULT_TYPE, sentAt: SENT_AT, deadlineAt: DEADLINE, replies: [STATUS, LATER_STATUS] });

    expect(stateSince(call, BEFORE_DEADLINE)).toEqual(new Date('2026-10-19T12:01:00.000Z'));
  });

  it('is completed since its answer came', () => {
    const call = aClientCall({ outputContentType: RESULT_TYPE, sentAt: SENT_AT, deadlineAt: DEADLINE, replies: [STATUS, ANSWER, LATER_STATUS] });

    expect(stateSince(call, BEFORE_DEADLINE)).toEqual(new Date('2026-10-19T12:03:00.000Z'));
  });

  it('is failed since its deadline', () => {
    const call = aClientCall({ outputContentType: RESULT_TYPE, sentAt: SENT_AT, deadlineAt: DEADLINE, replies: [STATUS] });

    expect(stateSince(call, new Date('2026-10-19T12:20:00.000Z'))).toEqual(DEADLINE);
  });
});

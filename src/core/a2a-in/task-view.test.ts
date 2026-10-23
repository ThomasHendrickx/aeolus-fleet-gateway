import { describe, expect, it } from 'vitest';

import { aCallReply, aClientCall } from '../../../test/support/mcp-in-fakes.js';
import type { ClientCall } from '../mcp-in/client-call.js';
import { taskViewOf } from './task-view.js';

const SENT_AT = new Date('2026-10-23T12:00:00.000Z');
const NOW = new Date('2026-10-23T12:05:00.000Z');
const QUESTION = 'application/vnd.aeolus.question+json';

const aTaskCall = (overrides: Partial<ClientCall> = {}) =>
  aClientCall({ party: 'supplier', handle: 'task-1', capability: 'quote', outputContentType: 'text/plain', sentAt: SENT_AT, deadlineAt: null, task: { taskId: 'task-1', message: '{"messageId":"m-1"}' }, ...overrides });

const aTask = (calls: ClientCall[]) => ({ taskId: 'task-1', contextId: 'ctx-1', calls });

describe("an A2A task's state, by the latest message the client sent in it (interop 3.4, decision 0060)", () => {
  it('is submitted while no reply came, since it was sent', () => {
    expect(taskViewOf(aTask([aTaskCall()]), NOW).status).toEqual({ state: 'submitted', since: SENT_AT });
  });

  it("is completed by the answer, the first reply of the capability's output type", () => {
    const answer = aCallReply({ contentType: 'text/plain', payload: '40 chairs: 1200 EUR' });

    expect(taskViewOf(aTask([aTaskCall({ replies: [answer] })]), NOW).status).toEqual({ state: 'completed', answer, since: answer.receivedAt });
  });

  it('needs input once a reply of the question content type came', () => {
    const question = aCallReply({ contentType: QUESTION, payload: '{"id":"q-1","title":"Which colour?"}' });

    expect(taskViewOf(aTask([aTaskCall({ outputContentType: 'application/json', replies: [question] })]), NOW).status).toEqual({ state: 'inputRequired', question, since: question.receivedAt });
  });

  it('takes the state an application/a2a+json reply carries, as the latest such reply', () => {
    const working = aCallReply({ contentType: 'application/a2a+json', payload: '{"status":{"state":"TASK_STATE_WORKING"}}' });
    const done = aCallReply({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank9r02', contentType: 'application/a2a+json', payload: '{"status":{"state":"TASK_STATE_COMPLETED"}}', receivedAt: new Date('2026-10-23T12:02:00.000Z') });

    expect(taskViewOf(aTask([aTaskCall({ outputContentType: 'application/json', replies: [working, done] })]), NOW).status).toEqual({ state: 'carried', reply: done, since: done.receivedAt });
  });

  it('fails at its deadline without an answer', () => {
    const deadlineAt = new Date('2026-10-23T12:01:00.000Z');

    expect(taskViewOf(aTask([aTaskCall({ deadlineAt })]), NOW).status).toEqual({ state: 'failed', since: deadlineAt });
  });

  it('is in the state of its latest message once the client continued it', () => {
    const question = aCallReply({ contentType: QUESTION, payload: '{"id":"q-1"}' });
    const followUp = aTaskCall({ messageId: 'msg_01m3tbfspe96yf1rnr4ank9m02', handle: 'h-2', sentAt: new Date('2026-10-23T12:03:00.000Z'), task: { taskId: 'task-1', message: '{"messageId":"m-2"}' } });

    expect(taskViewOf(aTask([aTaskCall({ replies: [question] }), followUp]), NOW).status).toEqual({ state: 'submitted', since: followUp.sentAt });
  });
});

describe("an A2A task's history (decision 0060)", () => {
  it("holds the client's messages and the ship's replies in the order they came", () => {
    const question = aCallReply({ contentType: QUESTION, payload: '{"id":"q-1"}', receivedAt: new Date('2026-10-23T12:01:00.000Z') });
    const answer = aCallReply({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank9r02', payload: 'Blue it is.', receivedAt: new Date('2026-10-23T12:04:00.000Z') });
    const followUp = aTaskCall({ messageId: 'msg_01m3tbfspe96yf1rnr4ank9m02', handle: 'h-2', sentAt: new Date('2026-10-23T12:03:00.000Z'), task: { taskId: 'task-1', message: '{"messageId":"m-2"}' }, replies: [answer] });

    const { history } = taskViewOf(aTask([aTaskCall({ replies: [question] }), followUp]), NOW);

    expect(history).toEqual([
      { by: 'client', message: '{"messageId":"m-1"}', at: SENT_AT },
      { by: 'ship', reply: question },
      { by: 'client', message: '{"messageId":"m-2"}', at: followUp.sentAt },
      { by: 'ship', reply: answer },
    ]);
  });
});

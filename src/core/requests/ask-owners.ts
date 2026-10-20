import { QUESTION_CONTENT_TYPE, WITHDRAWAL_CONTENT_TYPE } from '@aeolus-fleet/common';

import type { ConnectionStore } from '../connection/ports.js';
import type { CallSender } from '../mcp-in/ports.js';
import type { Clock } from '../shared/clock.js';
import type { Owners, OwnerQuestions, PendingRequest } from './ports.js';

/** How many requests one round asks about, and how many questions it withdraws, at most. */
const QUESTIONS_PER_ROUND = 50;

/** Asks the gateway's owner about the requests not asked yet, and withdraws the questions whose request ended: how it went. */
export type AskOwners = () => Promise<{ asked: number; withdrawn: number; kept: number; refused: number }>;

const dayOf = (at: Date) => at.toISOString().slice(0, 'yyyy-mm-dd'.length);

/** The question about one request: it points to the overview, where any approver decides (Q5 b, P6-2 b). */
function questionOf(request: PendingRequest, ids: { questionId: string; overviewUrl: string }) {
  const { subject } = request;
  const people = request.requesters.length === 1 ? '1 person' : `${String(request.requesters.length)} people`;
  const about =
    subject.kind === 'client'
      ? { title: `${subject.clientName} asks for access to the fleet`, what: 'An MCP client asks to act in the fleet as an outside party.' }
      : { title: `Someone asks to add ${subject.url} to the fleet`, what: 'A person asks for an outside MCP server, whose tools would reach the fleet.' };
  return {
    id: ids.questionId,
    title: about.title,
    context: `${about.what} Asked by ${people} on ${dayOf(request.askedAt)}; it waits until ${dayOf(request.expiresAt)}, then expires. Any holder of gateway:approve decides on ${ids.overviewUrl}.`,
    options: [{ key: 1, label: "Decide on the gateway's page", detail: ids.overviewUrl }],
    pick: { option: 1, why: 'Approving names the outside party, its owner and its scopes, which the page asks for.' },
  };
}

/**
 * Use case: the gateway's ship asks its owner, read from the fleet, about
 * each request that opened (decision 0056, 0038), argo too when argo owns it
 * (P6-1 a), and withdraws the question once the request is decided or
 * expired. Each goes under a key of the request, so one sent again after the
 * fleet did not answer is stored once; one the fleet refused is not sent
 * again. A fleet the gateway is not connected to waits.
 */
export function createAskOwners(deps: {
  questions: OwnerQuestions;
  connections: ConnectionStore;
  owners: Owners;
  sender: CallSender;
  newQuestionId: () => string;
  clock: Clock;
  overviewUrl: string;
}): AskOwners {
  return async () => {
    const now = deps.clock.now();
    const counted = { asked: 0, withdrawn: 0, kept: 0, refused: 0 };
    for (const { request, questionId: held } of await deps.questions.listToAsk(now, QUESTIONS_PER_ROUND)) {
      const gateway = await deps.connections.find(request.fleetId);
      const owner = gateway === undefined ? undefined : await deps.owners.ownerOf(gateway.crewToken, gateway.shipId);
      if (gateway === undefined || owner === undefined || (!owner.isOk && owner.error.code === 'UNAVAILABLE')) {
        counted.kept += 1;
        continue;
      }
      const questionId = await deps.questions.keep(request.fleetId, { requestId: request.requestId, questionId: held ?? deps.newQuestionId() });
      const asked = owner.isOk && owner.value !== null ? owner.value : null;
      const sent =
        asked === null
          ? undefined
          : await deps.sender.send(gateway.crewToken, {
              to: asked,
              contentType: QUESTION_CONTENT_TYPE,
              payload: JSON.stringify(questionOf(request, { questionId, overviewUrl: deps.overviewUrl })),
              idempotencyKey: `${request.requestId}:question`,
            });
      if (sent !== undefined && !sent.isOk && sent.error.code === 'UNAVAILABLE') {
        counted.kept += 1;
        continue;
      }
      const isAsked = sent?.isOk === true;
      await deps.questions.markAsked(request.fleetId, { requestId: request.requestId, askedShipId: isAsked ? asked : null, at: now });
      if (isAsked) {
        counted.asked += 1;
      } else {
        counted.refused += 1;
      }
    }
    for (const question of await deps.questions.listToWithdraw(now, QUESTIONS_PER_ROUND)) {
      const gateway = await deps.connections.find(question.fleetId);
      if (gateway === undefined || question.askedShipId === null) {
        counted.kept += 1;
        continue;
      }
      const sent = await deps.sender.send(gateway.crewToken, {
        to: question.askedShipId,
        contentType: WITHDRAWAL_CONTENT_TYPE,
        payload: JSON.stringify({ questionId: question.questionId }),
        idempotencyKey: `${question.requestId}:withdrawal`,
      });
      if (!sent.isOk && sent.error.code === 'UNAVAILABLE') {
        counted.kept += 1;
        continue;
      }
      await deps.questions.markWithdrawn(question.fleetId, { requestId: question.requestId, at: now });
      counted.withdrawn += sent.isOk ? 1 : 0;
      counted.refused += sent.isOk ? 0 : 1;
    }
    return counted;
  };
}

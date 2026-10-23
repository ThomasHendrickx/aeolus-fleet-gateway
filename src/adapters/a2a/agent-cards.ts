/**
 * The reader of an outside A2A agent's public card (slice 5): a GET at the
 * address an approver typed, with no credential, as a public card is read.
 * The answer is the proto's AgentCard as JSON: proto JSON leaves an empty
 * list out, so a list left out reads as empty. Only the fields the gateway
 * uses are kept. It follows no redirect, so the card is read where the
 * approver said, as the domain written as its fact is that one. The whole
 * read takes at most the timeout, and at most 1 MB of the answer is read.
 */
import { z } from 'zod';

import type { AgentCard, AgentCards, CardFailure } from '../../core/a2a-out/ports.js';
import { err, ok, type Result } from '../../core/shared/result.js';

/** The most of an answer read as a card. */
const CARD_MAX_BYTES = 1024 * 1024;

const listOf = <T extends z.ZodType>(item: T) => z.array(item).default([]);

const agentCardSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  version: z.string().min(1),
  supportedInterfaces: listOf(z.object({ url: z.string(), protocolBinding: z.string(), protocolVersion: z.string() })),
  capabilities: z.object({}),
  defaultInputModes: listOf(z.string()),
  defaultOutputModes: listOf(z.string()),
  skills: listOf(
    z.object({ id: z.string(), name: z.string(), description: z.string(), tags: listOf(z.string()), inputModes: listOf(z.string()), outputModes: listOf(z.string()) }),
  ),
});

/** The answer's body as text, or none once it is over the cap. */
async function cappedTextOf(response: Response): Promise<string | undefined> {
  if (response.body === null) {
    return '';
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let read = 0;
  for (let next = await reader.read(); !next.done; next = await reader.read()) {
    // A fetch body yields bytes; Node's types name its chunks any.
    const chunk: unknown = next.value;
    if (!(chunk instanceof Uint8Array)) {
      throw new TypeError('A fetch body yielded no bytes');
    }
    read += chunk.byteLength;
    if (read > CARD_MAX_BYTES) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function cardOf(text: string): Result<AgentCard, CardFailure> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return err({ kind: 'NOT_A_CARD', reason: 'the answer is no JSON' });
  }
  const parsed = agentCardSchema.safeParse(json);
  if (!parsed.success) {
    return err({ kind: 'NOT_A_CARD', reason: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ') });
  }
  const { name, description, supportedInterfaces, defaultInputModes, defaultOutputModes, skills } = parsed.data;
  return ok({
    name,
    description,
    supportedInterfaces,
    defaultInputModes,
    defaultOutputModes,
    skills: skills.map(({ id, name: skillName, description: skillDescription, inputModes, outputModes }) => ({ id, name: skillName, description: skillDescription, inputModes, outputModes })),
  });
}

export function createHttpAgentCards(deps: { timeoutMs: number }): AgentCards {
  return {
    read: async (cardUrl) => {
      const signal = AbortSignal.timeout(deps.timeoutMs);
      try {
        const response = await fetch(cardUrl, { headers: { accept: 'application/json' }, redirect: 'manual', signal });
        if (!response.ok) {
          await response.body?.cancel();
          return err({ kind: 'UNREACHABLE', reason: `the card address answered ${String(response.status)}` });
        }
        const text = await cappedTextOf(response);
        return text === undefined ? err({ kind: 'NOT_A_CARD', reason: 'the answer is over 1 MB' }) : cardOf(text);
      } catch (error) {
        return err({ kind: 'UNREACHABLE', reason: signal.aborted ? `no card within ${String(deps.timeoutMs)} ms` : error instanceof Error ? error.message : String(error) });
      }
    },
  };
}

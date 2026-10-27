/**
 * The domain proof OpenAI's plugin portal reads (chatgpt-plugin design,
 * 7.5): the token the portal shows, as plain text, at a well-known address.
 * The token is configuration and public by design; with none set there is no
 * such address, so a self-hosted gateway shows none.
 */
import type { FastifyInstance } from 'fastify';

const CHALLENGE_PATH = '/.well-known/openai-apps-challenge';

export function registerOpenAiAppsChallenge(server: FastifyInstance, deps: { challenge: string | undefined }): void {
  const { challenge } = deps;
  if (challenge === undefined) {
    return;
  }
  server.get(CHALLENGE_PATH, (_request, reply) => reply.type('text/plain; charset=utf-8').send(challenge));
}

import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { registerOpenAiAppsChallenge } from './openai-apps-challenge.js';

// OpenAI's plugin portal proves the gateway's domain by reading the token it
// shows at a well-known address (chatgpt-plugin design, 7.5).

const TOKEN = 'portal-token-1';

let server: FastifyInstance | undefined;

afterEach(async () => {
  await server?.close();
});

async function aGateway(challenge: string | undefined): Promise<FastifyInstance> {
  server = Fastify({ logger: false });
  registerOpenAiAppsChallenge(server, { challenge });
  await server.ready();
  return server;
}

describe('the domain proof', () => {
  it('the challenge is served as plain text: 200, text/plain, and its body is exactly the token, with no sign-in', async () => {
    const answer = await (await aGateway(TOKEN)).inject({ url: '/.well-known/openai-apps-challenge' });

    expect({ status: answer.statusCode, type: answer.headers['content-type'], body: answer.body }).toEqual({ status: 200, type: 'text/plain; charset=utf-8', body: TOKEN });
  });

  it('with no token set there is no route: 404', async () => {
    const answer = await (await aGateway(undefined)).inject({ url: '/.well-known/openai-apps-challenge' });

    expect(answer.statusCode).toBe(404);
  });
});

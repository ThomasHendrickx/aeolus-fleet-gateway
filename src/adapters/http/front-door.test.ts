import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { registerFrontDoor } from './front-door.js';

const BROWSER_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

let server: FastifyInstance;

beforeEach(async () => {
  server = Fastify({ logger: false });
  registerFrontDoor(server);
  server.get('/api/version', () => ({ gateway: '0.0.0' }));
  await server.ready();
});

afterEach(async () => {
  await server.close();
});

describe("the gateway's address as a person opens it (#1030)", () => {
  it('sends a person who opens the address to the Overview', async () => {
    const page = await server.inject({ url: '/', headers: { accept: BROWSER_ACCEPT } });

    expect(page.statusCode).toBe(303);
    expect(page.headers.location).toBe('/overview');
  });

  it("answers an unknown page a person opens with a page in the gateway's look, never raw JSON", async () => {
    const page = await server.inject({ url: '/no-such-page', headers: { accept: BROWSER_ACCEPT } });

    expect(page.statusCode).toBe(404);
    expect(page.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(page.body).toContain('This page does not exist');
    expect(page.body).toContain('href="/overview"');
  });

  it('answers an unknown address a client calls as JSON, as before', async () => {
    const answer = await server.inject({ url: '/api/no-such-call', headers: { accept: 'application/json' } });

    expect(answer.statusCode).toBe(404);
    expect(answer.json()).toEqual({ message: 'Route GET:/api/no-such-call not found', error: 'Not Found', statusCode: 404 });
  });

  it('answers an unknown form post as JSON, as no page is asked for', async () => {
    const answer = await server.inject({ method: 'POST', url: '/no-such-form', headers: { accept: BROWSER_ACCEPT } });

    expect(answer.statusCode).toBe(404);
    expect(answer.headers['content-type']).toBe('application/json; charset=utf-8');
  });
});

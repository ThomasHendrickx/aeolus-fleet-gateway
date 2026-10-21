import { text } from 'node:stream/consumers';

import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { registerFrontDoor, type WebApp } from './front-door.js';

const BROWSER_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

/** The web app in a test: it answers every request it is handed with the path it was asked for. */
const aWebApp: WebApp = (request, response) => {
  response.writeHead(404, { 'content-type': 'text/html; charset=utf-8' }).end(`<p>the web app answered ${request.url ?? ''}</p>`);
  return Promise.resolve();
};

let server: FastifyInstance;

beforeEach(async () => {
  server = Fastify({ logger: false });
  registerFrontDoor(server, { web: aWebApp });
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

  it('hands an unknown page a person opens to the web app, which answers it', async () => {
    const page = await server.inject({ url: '/no-such-page', headers: { accept: BROWSER_ACCEPT } });

    expect({ status: page.statusCode, body: page.body }).toEqual({ status: 404, body: '<p>the web app answered /no-such-page</p>' });
  });

  it("hands the web app's own files to it, whatever the request accepts", async () => {
    const file = await server.inject({ url: '/_next/static/chunks/app.js', headers: { accept: '*/*' } });

    expect(file.body).toBe('<p>the web app answered /_next/static/chunks/app.js</p>');
  });

  it('answers an unknown address a client calls as JSON, as before', async () => {
    const answer = await server.inject({ url: '/api/no-such-call', headers: { accept: 'application/json' } });

    expect(answer.statusCode).toBe(404);
    expect(answer.json()).toEqual({ message: 'Route GET:/api/no-such-call not found', error: 'Not Found', statusCode: 404 });
  });

  it("hands a page's form, a server action of the web app, to the web app with its body as the browser sent it", async () => {
    const form = '--b\r\ncontent-disposition: form-data; name="isOn"\r\n\r\ntrue\r\n--b--\r\n';
    const echoing = Fastify({ logger: false });
    registerFrontDoor(echoing, {
      web: async (request, response) => {
        response.writeHead(200).end(`${request.url ?? ''} ${await text(request)}`);
      },
    });

    const answer = await echoing.inject({ method: 'POST', url: '/outside-parties?fleet=flt_1', headers: { 'next-action': 'a1b2', 'content-type': 'multipart/form-data; boundary=b' }, payload: form });

    expect({ status: answer.statusCode, body: answer.body }).toEqual({ status: 200, body: `/outside-parties?fleet=flt_1 ${form}` });
    await echoing.close();
  });

  it('answers an unknown form post as JSON, as no page is asked for', async () => {
    const answer = await server.inject({ method: 'POST', url: '/no-such-form', headers: { accept: BROWSER_ACCEPT } });

    expect(answer.statusCode).toBe(404);
    expect(answer.headers['content-type']).toBe('application/json; charset=utf-8');
  });
});

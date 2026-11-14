/** A real fleet behind an HTTP boundary that can lose successful answer confirmations. */
import { createServer } from 'node:http';

import { z } from 'zod';

const sendSchema = z.object({ contentType: z.string(), idempotencyKey: z.string() });

export async function startLostAnswerFleet(target: string) {
  let isLosing = false;
  const keys: string[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const body = Buffer.concat(chunks);
      const send = request.url === '/api/v1/ship/send' ? sendSchema.safeParse(JSON.parse(body.toString('utf8'))).data : undefined;
      const isAnswer = send?.contentType === 'application/vnd.aeolus.answer+json';
      if (isAnswer) keys.push(send.idempotencyKey);
      void fetch(`${target}${request.url ?? ''}`, {
        method: request.method ?? 'GET',
        headers: Object.fromEntries(Object.entries(request.headers).flatMap(([name, value]) => typeof value === 'string' && name !== 'host' && name !== 'content-length' ? [[name, value]] : [])),
        ...(request.method === 'GET' || request.method === 'HEAD' ? {} : { body }),
      }).then(async (answer) => {
        const bytes = Buffer.from(await answer.arrayBuffer());
        if (isLosing && isAnswer && answer.ok) {
          response.destroy();
        } else {
          response.writeHead(answer.status, { 'content-type': answer.headers.get('content-type') ?? 'application/json' }).end(bytes);
        }
      }).catch(() => response.destroy());
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const bound = server.address();
  if (bound === null || typeof bound === 'string') throw new Error('Fleet proxy has no address');
  return {
    url: `http://127.0.0.1:${String(bound.port)}`,
    keys,
    loseConfirmations: (isNextLosing: boolean) => { isLosing = isNextLosing; },
    stop: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => {
        if (error === undefined) resolve();
        else reject(error);
      }));
    },
  };
}

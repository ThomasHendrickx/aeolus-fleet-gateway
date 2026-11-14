/**
 * The door where an outside authorization server reads a party's client
 * metadata document (decision 0074): `/outside-oauth/clients/<opaque id>`,
 * beneath the gateway's public address, the party's gateway URL client id.
 * It takes no sign-in: the document is public identity information. A URL
 * no live document-mode party holds answers not found.
 */
import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { ReadClientMetadataDocument } from '../../core/parties/read-client-metadata-document.js';

const URL_CLIENTS_PATH = '/outside-oauth/clients';

const HTTP_NOT_FOUND = 404;

const paramsSchema = z.object({ id: z.string() });

/** A distinct, opaque gateway URL client id beneath the public address, one per addition. */
export function urlClientIdOf(publicUrl: string): () => string {
  return () => `${publicUrl}${URL_CLIENTS_PATH}/${randomUUID()}`;
}

export function registerClientMetadataDocumentRoutes(server: FastifyInstance, deps: { read: ReadClientMetadataDocument; publicUrl: string }): void {
  server.get(`${URL_CLIENTS_PATH}/:id`, async (request, reply) => {
    const { id } = paramsSchema.parse(request.params);
    const document = await deps.read(`${deps.publicUrl}${URL_CLIENTS_PATH}/${id}`);
    if (!document.isOk) {
      return reply.code(HTTP_NOT_FOUND).send({ error: 'not_found' });
    }
    return reply.header('content-type', 'application/json; charset=utf-8').send(document.value);
  });
}

/**
 * Clients' metadata documents (CIMD), fetched from their client id URLs: a
 * small JSON document, read with a short timeout and no redirect followed,
 * since the URL is the client's identity.
 */
import type { ClientMetadataDocuments } from '../../core/oauth/ports.js';
import { err, ok } from '../../core/shared/result.js';

/** The largest document the gateway reads (CIMD recommends at most 5 KB). */
const DOCUMENT_MAX_BYTES = 5 * 1024;

export function createClientMetadataDocuments(options: { timeoutMs: number }): ClientMetadataDocuments {
  return {
    fetch: async (url) => {
      try {
        const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(options.timeoutMs), headers: { accept: 'application/json' } });
        if (response.status !== 200) {
          return err({ reason: `it answered ${String(response.status)}` });
        }
        const body = await response.arrayBuffer();
        if (body.byteLength > DOCUMENT_MAX_BYTES) {
          return err({ reason: `it is over ${String(DOCUMENT_MAX_BYTES)} bytes` });
        }
        const document: unknown = JSON.parse(new TextDecoder().decode(body));
        return ok(document);
      } catch (error) {
        return err({ reason: error instanceof Error ? error.message : String(error) });
      }
    },
  };
}

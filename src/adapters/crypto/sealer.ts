import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

const CIPHER = 'aes-256-gcm';
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

/** Seals JSON into URL-safe text, and opens it again; what it opens is unknown until its schema parses it. */
export interface Sealer {
  seal(value: unknown): string;
  open(sealed: string): unknown;
}

/**
 * Seals with AES-256-GCM under a key derived from the gateway's secret and
 * the label: the sealed text is the nonce, the sealed JSON and its tag,
 * base64url. Text changed on the way, sealed under another secret or
 * another label, opens to undefined.
 */
export function createSealer(secret: string, label: string): Sealer {
  const key = createHmac('sha256', secret).update(label).digest();
  return {
    seal: (value) => {
      const nonce = randomBytes(NONCE_BYTES);
      const cipher = createCipheriv(CIPHER, key, nonce);
      const sealed = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
      return Buffer.concat([nonce, sealed, cipher.getAuthTag()]).toString('base64url');
    },
    open: (sealed) => {
      const bytes = Buffer.from(sealed, 'base64url');
      if (bytes.length <= NONCE_BYTES + TAG_BYTES) {
        return undefined;
      }
      const decipher = createDecipheriv(CIPHER, key, bytes.subarray(0, NONCE_BYTES));
      decipher.setAuthTag(bytes.subarray(bytes.length - TAG_BYTES));
      try {
        const opened: unknown = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(NONCE_BYTES, bytes.length - TAG_BYTES)), decipher.final()]).toString('utf8'));
        return opened;
      } catch {
        return undefined;
      }
    },
  };
}

/** The request's parameters that are set, as a sealed request keeps them. */
export function setParameters(request: Readonly<Record<string, string | undefined>>): Record<string, string> {
  return Object.fromEntries(Object.entries(request).filter((entry): entry is [string, string] => entry[1] !== undefined));
}

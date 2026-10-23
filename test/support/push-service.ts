/**
 * A browser's push service in a test: it takes each push to its endpoints
 * and answers as the test sets it, 201 by default. A browser it serves holds
 * its own keys, so the test reads each push as the browser would, decrypted
 * (RFC 8291, aes128gcm), and sees what the gateway's wake says.
 */
import { createDecipheriv, createECDH, createHmac, randomBytes } from 'node:crypto';
import { createServer, type IncomingHttpHeaders } from 'node:http';

/** A push the service took: who it was for, its headers, and what it says, decrypted. */
export interface TakenPush {
  readonly path: string;
  readonly headers: IncomingHttpHeaders;
  readonly text: string;
}

/** A browser's push subscription, with the private key that reads its pushes. */
export interface TestBrowser {
  readonly endpoint: string;
  readonly keys: { readonly p256dh: string; readonly auth: string };
  read(body: Buffer): string;
}

const SALT_LENGTH = 16;
const RECORD_SIZE_LENGTH = 4;
const KEY_LENGTH = 16;
const NONCE_LENGTH = 12;
const TAG_LENGTH = 16;
/** The delimiter that ends the last record's content, before its padding. */
const LAST_RECORD_DELIMITER = 2;

const hmac = (key: Buffer, data: Buffer) => createHmac('sha256', key).update(data).digest();
const info = (text: string) => Buffer.concat([Buffer.from(`${text}\0`, 'latin1'), Buffer.from([1])]);

function aBrowser(endpoint: string): TestBrowser {
  const ecdh = createECDH('prime256v1');
  const publicKey = ecdh.generateKeys();
  const auth = randomBytes(16);
  return {
    endpoint,
    keys: { p256dh: publicKey.toString('base64url'), auth: auth.toString('base64url') },
    read: (body) => {
      const salt = body.subarray(0, SALT_LENGTH);
      const idLength = body.readUInt8(SALT_LENGTH + RECORD_SIZE_LENGTH);
      const keyStart = SALT_LENGTH + RECORD_SIZE_LENGTH + 1;
      const senderKey = body.subarray(keyStart, keyStart + idLength);
      const cipherText = body.subarray(keyStart + idLength);
      const secret = ecdh.computeSecret(senderKey);
      const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0', 'latin1'), publicKey, senderKey, Buffer.from([1])]);
      const ikm = hmac(hmac(auth, secret), keyInfo);
      const prk = hmac(salt, ikm);
      const decipher = createDecipheriv('aes-128-gcm', hmac(prk, info('Content-Encoding: aes128gcm')).subarray(0, KEY_LENGTH), hmac(prk, info('Content-Encoding: nonce')).subarray(0, NONCE_LENGTH));
      decipher.setAuthTag(cipherText.subarray(cipherText.length - TAG_LENGTH));
      const padded = Buffer.concat([decipher.update(cipherText.subarray(0, cipherText.length - TAG_LENGTH)), decipher.final()]);
      return padded.subarray(0, padded.lastIndexOf(LAST_RECORD_DELIMITER)).toString('utf8');
    },
  };
}

export async function startPushService() {
  const taken: TakenPush[] = [];
  const browsers = new Map<string, TestBrowser>();
  /** The statuses to come for each path, before 201. */
  const statuses = new Map<string, number[]>();
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const path = request.url ?? '/';
      const status = statuses.get(path)?.shift() ?? 201;
      const browser = browsers.get(path);
      if (status === 201 && browser !== undefined) {
        taken.push({ path, headers: request.headers, text: browser.read(Buffer.concat(chunks)) });
      }
      response.writeHead(status).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const url = `http://127.0.0.1:${String(typeof address === 'object' && address !== null ? address.port : 0)}`;
  return {
    url,
    taken,
    statuses,
    /** A browser this service pushes to, at its own endpoint. */
    browser: (path: string): TestBrowser => {
      const browser = aBrowser(`${url}${path}`);
      browsers.set(path, browser);
      return browser;
    },
    stop: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      }),
  };
}

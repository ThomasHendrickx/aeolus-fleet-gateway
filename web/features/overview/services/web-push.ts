/**
 * What the overview's section of wakes works out in the browser (wake a
 * person, W8): the name a browser it turns web push on in is listed by, the
 * gateway's push key as the browser's push manager takes it, and the
 * subscription the browser sends the gateway.
 */

/** A browser's push subscription as the gateway takes it, with the browser's name. */
export interface SubscriptionInput {
  readonly endpoint: string;
  readonly keys: { readonly p256dh: string; readonly auth: string };
  readonly browser: string;
}

/** The browsers and systems a name is made of, the first that matches counting: Edge and Chrome also say Safari, and Chrome says Chrome. */
const BROWSERS: readonly (readonly [RegExp, string])[] = [
  [/Edg\//, 'Edge'],
  [/Firefox\//, 'Firefox'],
  [/Chrome\//, 'Chrome'],
  [/Safari\//, 'Safari'],
];
const SYSTEMS: readonly (readonly [RegExp, string])[] = [
  [/iPhone|iPad/, 'iOS'],
  [/Android/, 'Android'],
  [/Mac OS X/, 'macOS'],
  [/Windows/, 'Windows'],
  [/Linux/, 'Linux'],
];

const firstOf = (userAgent: string, names: readonly (readonly [RegExp, string])[]): string | undefined => names.find(([pattern]) => pattern.test(userAgent))?.[1];

/** The name a browser is listed by, such as Firefox on Linux, from its user agent. */
export function browserNameOf(userAgent: string): string {
  const browser = firstOf(userAgent, BROWSERS);
  const system = firstOf(userAgent, SYSTEMS);
  if (browser === undefined) {
    return 'A browser';
  }
  return system === undefined ? browser : `${browser} on ${system}`;
}

/** The bytes a base64url key stands for, as the browser's push manager takes the gateway's key. */
export function applicationServerKeyOf(key: string): Uint8Array<ArrayBuffer> {
  const binary = atob(key.replaceAll('-', '+').replaceAll('_', '/'));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

/** The subscription to send, from the push manager's own, or none when it gave no endpoint or keys. */
export function subscriptionInputOf(subscription: { endpoint?: string; keys?: Record<string, string> }, browser: string): SubscriptionInput | undefined {
  const { endpoint, keys } = subscription;
  const p256dh = keys?.p256dh;
  const auth = keys?.auth;
  return endpoint === undefined || p256dh === undefined || auth === undefined ? undefined : { endpoint, keys: { p256dh, auth }, browser };
}

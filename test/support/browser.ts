/**
 * A browser in a test: it follows redirects one at a time and sends each
 * site back the cookies it set, as a browser does; one that keeps no cookies
 * stands for another browser.
 */
import { z } from 'zod';

/** How many redirects a browser follows before it stops where it is. */
const MOST_HOPS = 5;

export interface Browser {
  /** One request, sending the site's cookies; the answer as it comes. */
  visit(url: string): Promise<Response>;
  /** Follows the redirects from the address until it lands, or until it is sent to an address starting with `stopAt`: the last answer. */
  follow(url: string, stopAt: string): Promise<Response>;
}

export function aBrowser(options: { isKeepingCookies: boolean } = { isKeepingCookies: true }): Browser {
  const jar = new Map<string, Map<string, string>>();
  const visit = async (url: string): Promise<Response> => {
    const { origin } = new URL(url);
    const cookies = jar.get(origin) ?? new Map<string, string>();
    const header = [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
    const response = await fetch(url, { redirect: 'manual', headers: header === '' ? {} : { cookie: header } });
    if (options.isKeepingCookies) {
      for (const cookie of response.headers.getSetCookie()) {
        const [pair = ''] = cookie.split(';', 1);
        const [name = '', value = ''] = pair.split('=', 2);
        if (value === '') {
          cookies.delete(name);
        } else {
          cookies.set(name, value);
        }
      }
      jar.set(origin, cookies);
    }
    return response;
  };
  return {
    visit,
    follow: async (url, stopAt) => {
      let response = await visit(url);
      for (let hop = 0; hop < MOST_HOPS && response.status === 302; hop += 1) {
        const next = new URL(z.string().parse(response.headers.get('location')), url).toString();
        if (next.startsWith(stopAt)) {
          return response;
        }
        response = await visit(next);
      }
      return response;
    },
  };
}

/** Where the gateway's page at /authorize sends the person once they pick what the client acts as (Q1 a). */
export function pickedAt(sentTo: URL, holder: 'account' | 'party'): string {
  const picked = new URL('/authorize/sign-in', sentTo);
  for (const [name, value] of sentTo.searchParams) {
    picked.searchParams.append(name, value);
  }
  picked.searchParams.append('holder', holder);
  return picked.toString();
}

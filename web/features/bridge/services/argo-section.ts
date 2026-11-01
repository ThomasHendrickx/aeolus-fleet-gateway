/**
 * Bridge's argo section (aeolus-fleet docs/design/argo-inbox, AI2 to AI4):
 * what waits at argo, for an account allowed as argo, with its own count,
 * as the gateway's API answers it. Pure view logic, no React and no API
 * client.
 */
import type { inferRouterOutputs } from '@trpc/server';

import type { GatewayRouter } from '../../../../src/adapters/trpc/router.js';
import { clockTimeOf } from './clock-time';

export type ArgoSection = NonNullable<inferRouterOutputs<GatewayRouter>['people']['argoSection']>;

/** Where the argo section is on Bridge home: the sidebar's entry and the phone's tab lead to it. */
export const ARGO_SECTION_ANCHOR = 'argo';

/** An item's one button: a question is answered, anything else opened, in the console as argo (argo's inbox, AI2). */
export function argoActionOf({ kind }: Pick<ArgoSection['items'][number], 'kind'>): string {
  return kind === 'question' ? 'Answer in the console as argo' : 'Open in the console as argo';
}

/** What the section says of the newest message done at argo: by whom, where, when and what; shorter on a phone. */
export function doneLineOf({ title, at, by, isInConsole }: NonNullable<ArgoSection['done']>, { isPhone }: { isPhone: boolean }): string {
  const who = by === null ? '' : ` by ${by}`;
  const where = isInConsole && !isPhone ? ' in the console' : '';
  const line = `Done at argo${who}${where}, ${clockTimeOf(at)}: ${title}.`;
  return isPhone ? line : `${line} Gone from this list for everyone allowed as argo.`;
}

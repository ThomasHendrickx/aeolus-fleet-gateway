/**
 * Bridge home's notice of argo's read rule (argo's inbox, section 4): while
 * argo has not let the gateway read argo's inbox, an account allowed as argo
 * is told so, and where argo adds the rule, with the guide to it.
 */
import type { GatewayApi } from '../../../lib/gateway-api/gateway-api';

/** What the gateway answers of argo's inbox for the account. */
export type ArgoInboxNotice = Awaited<ReturnType<GatewayApi['people']['argoInboxNotice']['query']>>;

/** The guide to the read rule, step by step, in the gateway's docs. */
export const ARGO_READ_RULE_GUIDE_URL = 'https://github.com/ThomasHendrickx/aeolus-fleet-gateway/blob/main/docs/argo-inbox-read-rule.md';

export interface ArgoInboxNoticeWords {
  readonly title: string;
  readonly body: string;
  readonly guide: { readonly label: string; readonly href: string };
}

/** The notice's words, none while there is nothing to tell. */
export function argoInboxNoticeOf(notice: ArgoInboxNotice): ArgoInboxNoticeWords | null {
  if (notice.kind === 'none') {
    return null;
  }
  return {
    title: 'What waits at argo does not reach you here',
    body: `argo has not let the gateway read argo's inbox, so what is sent to argo shows only in the console's inbox. argo adds a read rule on the console's Network page: from the gateway's ship, ${notice.gatewayShip.name}, to argo.`,
    guide: { label: 'How argo adds the read rule', href: ARGO_READ_RULE_GUIDE_URL },
  };
}

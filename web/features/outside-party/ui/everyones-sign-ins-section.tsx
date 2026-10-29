import type { GatewayApi } from '../../../lib/gateway-api/gateway-api';
import { readOf } from '../../../lib/gateway-api/page-api';
import { SignInsCard } from './everyones-sign-ins';
import { EveryonesSignInsCard } from './everyones-sign-ins-card';

const NOTHING = () => undefined;

/**
 * Everyone's sign-ins to a server where each person signs in, for an account
 * holding gateway:approve (decision 0067, M3, Q12): the first page read as it
 * streams in behind skeleton rows, or why the API refused it. The API checks
 * the approver's manage reach of the proxy ship again.
 */
export async function EveryonesSignInsSection({ api, fleetId, name }: { api: GatewayApi; fleetId: string; name: string }) {
  const read = await readOf(api.parties.signIns.query({ name, after: null }));
  const now = new Date().toISOString();
  if (!read.isOk) {
    return <SignInsCard party={name} now={now} rows={[]} refusal={read.refusal} hasMore={false} isLoadingMore={false} confirming={null} removing={null} outcome={{ kind: 'idle' }} onRemove={NOTHING} onConfirm={NOTHING} onKeep={NOTHING} onMore={NOTHING} />;
  }
  return <EveryonesSignInsCard fleetId={fleetId} party={name} now={now} first={read.value} />;
}

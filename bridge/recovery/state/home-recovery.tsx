import type { GatewayApi } from '../../../web/lib/gateway-api/gateway-api';
import type { WhoDidNotAnswer } from '../../../web/features/bridge/ui/unreadable-banner';
import { readConnection } from '../hooks/read-connection';
import { RecordUnreadable } from './record-unreadable';

/** A failed home read checks the gateway's connection before naming its recovery. */
export async function HomeRecovery({ api, whoDidNotAnswer }: { api: GatewayApi; whoDidNotAnswer: WhoDidNotAnswer }) {
  const connection = await readConnection(api);
  return <RecordUnreadable whoDidNotAnswer={whoDidNotAnswer} isDisconnected={connection === 'disconnected'} />;
}

import { RECEIVE_MAX_UPPER_BOUND, type DeliveryId, type DeliveryState } from '@aeolus-fleet/common';

import type { ConnectionStore } from '../connection/ports.js';
import type { FinishesOwnStep } from '../party-grants/ports.js';
import type { SentMessages } from '../mcp-in/ports.js';
import type { Clock } from '../shared/clock.js';
import type { ItemOutcomes } from './item-outcome.js';
import type { InboxChanges, OpenedDeliveries, PersonCrews, PersonShipDoor } from './ports.js';

/** What finishing the step does with its delivery, by where it stands: acknowledge it first, report it handled only, or nothing, as it ended already. */
type Finishing = 'acknowledgeFirst' | 'takeFirst' | 'handledOnly' | 'ended';

function finishingOf(state: DeliveryState): Finishing {
  switch (state) {
    case 'pending':
      return 'takeFirst';
    case 'received':
    case 'handed':
      return 'acknowledgeFirst';
    case 'acknowledged':
      return 'handledOnly';
    case 'handled':
    case 'notHandled':
    case 'undeliverable':
    case 'dismissed':
    case 'abandoned':
      return 'ended';
  }
}

/**
 * Use case: a step the gateway's ship sent a person, as to sign in to an
 * outside server, is done once the gateway sees it complete, with no press
 * (Bridge, CC14). The gateway's ship reads where the step's delivery stands;
 * as the person ship's crew the gateway takes it if it is still pending,
 * acknowledges it if the person had not opened it, and reports it handled.
 * It is kept done by the gateway, forgotten as opened, and the person's
 * pages are told. No outcome is sent: the asker is the gateway, which saw
 * it complete. A step that ended already, or that the fleet does not take
 * as handled, is left as it is, for the person to mark.
 */
export function createFinishOwnStep(deps: {
  connections: Pick<ConnectionStore, 'find'>;
  sent: SentMessages;
  crews: Pick<PersonCrews, 'find'>;
  door: PersonShipDoor;
  opened: OpenedDeliveries;
  outcomes: ItemOutcomes;
  changes: InboxChanges;
  clock: Clock;
}): FinishesOwnStep {
  /** Takes, then acknowledges, the delivery as the finishing needs: whether it is acknowledged now. */
  const acknowledged = async (crewToken: string, delivery: { deliveryId: DeliveryId; finishing: Finishing }): Promise<boolean> => {
    switch (delivery.finishing) {
      case 'ended':
        return false;
      case 'handledOnly':
        return true;
      case 'takeFirst': {
        const taken = await deps.door.pushReceive(crewToken, { max: RECEIVE_MAX_UPPER_BOUND });
        return taken.isOk && taken.value.some(({ deliveryId }) => deliveryId === delivery.deliveryId) && (await deps.door.ack(crewToken, delivery.deliveryId)).isOk;
      }
      case 'acknowledgeFirst':
        return (await deps.door.ack(crewToken, delivery.deliveryId)).isOk;
    }
  };

  return async ({ fleetId, personShipId, stepMessageId }) => {
    const [gateway, crew] = await Promise.all([deps.connections.find(fleetId), deps.crews.find(fleetId, personShipId)]);
    if (gateway === undefined || crew === undefined) {
      return;
    }
    const sent = await deps.sent.sentMessage(gateway.crewToken, stepMessageId);
    if (!sent.isOk) {
      return;
    }
    const { deliveryId } = sent.value;
    if (!(await acknowledged(crew.crewToken, { deliveryId, finishing: finishingOf(sent.value.state) }))) {
      return;
    }
    if (!(await deps.door.handled(crew.crewToken, deliveryId)).isOk) {
      return;
    }
    await deps.outcomes.save({ fleetId, shipId: personShipId, deliveryId, place: 'gateway', kind: 'done', option: null, at: deps.clock.now() });
    await deps.opened.remove(fleetId, { shipId: personShipId, deliveryId });
    await deps.changes.tell({ fleetId, shipId: personShipId });
  };
}

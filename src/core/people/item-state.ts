/**
 * An item's state (docs/design/bridge, section 6), from its delivery's state:
 * new while the person has not acted on it, seen once they did in any place,
 * and done once nothing more waits on them. A delivery the fleet ended
 * without the person (not handled, undeliverable, dismissed or abandoned)
 * waits on them no more either, so it is done.
 */
import type { DeliveryState } from '@aeolus-fleet/common';

export type ItemState = 'new' | 'seen' | 'done';

export function itemStateOf(state: DeliveryState): ItemState {
  switch (state) {
    case 'pending':
    case 'received':
    case 'handed':
      return 'new';
    case 'acknowledged':
      return 'seen';
    case 'handled':
    case 'notHandled':
    case 'undeliverable':
    case 'dismissed':
    case 'abandoned':
      return 'done';
  }
}

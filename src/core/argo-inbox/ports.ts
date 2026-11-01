/**
 * argo's inbox, read by the gateway's own ship for the people who may act as
 * argo (aeolus-fleet docs/design/argo-inbox, AI1 and AI9): the accounts
 * allowed as argo, and what the gateway reads of argo's inbox.
 */
import type { FleetId, ShipId } from '@aeolus-fleet/common';

/** An account allowed as argo in a fleet, as its latest account token said, and the person ship it is reached at. */
export interface ArgoAccount {
  readonly accountId: string;
  readonly personShipId: ShipId;
}

/** Outbound port: each fleet's accounts allowed as argo, from each account's latest account token. */
export interface ArgoAccounts {
  keep(fleetId: FleetId, account: ArgoAccount): Promise<void>;
  drop(fleetId: FleetId, accountId: string): Promise<void>;
  list(fleetId: FleetId): Promise<readonly ArgoAccount[]>;
}

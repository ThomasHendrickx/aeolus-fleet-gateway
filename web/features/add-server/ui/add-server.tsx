'use client';

import { useActionState, useState } from 'react';

import { approveServer, checkServer } from '../actions';
import { AddressStep } from './address-step';
import { OwnerStep } from './owner-step';
import { Steps } from './steps';

/** The steps of adding a server, as the design numbers them. */
const STEPS = ['Address', 'Check', 'Owner'] as const;

/**
 * Adding an outside MCP server in three steps: its address and credential,
 * the gateway's check of the tools it answers with, then its owner. Each
 * button says at once that its step is on its way.
 */
export function AddServer({ fleetId, canSwitchTools }: { fleetId: string; canSwitchTools: boolean }) {
  const [checked, check] = useActionState(checkServer, { step: 'address', fields: {} });
  const [refused, approve] = useActionState(approveServer, { kind: 'idle' });
  // Going back shows the address step again, with what was sent, until the next check answers.
  const [backFrom, setBackFrom] = useState<string | undefined>(undefined);
  const owner = checked.step === 'owner' && backFrom !== checked.requestId ? checked : undefined;
  return (
    <div className="grid gap-4">
      <h1 className="text-title font-semibold">Add MCP server</h1>
      <Steps names={STEPS} at={owner === undefined ? 0 : 2} />
      {owner === undefined ? (
        <AddressStep state={checked} action={check} fleetId={fleetId} />
      ) : (
        <OwnerStep state={owner} refused={refused} action={approve} onBack={() => { setBackFrom(owner.requestId); }} fleetId={fleetId} canSwitchTools={canSwitchTools} />
      )}
    </div>
  );
}

'use client';

import { useActionState, useState } from 'react';

import { approveServer, checkServer } from '../actions';
import { AddressStep } from './address-step';
import { OwnerStep } from './owner-step';
import { SignInStep } from './sign-in-step';

/**
 * Adding an outside MCP server in three steps: its address and credential,
 * the gateway's check of the tools it answers with, then its owner. A server
 * where each person signs in is added unchecked, then the approver signs in
 * to it for themselves (M1, decision 0067). Each button says at once that its
 * step is on its way.
 */
export function AddServer({ fleetId, canSwitchTools }: { fleetId: string; canSwitchTools: boolean }) {
  const [checked, check] = useActionState(checkServer, { step: 'address', fields: {} });
  const [approved, approve] = useActionState(approveServer, { kind: 'idle' });
  // Going back shows the address step again, with what was sent, until the next check answers.
  const [backFrom, setBackFrom] = useState<string | undefined>(undefined);
  const owner = checked.step === 'owner' && backFrom !== checked.requestId ? checked : undefined;
  return (
    <div className="grid gap-4">
      <h1 className="text-title font-semibold">Add MCP server</h1>
      {approved.kind === 'added' ? (
        <SignInStep fleetId={fleetId} name={approved.name} />
      ) : owner === undefined ? (
        <AddressStep state={checked} action={check} fleetId={fleetId} />
      ) : (
        <OwnerStep state={owner} refused={approved} action={approve} onBack={() => { setBackFrom(owner.requestId); }} fleetId={fleetId} canSwitchTools={canSwitchTools} />
      )}
    </div>
  );
}

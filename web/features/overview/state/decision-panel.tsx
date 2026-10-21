'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { decideRequest } from '../hooks/overview-actions';
import type { DecisionInput, ShownRequest } from '../services/requests';
import { DecisionForm } from '../ui/decision-form';

/** Decides one request as the signed-in approver, then goes back to the Overview, which says nothing more waits here. */
export function DecisionPanel({ fleetId, request, heldScopes }: { fleetId: string; request: ShownRequest; heldScopes: readonly string[] }) {
  const router = useRouter();
  const [working, setWorking] = useState<DecisionInput['kind'] | undefined>();
  const [failure, setFailure] = useState<string | undefined>();
  const [, startTransition] = useTransition();
  const decide = (decision: DecisionInput) => {
    setWorking(decision.kind);
    setFailure(undefined);
    startTransition(async () => {
      const outcome = await decideRequest({ fleet: fleetId, requestId: request.requestId, input: decision });
      if (outcome.isOk) {
        router.push(`/overview?${new URLSearchParams({ fleet: fleetId, decided: decision.kind }).toString()}`);
        return;
      }
      setWorking(undefined);
      setFailure(outcome.message);
    });
  };
  return <DecisionForm request={request} heldScopes={heldScopes} working={working} failure={failure} onDecide={decide} />;
}

'use client';

import { useState } from 'react';

import { FLEET_FIELD } from '../../forms/form-state';
import { BUTTONS, CARD, INPUT, LABEL } from '../../forms/ui/look';
import { OwnerField } from '../../forms/ui/owner-field';
import { SubmitButton } from '../../forms/ui/submit-button';
import type { AddServerState, ApproveState } from '../actions';
import { CHECKED_STEPS, SIGN_IN_STEPS } from '../steps';
import { addButtonLabel, suggestedName } from '../suggested-name';
import { Refused } from './refused';
import { Steps } from './steps';
import { ToolsSection } from './tools-section';

const CONCURRENCY_LIMIT_DEFAULT = '4';

/** The credential fields, carried on from the address step to the owner step. */
const CARRIED_FIELDS = ['url', 'credentialKind', 'token', 'clientId', 'clientSecret', 'issuer', 'scope'] as const;

/**
 * The step that names the server's proxy ship and its owner, below the tools
 * the check answered. A server where each person signs in has no tools to
 * show yet: Add checks its sign-in, and says a refusal in place.
 */
export function OwnerStep({ state, refused, action, onBack, fleetId, canSwitchTools }: { state: Extract<AddServerState, { step: 'owner' }>; refused: ApproveState; action: (form: FormData) => void; onBack: () => void; fleetId: string; canSwitchTools: boolean }) {
  // A refused approval of this check shows what the browser sent, and why.
  const isRefused = refused.kind === 'refused' && refused.requestId === state.requestId;
  const fields = isRefused ? refused.fields : state.fields;
  const url = fields.url ?? '';
  const [name, setName] = useState(fields.name ?? suggestedName(url));
  const tools = state.tools;
  return (
    <>
      {tools === null ? <Steps names={SIGN_IN_STEPS} at={1} /> : <Steps names={CHECKED_STEPS} at={2} />}
      <form action={action} className={`${CARD} grid gap-3`} data-testid="add-server-owner">
        {tools === null ? null : <ToolsSection tools={tools} canSwitch={canSwitchTools} />}
        <h2 className="text-section font-semibold">Its owner</h2>
        <Refused refusal={isRefused ? refused.message : undefined} />
        <input type="hidden" name={FLEET_FIELD} value={fleetId} />
        <input type="hidden" name="requestId" value={state.requestId} />
        {CARRIED_FIELDS.map((field) => (
          <input key={field} type="hidden" name={field} value={fields[field] ?? ''} />
        ))}
        <p className="font-mono text-muted-foreground">{url}</p>
        <label className={LABEL}>
          <span>Proxy ship&apos;s name</span>
          <input className={INPUT} type="text" name="name" value={name} onChange={(event) => { setName(event.target.value); }} required />
        </label>
        <OwnerField choices={state.owners} current={state.owners.find((owner) => owner.shipId === fields.ownerShipId) ?? null} help="A person ship or argo. It answers for this server." />
        <label className={LABEL}>
          <span>Calls at once</span>
          <input className={INPUT} type="number" name="concurrencyLimit" min={1} max={10} defaultValue={fields.concurrencyLimit ?? CONCURRENCY_LIMIT_DEFAULT} />
        </label>
        {tools === null ? <p className="text-muted-foreground">Its tools show once someone signs in.</p> : null}
        <div className="flex gap-2">
          <SubmitButton pending={tools === null ? 'Checking the sign-in…' : 'Adding…'} testId="add-server-approve">
            {addButtonLabel(name)}
          </SubmitButton>
          <button type="button" className={BUTTONS.secondary} onClick={onBack}>
            Back to the address
          </button>
        </div>
      </form>
    </>
  );
}

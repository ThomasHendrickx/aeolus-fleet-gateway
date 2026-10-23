'use client';

import { useActionState, useState } from 'react';

import { FLEET_FIELD } from '../../forms/form-state';
import { CREDENTIAL_KINDS, credentialKindOf } from '../../forms/server-credential';
import { BUTTONS, CARD, INPUT, LABEL } from '../../forms/ui/look';
import { Outcome } from '../../forms/ui/outcome';
import { OwnerField } from '../../forms/ui/owner-field';
import { SubmitButton } from '../../forms/ui/submit-button';
import { approveServer, checkServer, type AddServerState, type ApproveState } from '../actions';
import { suggestedName } from '../suggested-name';

/** The steps of adding a server, as the design numbers them. */
const STEPS = ['Address', 'Check', 'Owner'] as const;

const CONCURRENCY_LIMIT_DEFAULT = '4';

/** The credential fields, carried on from the address step to the owner step. */
const CARRIED_FIELDS = ['url', 'credentialKind', 'token', 'clientId', 'clientSecret', 'issuer', 'scope'] as const;

function Steps({ at }: { at: number }) {
  return (
    <ol className="flex gap-4">
      {STEPS.map((step, index) => (
        <li key={step} aria-current={index === at ? 'step' : undefined} className={index <= at ? 'font-medium' : 'text-muted-foreground'}>
          {index + 1} {step}
        </li>
      ))}
    </ol>
  );
}

function Refused({ refusal }: { refusal: string | undefined }) {
  return refusal === undefined ? null : <Outcome state={{ kind: 'refused', message: refusal }} />;
}

function AddressStep({ state, action, fleetId }: { state: Extract<AddServerState, { step: 'address' }> | { fields: Record<string, string>; refusal?: string }; action: (form: FormData) => void; fleetId: string }) {
  const [credentialKind, setCredentialKind] = useState(credentialKindOf(state.fields.credentialKind ?? ''));
  return (
    <form action={action} className={`${CARD} grid gap-3`} data-testid="add-server-address">
      <input type="hidden" name={FLEET_FIELD} value={fleetId} />
      <Refused refusal={state.refusal} />
      <label className={LABEL}>
        <span>Streamable HTTP address</span>
        <input className={INPUT} type="url" name="url" defaultValue={state.fields.url ?? ''} placeholder="https://mcp.example.com/mcp" required />
      </label>
      <fieldset className="grid gap-3">
        <legend className="font-medium">The server&apos;s credential</legend>
        <label className={LABEL}>
          <span>Credential</span>
          <select className={INPUT} name="credentialKind" value={credentialKind} onChange={(event) => { setCredentialKind(credentialKindOf(event.target.value)); }}>
            {CREDENTIAL_KINDS.map(({ kind, label }) => (
              <option key={kind} value={kind}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {credentialKind === 'clientCredentials' ? (
          <>
            <label className={LABEL}>
              <span>Client id</span>
              <input className={INPUT} type="text" name="clientId" defaultValue={state.fields.clientId ?? ''} />
            </label>
            <label className={LABEL}>
              <span>Client secret</span>
              <input className={INPUT} type="password" name="clientSecret" />
            </label>
            <label className={LABEL}>
              <span>Issuer</span>
              <input className={INPUT} type="url" name="issuer" defaultValue={state.fields.issuer ?? ''} />
            </label>
            <label className={LABEL}>
              <span>Scope</span>
              <input className={INPUT} type="text" name="scope" defaultValue={state.fields.scope ?? ''} />
            </label>
          </>
        ) : credentialKind === 'bearer' ? (
          <label className={LABEL}>
            <span>Bearer token</span>
            <input className={INPUT} type="password" name="token" />
          </label>
        ) : (
          <p className="text-muted-foreground">The gateway sends no credential: for a server reached only on a private network.</p>
        )}
      </fieldset>
      <div>
        <SubmitButton pending="Checking the server…" testId="add-server-check">
          Check the server
        </SubmitButton>
      </div>
    </form>
  );
}

function OwnerStep({ state, refused, action, onBack, fleetId }: { state: Extract<AddServerState, { step: 'owner' }>; refused: ApproveState; action: (form: FormData) => void; onBack: () => void; fleetId: string }) {
  // A refused approval of this check shows what the browser sent, and why.
  const isRefused = refused.kind === 'refused' && refused.requestId === state.requestId;
  const fields = isRefused ? refused.fields : state.fields;
  const { tools } = state;
  const url = fields.url ?? '';
  const name = fields.name ?? suggestedName(url);
  return (
    <>
      <section className={`${CARD} grid gap-2`} data-testid="add-server-tools">
        <h2 className="text-section font-semibold">
          The server answers: {tools.length} {tools.length === 1 ? 'tool' : 'tools'}
        </h2>
        <ul className="grid gap-1">
          {tools.map((tool) => (
            <li key={tool.name} className="grid">
              <span className="font-mono">{tool.name}</span>
              {tool.description === undefined ? null : <span className="text-muted-foreground">{tool.description}</span>}
            </li>
          ))}
        </ul>
      </section>
      <form action={action} className={`${CARD} grid gap-3`} data-testid="add-server-owner">
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
          <input className={INPUT} type="text" name="name" defaultValue={name} required />
        </label>
        <OwnerField choices={state.owners} current={state.owners.find((owner) => owner.shipId === fields.ownerShipId) ?? null} help="A person ship or argo. It answers for this server." />
        <label className={LABEL}>
          <span>Calls at once</span>
          <input className={INPUT} type="number" name="concurrencyLimit" min={1} max={10} defaultValue={fields.concurrencyLimit ?? CONCURRENCY_LIMIT_DEFAULT} />
        </label>
        <div className="flex gap-2">
          <SubmitButton pending="Adding…" testId="add-server-approve">
            Add {name === '' ? 'server' : name}
          </SubmitButton>
          <button type="button" className={BUTTONS.secondary} onClick={onBack}>
            Back to the address
          </button>
        </div>
      </form>
    </>
  );
}

/**
 * Adding an outside MCP server in three steps: its address and credential,
 * the gateway's check of the tools it answers with, then its owner. Each
 * button says at once that its step is on its way.
 */
export function AddServer({ fleetId }: { fleetId: string }) {
  const [checked, check] = useActionState(checkServer, { step: 'address', fields: {} });
  const [refused, approve] = useActionState(approveServer, { kind: 'idle' });
  // Going back shows the address step again, with what was sent, until the next check answers.
  const [backFrom, setBackFrom] = useState<string | undefined>(undefined);
  const owner = checked.step === 'owner' && backFrom !== checked.requestId ? checked : undefined;
  return (
    <div className="grid gap-4">
      <h1 className="text-title font-semibold">Add MCP server</h1>
      <Steps at={owner === undefined ? 0 : 2} />
      {owner === undefined ? (
        <AddressStep state={checked} action={check} fleetId={fleetId} />
      ) : (
        <OwnerStep state={owner} refused={refused} action={approve} onBack={() => { setBackFrom(owner.requestId); }} fleetId={fleetId} />
      )}
    </div>
  );
}

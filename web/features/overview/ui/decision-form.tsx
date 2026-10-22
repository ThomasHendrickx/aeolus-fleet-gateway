'use client';

import { useState, type SyntheticEvent } from 'react';

import { OwnerField, type OwnerChoices } from '../../forms/ui/owner-field';
import { EVERY_APP_SHIP_SCOPES, scopeLabel, subjectName, suggestedName, type DecisionInput, type ServerCredentialInput, type ShownRequest } from '../services/requests';
import { ActionButton } from './action-button';
import { Notice } from './notice';

const CONCURRENCY_LIMIT_DEFAULT = 4;

const FIELD = 'rounded-md border border-input bg-background px-2 py-1.5';

function ScopeRow({ scope, isLocked }: { scope: string; isLocked: boolean }) {
  return (
    <label className="flex items-center gap-2">
      {isLocked ? <input type="checkbox" checked disabled aria-label={scopeLabel(scope)} /> : <input type="checkbox" name="scope" value={scope} aria-label={scopeLabel(scope)} />}
      <span>{scopeLabel(scope)}</span>
      <span className="font-mono text-caption text-muted-foreground">{scope}</span>
      {isLocked ? <span className="text-caption text-muted-foreground">(always)</span> : null}
    </label>
  );
}

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

function serverOf(form: FormData): ServerCredentialInput {
  return {
    credentialKind: text(form, 'credentialKind') === 'clientCredentials' ? 'clientCredentials' : 'bearer',
    token: text(form, 'token'),
    clientId: text(form, 'clientId'),
    clientSecret: text(form, 'clientSecret'),
    issuer: text(form, 'issuer'),
    scope: text(form, 'scope-requested'),
    concurrencyLimit: Number(text(form, 'concurrencyLimit')),
  };
}

/**
 * The decision on a request: approving names the proxy ship and its owner,
 * and offers as scope rows only the scopes the approver holds, messages:send
 * and messages:receive locked on (0046, 0053); a server's credential too.
 * What was typed stays when the API refuses.
 */
export function DecisionForm({
  request,
  heldScopes,
  owners,
  working,
  failure,
  onDecide,
}: {
  request: ShownRequest;
  heldScopes: readonly string[];
  owners: OwnerChoices;
  working: DecisionInput['kind'] | undefined;
  failure: string | undefined;
  onDecide: (decision: DecisionInput) => void;
}) {
  const [credentialKind, setCredentialKind] = useState<ServerCredentialInput['credentialKind']>('bearer');
  const name = subjectName(request);
  const isServer = request.subject.kind === 'server';
  const approve = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const scopes = form.getAll('scope').filter((scope) => typeof scope === 'string');
    onDecide({ kind: 'approve', name: text(form, 'name'), ownerShipId: text(form, 'ownerShipId'), scopes, server: isServer ? serverOf(form) : undefined });
  };
  return (
    <section className="grid gap-3 rounded-lg border border-border bg-card p-6 text-card-foreground shadow-sm">
      <h2 className="text-heading font-semibold">Approve {name}</h2>
      <form onSubmit={approve} className="grid gap-3">
        <label className="grid gap-1">
          <span>Proxy ship&apos;s name</span>
          <input name="name" defaultValue={suggestedName(name)} required className={FIELD} />
        </label>
        <OwnerField choices={owners.isOk ? owners.value : []} current={null} help="A person ship or argo. It answers for this party." refusal={owners.isOk ? undefined : owners.refusal} />
        <fieldset className="grid gap-1">
          <legend>Scopes</legend>
          {EVERY_APP_SHIP_SCOPES.map((scope) => (
            <ScopeRow key={scope} scope={scope} isLocked />
          ))}
          {heldScopes
            .filter((scope) => !EVERY_APP_SHIP_SCOPES.includes(scope))
            .map((scope) => (
              <ScopeRow key={scope} scope={scope} isLocked={false} />
            ))}
        </fieldset>
        {isServer ? (
          <fieldset className="grid gap-2">
            <legend>The server&apos;s credential</legend>
            <label className="grid gap-1">
              <span>Credential</span>
              <select name="credentialKind" value={credentialKind} onChange={(event) => { setCredentialKind(event.target.value === 'clientCredentials' ? 'clientCredentials' : 'bearer'); }} className={FIELD}>
                <option value="bearer">Bearer token</option>
                <option value="clientCredentials">OAuth client credentials</option>
              </select>
            </label>
            {credentialKind === 'bearer' ? (
              <label className="grid gap-1">
                <span>Bearer token</span>
                <input type="password" name="token" className={FIELD} />
              </label>
            ) : (
              <>
                <label className="grid gap-1">
                  <span>Client id</span>
                  <input name="clientId" className={FIELD} />
                </label>
                <label className="grid gap-1">
                  <span>Client secret</span>
                  <input type="password" name="clientSecret" className={FIELD} />
                </label>
                <label className="grid gap-1">
                  <span>Issuer</span>
                  <input type="url" name="issuer" className={FIELD} />
                </label>
                <label className="grid gap-1">
                  <span>Scope</span>
                  <input name="scope-requested" className={FIELD} />
                </label>
              </>
            )}
            <label className="grid gap-1">
              <span>Calls at once</span>
              <input type="number" name="concurrencyLimit" min={1} max={10} defaultValue={CONCURRENCY_LIMIT_DEFAULT} className={FIELD} />
            </label>
          </fieldset>
        ) : null}
        {failure === undefined ? null : <Notice message={failure} isFailure />}
        <div className="flex gap-2">
          <ActionButton type="submit" variant="primary" data-testid="overview-approve" isPending={working === 'approve'} pendingLabel="Approving..." disabled={working !== undefined}>
            Approve
          </ActionButton>
          <ActionButton type="button" data-testid="overview-deny" isPending={working === 'deny'} pendingLabel="Denying..." disabled={working !== undefined} onClick={() => { onDecide({ kind: 'deny' }); }}>
            Deny
          </ActionButton>
        </div>
      </form>
    </section>
  );
}

'use client';

import { useState } from 'react';

import { ADDED_CREDENTIAL_KINDS, addedCredentialKindOf, CREDENTIAL_KINDS, credentialKindOf, SIGN_IN_CREDENTIAL, type AddedCredentialKind } from '../server-credential';
import { INPUT, LABEL } from './look';

/**
 * The credential the vault keeps for an outside party the gateway calls: its
 * kind, then only the fields of that kind. A secret is never shown back, so
 * it is typed again after a refusal. Only adding a server offers each person
 * signing in, which takes no field (decision 0067).
 */
export function CredentialFields({ legend, fields, noneHelp, canEachPersonSignIn = false, onKindChange }: { legend: string; fields: Readonly<Record<string, string>>; noneHelp: string; canEachPersonSignIn?: boolean; onKindChange?: (kind: AddedCredentialKind) => void }) {
  const kindOf = canEachPersonSignIn ? addedCredentialKindOf : credentialKindOf;
  const [credentialKind, setCredentialKind] = useState<AddedCredentialKind>(kindOf(fields.credentialKind ?? ''));
  return (
    <fieldset className="grid gap-3">
      <legend className="font-medium">{legend}</legend>
      <label className={LABEL}>
        <span>Credential</span>
        <select className={INPUT} name="credentialKind" value={credentialKind} onChange={(event) => { const kind = kindOf(event.target.value); setCredentialKind(kind); onKindChange?.(kind); }}>
          {(canEachPersonSignIn ? ADDED_CREDENTIAL_KINDS : CREDENTIAL_KINDS).map(({ kind, label }) => (
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
            <input className={INPUT} type="text" name="clientId" defaultValue={fields.clientId ?? ''} />
          </label>
          <label className={LABEL}>
            <span>Client secret</span>
            <input className={INPUT} type="password" name="clientSecret" />
          </label>
          <label className={LABEL}>
            <span>Issuer</span>
            <input className={INPUT} type="url" name="issuer" defaultValue={fields.issuer ?? ''} />
          </label>
          <label className={LABEL}>
            <span>Scope</span>
            <input className={INPUT} type="text" name="scope" defaultValue={fields.scope ?? ''} />
          </label>
        </>
      ) : credentialKind === 'bearer' ? (
        <label className={LABEL}>
          <span>Bearer token</span>
          <input className={INPUT} type="password" name="token" />
        </label>
      ) : credentialKind === SIGN_IN_CREDENTIAL.kind ? (
        <p className="text-muted-foreground">Each person signs in for themselves. A ship calls under its owner&apos;s sign-in.</p>
      ) : (
        <p className="text-muted-foreground">{noneHelp}</p>
      )}
    </fieldset>
  );
}

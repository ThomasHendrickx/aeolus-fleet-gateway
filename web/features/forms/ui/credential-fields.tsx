'use client';

import { useState } from 'react';

import { CREDENTIAL_KINDS, credentialKindOf } from '../server-credential';
import { INPUT, LABEL } from './look';

/**
 * The credential the vault keeps for an outside party the gateway calls: its
 * kind, then only the fields of that kind. A secret is never shown back, so
 * it is typed again after a refusal.
 */
export function CredentialFields({ legend, fields, noneHelp }: { legend: string; fields: Readonly<Record<string, string>>; noneHelp: string }) {
  const [credentialKind, setCredentialKind] = useState(credentialKindOf(fields.credentialKind ?? ''));
  return (
    <fieldset className="grid gap-3">
      <legend className="font-medium">{legend}</legend>
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
      ) : (
        <p className="text-muted-foreground">{noneHelp}</p>
      )}
    </fieldset>
  );
}

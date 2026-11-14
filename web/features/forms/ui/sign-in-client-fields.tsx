'use client';

import { useState } from 'react';

import { INPUT, LABEL, SELECT } from './look';

/** Explicit identity selection for each person's issuer-bound outside sign-in. */
export function SignInClientFields({ fields, redirectUri }: { fields: Readonly<Record<string, string>>; redirectUri?: string | undefined }) {
  const [source, setSource] = useState(fields.signInClientSource === 'fixed' ? 'fixed' : 'automatic');
  const [method, setMethod] = useState(fields.signInClientAuthMethod ?? 'none');
  return (
    <div className="grid min-w-0 gap-3" data-testid="sign-in-client-fields">
      <label className={LABEL}>
        <span>OAuth client</span>
        <select className={SELECT} name="signInClientSource" value={source} onChange={(event) => { setSource(event.target.value); }}>
          <option value="automatic">Automatic registration</option>
          <option value="fixed">Supplied client</option>
        </select>
      </label>
      {source === 'fixed' ? <>
        <p className="text-muted-foreground">Use a client dedicated to this server. Register this exact callback URL with the service:</p>
        <p className="break-all font-mono" data-testid="sign-in-client-callback">{redirectUri}</p>
        <label className={LABEL}>
          <span>Client id</span>
          <input className={INPUT} name="signInClientId" defaultValue={fields.signInClientId ?? ''} required data-testid="sign-in-client-id" />
        </label>
        <label className={LABEL}>
          <span>Client authentication</span>
          <select className={SELECT} name="signInClientAuthMethod" value={method} onChange={(event) => { setMethod(event.target.value); }} data-testid="sign-in-client-authentication">
            <option value="none">Public (no secret)</option>
            <option value="client_secret_post">Form secret</option>
            <option value="client_secret_basic">Basic</option>
          </select>
        </label>
        {method === 'none' ? null : <label className={LABEL}>
          <span>Client secret</span>
          <input className={INPUT} type="password" name="signInClientSecret" autoComplete="off" required data-testid="sign-in-client-secret" />
        </label>}
        <p className="text-muted-foreground">Adding checks discovery and client settings. Sign in afterwards to check that the service accepts the client and callback.</p>
      </> : null}
    </div>
  );
}

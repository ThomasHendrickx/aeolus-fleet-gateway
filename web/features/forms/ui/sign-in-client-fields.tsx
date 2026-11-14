'use client';

import { useState } from 'react';

import { INPUT, LABEL, SELECT } from './look';

/** Explicit identity selection for each person's issuer-bound outside sign-in. */
export function SignInClientFields({ fields, redirectUri }: { fields: Readonly<Record<string, string>>; redirectUri?: string | undefined }) {
  const [source, setSource] = useState(fields.signInClientSource === 'url' ? 'url' : fields.signInClientSource === 'fixed' ? 'fixed' : 'automatic');
  const [method, setMethod] = useState(fields.signInClientAuthMethod ?? 'none');
  const [urlMode, setUrlMode] = useState(fields.signInClientUrlMode === 'document' ? 'document' : 'plain');
  return (
    <div className="grid min-w-0 gap-3" data-testid="sign-in-client-fields">
      <label className={LABEL}>
        <span>OAuth client</span>
        <select className={SELECT} name="signInClientSource" value={source} onChange={(event) => { setSource(event.target.value); }}>
          <option value="automatic">Automatic registration</option>
          <option value="fixed">Supplied client</option>
          <option value="url">Gateway URL</option>
        </select>
      </label>
      {source === 'url' ? <>
        <p className="text-muted-foreground">The gateway creates a distinct public client URL for this server. No client secret is needed.</p>
        <label className={LABEL}>
          <span>URL mode</span>
          <select className={SELECT} name="signInClientUrlMode" value={urlMode} onChange={(event) => { setUrlMode(event.target.value); }} data-testid="sign-in-client-url-mode">
            <option value="plain">Plain URL</option>
            <option value="document">Metadata document</option>
          </select>
        </label>
        <p className="text-muted-foreground">{urlMode === 'document'
          ? 'The service must advertise client metadata document support. The gateway publishes the client URL with this exact callback:'
          : 'Choose this only if the service accepts a URL as its client id and allows this exact callback:'}</p>
        <p className="break-all font-mono" data-testid="sign-in-client-callback">{redirectUri}</p>
        <p className="text-muted-foreground">Adding checks discovery and client settings. Sign in afterwards to check that the service accepts the client and callback.</p>
      </> : null}
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

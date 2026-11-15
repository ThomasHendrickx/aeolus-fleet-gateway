'use client';

import { useId, useState } from 'react';

import { Input, Label } from '@aeolus-fleet/ui';

import { ChevronDown } from 'lucide-react';

import { ADDED_CREDENTIAL_KINDS, addedCredentialKindOf, CREDENTIAL_KINDS, credentialKindOf, SIGN_IN_CREDENTIAL, type AddedCredentialKind } from '../server-credential';
import { SignInClientFields } from './sign-in-client-fields';
import { INPUT, LABEL, SELECT } from './look';

/**
 * The credential the vault keeps for an outside party the gateway calls: its
 * kind, labelled by the legend alone, then only the fields of that kind. A secret is never shown back, so
 * it is typed again after a refusal. Only adding a server offers each person
 * signing in, which takes no field (decision 0067).
 */
export function CredentialFields({ legend, fields, noneHelp, canEachPersonSignIn = false, redirectUri, onKindChange }: { legend: string; fields: Readonly<Record<string, string>>; noneHelp: string; canEachPersonSignIn?: boolean; redirectUri?: string | undefined; onKindChange?: (kind: AddedCredentialKind) => void }) {
  const fieldId = useId();
  const kindOf = canEachPersonSignIn ? addedCredentialKindOf : credentialKindOf;
  const [credentialKind, setCredentialKind] = useState<AddedCredentialKind>(kindOf(fields.credentialKind ?? ''));
  return (
    <fieldset className="grid gap-3">
      <legend className="font-medium">{legend}</legend>
      <span className="relative">
        <select className={SELECT} aria-label={legend} name="credentialKind" value={credentialKind} onChange={(event) => { const kind = kindOf(event.target.value); setCredentialKind(kind); onKindChange?.(kind); }}>
          {(canEachPersonSignIn ? ADDED_CREDENTIAL_KINDS : CREDENTIAL_KINDS).map(({ kind, label }) => (
            <option key={kind} value={kind}>
              {label}
            </option>
          ))}
        </select>
        <ChevronDown aria-hidden className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      </span>
      {credentialKind === 'clientCredentials' ? (
        <>
          <Label htmlFor={fieldId + '-0'} className={LABEL}>
            <span>Client id</span>
            <Input id={fieldId + '-0'} className={INPUT} type="text" name="clientId" defaultValue={fields.clientId ?? ''} />
          </Label>
          <Label htmlFor={fieldId + '-1'} className={LABEL}>
            <span>Client secret</span>
            <Input id={fieldId + '-1'} className={INPUT} type="password" name="clientSecret" />
          </Label>
          <Label htmlFor={fieldId + '-2'} className={LABEL}>
            <span>Issuer</span>
            <Input id={fieldId + '-2'} className={INPUT} type="url" name="issuer" defaultValue={fields.issuer ?? ''} />
          </Label>
          <Label htmlFor={fieldId + '-3'} className={LABEL}>
            <span>Scope</span>
            <Input id={fieldId + '-3'} className={INPUT} type="text" name="scope" defaultValue={fields.scope ?? ''} />
          </Label>
        </>
      ) : credentialKind === 'bearer' ? (
        <Label htmlFor={fieldId + '-4'} className={LABEL}>
          <span>Bearer token</span>
          <Input id={fieldId + '-4'} className={INPUT} type="password" name="token" />
        </Label>
      ) : credentialKind === SIGN_IN_CREDENTIAL.kind ? (
        <>
          <p className="text-muted-foreground">Each person signs in for themselves. A ship calls under its owner&apos;s sign-in.</p>
          <SignInClientFields fields={fields} redirectUri={redirectUri} />
        </>
      ) : (
        <p className="text-muted-foreground">{noneHelp}</p>
      )}
    </fieldset>
  );
}

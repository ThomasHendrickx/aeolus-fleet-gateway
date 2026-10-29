import { FLEET_FIELD } from '../../forms/form-state';
import { CredentialFields } from '../../forms/ui/credential-fields';
import { CARD, INPUT, LABEL } from '../../forms/ui/look';
import { SubmitButton } from '../../forms/ui/submit-button';
import { Refused } from './refused';

/** The first step: the server's address and its credential, with the check's refusal where it was refused. */
export function AddressStep({ state, action, fleetId }: { state: { fields: Readonly<Record<string, string>>; refusal?: string | undefined }; action: (form: FormData) => void; fleetId: string }) {
  return (
    <form action={action} className={`${CARD} grid gap-3`} data-testid="add-server-address">
      <input type="hidden" name={FLEET_FIELD} value={fleetId} />
      <Refused refusal={state.refusal} />
      <label className={LABEL}>
        <span>Streamable HTTP address</span>
        <input className={INPUT} type="url" name="url" defaultValue={state.fields.url ?? ''} placeholder="https://mcp.example.com/mcp" required />
      </label>
      <CredentialFields legend="The server's credential" fields={state.fields} noneHelp="The gateway sends no credential: for a server reached only on a private network." />
      <div>
        <SubmitButton pending="Checking the server…" testId="add-server-check">
          Check the server
        </SubmitButton>
      </div>
    </form>
  );
}

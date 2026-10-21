import { inFleet } from '../../../lib/gateway-api/page-account';
import { readOf, type SignedInPage } from '../../../lib/gateway-api/page-api';
import { ActionForm } from '../../forms/ui/action-form';
import { BUTTONS, CARD, INPUT, LABEL } from '../../forms/ui/look';
import { partyPath } from '../../outside-parties/paths';
import { changeParty } from '../actions';
import { EVERY_APP_SHIP_SCOPES, SCOPE_FIELD_PREFIX, SCOPES_SHOWN_FIELD } from '../scope-changes';
import { Back, GRANTING_SCOPE, OWNING_SCOPE, Refusal } from './outside-party';

/** A scope's plain label, beside the scope itself. */
const SCOPE_LABELS: Record<string, string> = {
  'messages:send': 'Send',
  'messages:receive': 'Receive',
  'fleet:read': 'Read the fleet',
};

/** One scope row: a locked row shows the scope ticked or not and sends nothing. */
function ScopeRow({ scope, isLocked = false, isChecked = false }: { scope: string; isLocked?: boolean; isChecked?: boolean }) {
  return (
    <label className="flex items-center gap-2">
      <input type="checkbox" defaultChecked={isLocked ? true : isChecked} disabled={isLocked} {...(isLocked ? {} : { name: `${SCOPE_FIELD_PREFIX}${scope}` })} />
      <span>{SCOPE_LABELS[scope] ?? scope}</span>
      <span className="font-mono text-code text-muted-foreground">{scope}</span>
      {isLocked ? <span className="text-muted-foreground">(locked)</span> : null}
    </label>
  );
}

/**
 * Changing a party's owner (fleet:owner) and its scopes (scopes:grant):
 * every app ship's scopes locked on, the account's own to tick, and what
 * the party holds beyond them locked as it is.
 */
export async function ChangeParty({ page, name }: { page: SignedInPage; name: string }) {
  const { api, fleetId, scopes } = page;
  const read = await readOf(api.parties.get.query({ name }));
  if (!read.isOk) {
    return (
      <div className="grid gap-4">
        <Back fleetId={fleetId} />
        <Refusal>{read.refusal}</Refusal>
      </div>
    );
  }
  const party = read.value;
  const held = party.scopes;
  const own = scopes.filter((scope) => !EVERY_APP_SHIP_SCOPES.includes(scope));
  const beyond = held === null ? [] : held.filter((scope) => !EVERY_APP_SHIP_SCOPES.includes(scope) && !own.includes(scope));
  return (
    <div className="grid gap-4">
      <Back fleetId={fleetId} />
      <section className={`${CARD} grid gap-3`}>
        <h2 className="text-section font-semibold">{party.name}: owner and scopes</h2>
        <ActionForm action={changeParty} fleetId={fleetId} submit={{ label: 'Save', pending: 'Saving…' }} testId="outside-party-change-form">
          <input type="hidden" name="name" value={party.name} />
          {scopes.includes(OWNING_SCOPE) ? (
            <label className={LABEL}>
              <span>Owner</span>
              <input className={INPUT} type="text" name="ownerShipId" defaultValue={party.ownerShipId ?? ''} placeholder="shp_..." required />
              <span className="text-muted-foreground">A person ship. It answers for this party.</span>
            </label>
          ) : null}
          {scopes.includes(GRANTING_SCOPE) && held !== null ? (
            <fieldset className="grid gap-2">
              <legend className="font-medium">Scopes</legend>
              <input type="hidden" name={SCOPES_SHOWN_FIELD} value="true" />
              {EVERY_APP_SHIP_SCOPES.map((scope) => (
                <ScopeRow key={scope} scope={scope} isLocked />
              ))}
              {own.map((scope) => (
                <ScopeRow key={scope} scope={scope} isChecked={held.includes(scope)} />
              ))}
              {beyond.map((scope) => (
                <ScopeRow key={scope} scope={scope} isLocked />
              ))}
            </fieldset>
          ) : null}
        </ActionForm>
        <div>
          <a className={BUTTONS.secondary} href={inFleet(partyPath(party.name), fleetId)}>
            Cancel
          </a>
        </div>
      </section>
    </div>
  );
}

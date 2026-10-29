import { inFleet } from '../../../lib/gateway-api/page-account';
import { readOf, type SignedInPage } from '../../../lib/gateway-api/page-api';
import { ActionForm } from '../../forms/ui/action-form';
import { BUTTONS, CARD } from '../../forms/ui/look';
import { partyPath } from '../../outside-parties/paths';
import { retireParty } from '../actions';
import { Back, Refusal } from './outside-party';

/** Retiring a party, after one confirm that lists what happens (decision 0056). */
export async function RetireParty({ page, name }: { page: SignedInPage; name: string }) {
  const { api, fleetId } = page;
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
  return (
    <div className="grid gap-4">
      <Back fleetId={fleetId} />
      <section className={`${CARD} grid gap-3`}>
        <h2 className="text-heading font-semibold">Retire {party.name}?</h2>
        <ul className="list-disc pl-5">
          <li>{party.proxyShipId === null ? 'Its proxy ship is retired' : <>Its proxy ship <span className="font-mono">{party.proxyShipId}</span> is retired</>}</li>
          <li>The ships that used it lose its tools</li>
          <li>Adding it again is a new request</li>
        </ul>
        <ActionForm action={retireParty} fleetId={fleetId} submit={{ label: `Retire ${party.name}`, pending: 'Retiring…', kind: 'destructive' }} testId="outside-party-retire-form">
          <input type="hidden" name="name" value={party.name} />
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

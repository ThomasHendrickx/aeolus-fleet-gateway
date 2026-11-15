import { InlineError, EmptyState, Input, Label } from '@aeolus-fleet/ui';

import { randomUUID } from 'node:crypto';

import { readOf, type SignedInPage } from '../../../lib/gateway-api/page-api';
import { CREDENTIAL_KINDS } from '../../forms/server-credential';
import { ActionForm } from '../../forms/ui/action-form';
import { FormCheckbox } from '../../forms/ui/form-checkbox';
import { CARD, INPUT, LABEL } from '../../forms/ui/look';
import { OwnerField, type OwnerChoices } from '../../forms/ui/owner-field';
import { outsideAddressOf, PARTY_STATES, type ListedParty } from '../../outside-parties/party-kinds';
import { StatusBadge } from '../../outside-parties/ui/status-badge';
import { approveParty, crewParty, markTool, stateParty } from '../actions';

/** The scope that approves, crews and states parties (0056). */
const MANAGING_SCOPE = 'fleet:manage';

function PartyForms({ party, fleetId }: { party: ListedParty; fleetId: string }) {
  const fieldId = 'party-' + party.name;
  return (
    <div className="grid gap-2">
      {party.state === 'awaitingCrew' ? (
        <ActionForm action={crewParty} fleetId={fleetId} submit={{ label: 'Crew', pending: 'Crewing…' }} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="name" value={party.name} />
          <Input className={INPUT} name="secret" placeholder="secret from a new starting prompt" required />
        </ActionForm>
      ) : null}
      {party.kind === 'mcpServer' && party.state === 'crewed' ? (
        <>
          <ActionForm action={stateParty} fleetId={fleetId} submit={{ label: 'State its tools', pending: 'Stating…', kind: 'secondary' }}>
            <input type="hidden" name="name" value={party.name} />
          </ActionForm>
          <ActionForm action={markTool} fleetId={fleetId} submit={{ label: 'Mark', pending: 'Marking…', kind: 'secondary' }} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="name" value={party.name} />
            <Input className={INPUT} name="tool" placeholder="tool" required maxLength={128} />
            <Label htmlFor={fieldId + '-0'} className="flex items-center gap-1">
              <FormCheckbox id={fieldId + '-0'} name="isRepeatable" /> repeatable
            </Label>
          </ActionForm>
        </>
      ) : null}
    </div>
  );
}

function ApproveForm({ fleetId, owners }: { fleetId: string; owners: OwnerChoices }) {
  const fieldId = 'approve-party';
  return (
    <section className={`${CARD} grid gap-3`}>
      <h2 className="text-section font-semibold">Approve an MCP server</h2>
      <ActionForm action={approveParty} fleetId={fleetId} submit={{ label: 'Approve', pending: 'Approving…' }} testId="parties-approve">
        <input type="hidden" name="requestId" value={randomUUID()} />
        <Label htmlFor={fieldId + '-1'} className={LABEL}>
          <span>Name, the proxy ship&apos;s</span>
          <Input id={fieldId + '-1'} className={INPUT} name="name" required />
        </Label>
        <Label htmlFor={fieldId + '-2'} className={LABEL}>
          <span>Streamable HTTP URL</span>
          <Input id={fieldId + '-2'} className={INPUT} name="url" type="url" required />
        </Label>
        <Label htmlFor={fieldId + '-3'} className={LABEL}>
          <span>Credential</span>
          <select id={fieldId + '-3'} className={INPUT} name="credentialKind" defaultValue="bearer">
            {CREDENTIAL_KINDS.map(({ kind, label }) => (
              <option key={kind} value={kind}>
                {label}
              </option>
            ))}
          </select>
        </Label>
        <Label htmlFor={fieldId + '-4'} className={LABEL}>
          <span>Bearer token</span>
          <Input id={fieldId + '-4'} className={INPUT} name="token" type="password" />
        </Label>
        <Label htmlFor={fieldId + '-5'} className={LABEL}>
          <span>Client id</span>
          <Input id={fieldId + '-5'} className={INPUT} name="clientId" />
        </Label>
        <Label htmlFor={fieldId + '-6'} className={LABEL}>
          <span>Client secret</span>
          <Input id={fieldId + '-6'} className={INPUT} name="clientSecret" type="password" />
        </Label>
        <Label htmlFor={fieldId + '-7'} className={LABEL}>
          <span>Issuer</span>
          <Input id={fieldId + '-7'} className={INPUT} name="issuer" type="url" />
        </Label>
        <Label htmlFor={fieldId + '-8'} className={LABEL}>
          <span>Scope</span>
          <Input id={fieldId + '-8'} className={INPUT} name="scope" />
        </Label>
        <OwnerField choices={owners.isOk ? owners.value : []} current={null} help="A person ship or argo. It answers for this server." refusal={owners.isOk ? undefined : owners.refusal} />
        <Label htmlFor={fieldId + '-9'} className={LABEL}>
          <span>Calls at once</span>
          <Input id={fieldId + '-9'} className={INPUT} name="concurrencyLimit" type="number" min={1} max={10} defaultValue={4} />
        </Label>
      </ActionForm>
    </section>
  );
}

/**
 * The Parties page (header design H5: argo's page, now for accounts by
 * scope): the fleet's outside MCP servers, each behind its proxy ship, and
 * for an account holding fleet:manage the forms that approve, crew, state
 * and mark them.
 */
export async function Parties({ page }: { page: SignedInPage }) {
  const { api, fleetId, scopes } = page;
  const parties = await readOf(api.parties.list.query());
  const canManage = scopes.includes(MANAGING_SCOPE);
  const owners = canManage ? await readOf(api.parties.ownerChoices.query()) : undefined;
  return (
    <div className="grid gap-4">
      <h1 className="text-title font-semibold">Parties</h1>
      <p className="text-muted-foreground">Outside MCP servers approved for this fleet, each behind its proxy ship.</p>
      {!parties.isOk ? (
        <div><InlineError title={parties.refusal} variant="section" /></div>
      ) : parties.value.length === 0 ? (
        <EmptyState title="No party yet." variant="section" />
      ) : (
        <div className="relative overflow-x-auto">
          <table className="w-full text-left" data-testid="parties-table">
            <thead>
              <tr className="border-b border-border">
                <th className="p-2">Name</th>
                <th className="p-2">URL</th>
                <th className="p-2">Credential</th>
                <th className="p-2">State</th>
                <th className="p-2">Proxy ship</th>
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {parties.value.map((party) => {
                const state = PARTY_STATES[party.state];
                return (
                  <tr key={party.name} className="border-b border-border align-top">
                    <td className="p-2">{party.name}</td>
                    <td className="p-2 font-mono">{outsideAddressOf(party) ?? ''}</td>
                    <td className="p-2">{party.kind === 'mcpServer' || party.kind === 'a2aAgent' ? party.credentialKind : party.kind === 'mcpClient' ? 'MCP client' : 'A2A client'}</td>
                    <td className="p-2">
                      <StatusBadge tone={state.tone} label={state.label} />
                    </td>
                    <td className="p-2">{party.proxyShipName ?? ''}</td>
                    <td className="p-2">{canManage ? <PartyForms party={party} fleetId={fleetId} /> : null}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {owners === undefined ? null : <ApproveForm fleetId={fleetId} owners={owners} />}
    </div>
  );
}

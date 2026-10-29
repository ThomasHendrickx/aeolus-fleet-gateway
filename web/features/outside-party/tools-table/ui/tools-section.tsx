import type { GatewayApi } from '../../../../lib/gateway-api/gateway-api';
import { readOf } from '../../../../lib/gateway-api/page-api';
import { tableToolsOf } from '../table-tools';
import { ToolsTable } from './tools-table';

/** How the API refuses a sign-in server's tools while nobody holds a usable sign-in to it (src/adapters/trpc/router.ts, NOT_SIGNED_IN). */
const NOBODY_SIGNED_IN = 'PRECONDITION_FAILED';

/** Whether the actor approves the party, and the scopes the fleet lists when it does: what the controls need. */
export async function approvalOf({ api, name }: { api: GatewayApi; name: string }) {
  const approving = await readOf(api.parties.approving.query({ name }));
  const canChange = approving.isOk && approving.value.isApproving;
  const listed = canChange ? await readOf(api.parties.listedScopes.query()) : undefined;
  return {
    canChange: canChange && listed?.isOk === true,
    listed: listed?.isOk === true ? listed.value.scopes : null,
    /** Why the controls are not shown, when the actor holds gateway:approve but may not use them now. */
    reason: approving.isOk ? (approving.value.isApproving ? (listed?.isOk === false ? listed.refusal : null) : approving.value.reason) : approving.refusal,
  };
}

/**
 * An outside MCP server's tools section (gateway scopes 4.3): the tools the
 * server lists now, the scopes each needs, and whether the actor may change
 * them, read side by side. It streams in behind skeleton rows, as the
 * server's tools/list may take a while. A server where each person signs in
 * lists none until someone holds a usable sign-in (decision 0067), and says so.
 */
export async function ToolsSection({ api, fleetId, name, isApprover, isSignIn }: { api: GatewayApi; fleetId: string; name: string; isApprover: boolean; isSignIn: boolean }) {
  const [read, requirements, approval] = await Promise.all([
    readOf(api.parties.tools.query({ name })),
    readOf(api.parties.scopeRequirements.query({ name })),
    isApprover ? approvalOf({ api, name }) : { canChange: false, listed: null, reason: null },
  ]);
  if (!requirements.isOk) {
    return <p className="text-muted-foreground">{requirements.refusal}</p>;
  }
  if (isSignIn && !read.isOk && read.code === NOBODY_SIGNED_IN) {
    return <p className="text-muted-foreground">{read.refusal}</p>;
  }
  return (
    <div className="grid gap-3">
      {approval.reason === null ? null : (
        <p className="text-muted-foreground" data-testid="tools-table-read-only-reason">
          You see these read-only: {approval.reason}
        </p>
      )}
      <ToolsTable
        fleetId={fleetId}
        party={name}
        tools={tableToolsOf({ read, requirements: requirements.value })}
        version={requirements.value.version}
        partyScopes={requirements.value.party}
        listed={approval.listed}
        canChange={approval.canChange}
        serverRefusal={read.isOk ? null : read.refusal}
      />
    </div>
  );
}

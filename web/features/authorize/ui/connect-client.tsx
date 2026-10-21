import { CARD } from '../../forms/ui/look';
import { PickHolder } from './pick-holder';

/** The page at /authorize: the client asking, and the two picks. */
export function ConnectClient({ client, fields }: { client: { clientId: string; clientName: string; redirectUri: string }; fields: readonly [string, string][] }) {
  return (
    <section className="grid gap-4" data-testid="authorize-pick">
      <h1 className="text-heading font-semibold">Connect an MCP client</h1>
      <p>
        <strong>{client.clientName}</strong> asks to call your fleet&apos;s ships through the gateway.
      </p>
      <PickHolder fields={fields} />
      <p className={`${CARD} text-muted-foreground`}>
        Client <span className="font-mono">{client.clientId}</span>, sent back to <span className="font-mono">{client.redirectUri}</span>.
      </p>
    </section>
  );
}

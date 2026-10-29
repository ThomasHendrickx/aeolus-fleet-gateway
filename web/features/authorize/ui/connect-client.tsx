import { Handshake } from './handshake';
import { PickHolder } from './pick-holder';

/** The page at /authorize: the client asking, the two picks, and the client it is. */
export function ConnectClient({ client, fields }: { client: { clientId: string; clientName: string; redirectUri: string }; fields: readonly [string, string][] }) {
  return (
    <section className="grid gap-4" data-testid="authorize-pick">
      <Handshake partyName={client.clientName} />
      <h1 className="text-title font-semibold">Connect an MCP client</h1>
      <p>
        <strong>{client.clientName}</strong> asks to call your fleet&apos;s ships through the gateway.
      </p>
      <PickHolder fields={fields} />
      <p className="text-muted-foreground [overflow-wrap:anywhere]">
        Client {client.clientId}, sent back to {client.redirectUri}.
      </p>
    </section>
  );
}

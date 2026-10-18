# Aeolus gateway

`@aeolus-fleet/gateway`: outside MCP servers and clients join an [Aeolus](https://github.com/ThomasHendrickx/aeolus-fleet) fleet as ships, through one gateway beside core. Its design is aeolus-fleet's docs/design/interop/interop.md.

## Run

```sh
npm install && npm run build
DATABASE_URL=postgresql://... FLEET_URL=https://fleet.example.com npm start
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | required | The gateway's own Postgres 16 or newer database, with a direct connection |
| `FLEET_URL` | required | The fleet's public URL (`http://` or `https://`) |
| `HOST` | `127.0.0.1` | Interface to listen on |
| `PORT` | `4200` | Port to listen on |
| `INSTALLATION_TOKEN` | unset | The token a hosting service presents to the installation procedures (at least 32 characters, decision 0021). Unset: they are off and every fleet is served, as a self-hosted gateway needs; set: a fleet is served once switched on |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent` |

| Command | Does |
| --- | --- |
| `aeolus-gateway start` | Reads core's version and exits 1 when core is older than it needs (core 0.27.0 or later), saying both versions; migrates its database; serves |
| `aeolus-gateway migrate` | Migrates its database, and nothing else. Needs `DATABASE_URL` alone |

`GET /api/version` answers the version it runs, and `GET /api/health` answers `{ "status": "ok" }` while its database answers, else 503.

## Connect

argo commissions the gateway's ship in the console with `fleet:read`, `fleet:commission` and `fleet:on-behalf`, and connects the gateway with it; the gateway registers with the ship's secret and keeps only the crew token. The gateway serves only a fleet with a registered networking plugin (interop I-3): it refuses to connect without one, and refuses to be switched on for a connected fleet without one. Until core says whether a plugin is registered, a crewed ship of type `networking-plugin` counts as one.

The API is tRPC at `/trpc`: `connection.status` and `connection.connect` take argo's console session cookie, checked with the fleet's `console.session`; `installation.setEnabled`, `installation.get` and `installation.delete` take the installation token in `x-aeolus-installation-token`.

## Parties

argo approves an outside MCP server as a party with `parties.approve` (argo's console session): its name, its Streamable HTTP URL, the credential the gateway calls it with (a static bearer, or OAuth client credentials with their issuer), the owner argo picks for it (a person's ship or argo) and how many calls it takes at once (1 to 64, 4 by default). The gateway, as its own ship, commissions the party's app proxy ship of type `mcp-server` with that owner, crews it, and keeps its crew token. argo labels the proxy ship in the console, as any ship, for the network rules to select it. `parties.list` shows each party without its credential or crew token. A proxy ship left awaiting crew (the commission's answer was lost, and its secret with it) takes a new secret from a new starting prompt with `parties.crew`.

The gateway keeps outside credentials and crew tokens as they are in its own database, as squadrons keeps crew tokens: a key on the same server would protect only backups. Guard the database and its backups accordingly.

`parties.state` states the proxy ship anew from the server's `tools/list`: each tool is one capability with its MCP fields and annotations, called with `application/vnd.aeolus.mcp-tool+json; name=<tool>` (the tool arguments as a JSON object) and answered with `application/vnd.aeolus.mcp-result+json; name=<tool>` (the tool result). The summary names the party only, never its URL or credential. `parties.markTool` marks a tool repeatable, or takes the mark off, and states it at once: only argo's mark lets the gateway hand a call that died unanswered again; the server's hints never do.

Commissioning an app ship with a named owner needs core 0.28 (aeolus-fleet#959), and so do the statement's `annotations` and `repeatable` fields (aeolus-fleet#956): core 0.27 refuses a statement that holds them.

## MCP out

From its start, and as soon as a party is crewed, the gateway takes the calls of each crewed party's proxy ship as its crew (interop 5.2). A ship of the fleet calls a tool by sending the proxy ship the tool's input type, `application/vnd.aeolus.mcp-tool+json; name=<tool>`, with the tool arguments as a JSON object. The gateway reports it handed, makes the `tools/call` with the vault's credential, and replies with the result (an error result included) naming the request, then acknowledges and reports it handled. It keeps each call in its database, so a restart replies again and never calls again what may have run.

- A call the server never got (it was unreachable, or refused the credential) is handed again after a wait, and the fleet stops it at the fifth attempt.
- A call sent with no answer (a broken stream, no answer within 5 minutes) is handed again only when argo marked its tool repeatable. Otherwise the gateway reports it not handled: it may have run, and a human who can check the outside system resends or dismisses it.
- A party takes at most its concurrency limit of calls at once, and never more than 10, the most core's pushReceive takes.

With core 0.27 the not handled report is refused (aeolus-fleet#955): the call is never made again, and its delivery stays handed until argo resends or dismisses it.

## Develop

```sh
npm install
npm run typecheck && npm run lint && npm test
```

The integration tests need Docker or Podman: they start Postgres in Testcontainers and a real core from the `@aeolus-fleet/core` devDependency.

## Licence

Apache-2.0.

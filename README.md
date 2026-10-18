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

argo commissions the gateway's ship in the console with `fleet:read`, `fleet:commission`, `fleet:on-behalf` and `labels:assign`, and connects the gateway with it; the gateway registers with the ship's secret and keeps only the crew token. The gateway serves only a fleet with a registered networking plugin (interop I-3): it refuses to connect without one, and refuses to be switched on for a connected fleet without one. Until core says whether a plugin is registered, a crewed ship of type `networking-plugin` counts as one.

The API is tRPC at `/trpc`: `connection.status` and `connection.connect` take argo's console session cookie, checked with the fleet's `console.session`; `installation.setEnabled`, `installation.get` and `installation.delete` take the installation token in `x-aeolus-installation-token`.

## Develop

```sh
npm install
npm run typecheck && npm run lint && npm test
```

The integration tests need Docker or Podman: they start Postgres in Testcontainers and a real core from the `@aeolus-fleet/core` devDependency.

## Licence

Apache-2.0.

# Aeolus gateway

`@aeolus-fleet/gateway`: outside MCP servers and clients join an [Aeolus](https://github.com/ThomasHendrickx/aeolus-fleet) fleet as ships, through one gateway beside core. Its design is aeolus-fleet's docs/design/interop/interop.md.

## Run

```sh
npm install && npm run build
FLEET_URL=https://fleet.example.com npm start
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `FLEET_URL` | required | The fleet's public URL (`http://` or `https://`) |
| `HOST` | `127.0.0.1` | Interface to listen on |
| `PORT` | `4200` | Port to listen on |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent` |

At start the gateway reads core's version and exits 1 when core is older than it needs (core 0.27.0 or later), saying both versions.

## Develop

```sh
npm install
npm run typecheck && npm run lint && npm test
```

The integration tests need Docker or Podman: they start Postgres in Testcontainers and a real core from the `@aeolus-fleet/core` devDependency.

## Licence

Apache-2.0.

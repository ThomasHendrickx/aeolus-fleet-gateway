---
name: aeolus-fleet-gateway
description: Mandatory with test-driven-development for every aeolus-fleet-gateway code change. Layout, test layers, the fleet it runs against and what lint enforces.
---

# The gateway in aeolus-fleet-gateway

Load with `test-driven-development`, and with `domain-modelling` and `typescript` for code.

Layout:
- `src/core/<area>/`: domain, use cases and their ports. A use-case file declares an exported factory named `create<Name>`.
- `src/adapters/<kind>/`: fleet (core's ship contract over REST), mcp, prisma, http. Commands in `src/bin/`.
- Business outcomes are `Result` values in the core; adapters throw only for system failures.

Tests:
- Commit scope is the area: `test(<area>): <rule> (red)`, then `feat(<area>): <rule>`.
- Unit: Vitest beside the file, in-memory ports, no `vi.mock`, no `vi.fn` or `vi.spyOn` in `src/core`.
- Integration: `test/*.integration.test.ts`, one Testcontainers Postgres 16 per run, each file its own database. A real core runs from the `@aeolus-fleet/core` devDependency's `aeolus-core` bin against it (`test/support/`).
- The mock CRM MCP server (`test/fixtures/mock-crm/`) is the outside party every MCP out test calls; it counts each call it ran.
- Guarantees to prove: nothing answers an outside call before the fleet's `send` answered OK; a call that may have run is never repeated unless marked repeatable; a restart loses no delivery.

Fleet:
- Every call to core goes through the fleet port, as the ship it crews, never with argo's session.
- Core's minimum version is `MINIMUM_CORE_VERSION` in `src/adapters/fleet/core-version.ts`; raise it in the same PR as a call that needs a newer core, and in aeolus-fleet's docs/compatibility.md.
- When core has a release candidate with a breaking change, run the fleet contract tests against it before core is released.

Enforced by lint (`eslint.config.js`): core imports and purity, Prisma in its adapter, `any`, casts, `!`, exhaustive switches, parameter count, boolean names, default exports, file names, no `throw` in core.

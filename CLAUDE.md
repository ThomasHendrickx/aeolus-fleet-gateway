# Aeolus gateway: guidelines for Claude Code

## What the gateway is

Outside MCP servers and clients (later A2A agents) join an Aeolus fleet as ships, through one gateway beside core. Each outside party is a proxy ship the gateway crews; core's network decides every interaction, and the gateway decides no reach of its own.

Aeolus's two promises hold through it: no message is ever lost, and the gateway answers an outside call only after the fleet's `send` answered OK.

## Source of truth

The fleet's docs live in ThomasHendrickx/aeolus-fleet, never copied here:

- docs/blueprint.md: product, language, behaviour.
- docs/decisions/README.md: every decision in one line, one numbering for every repository. Do not reopen a recorded decision; raise it as a question instead.
- docs/design/interop/interop.md (branch design/interop): the gateway's design, decisions I-1 to I-9 and the slice order (3.6).
- docs/compatibility.md: what the gateway needs from core, and the minimum core version.

If the docs do not answer a behaviour question, stop and ask. Never decide product behaviour yourself.

## House rules

- npm only (npm install, npm run, npm test). Never pnpm or yarn.
- English for all code, names, comments, commits, paths and database fields.
- No em dashes anywhere: code, docs, commits, PR text.
- Use the ubiquitous language from the blueprint (ship, type, crew, lease, commission, release, retire, delivery). Invent no synonyms or new terms: name the concrete parts, and split a block that covers two things.

## Architecture rules

- One package, @aeolus-fleet/gateway, with an MCP adapter now and an A2A adapter later (I-6). It reaches the fleet only through core's public ship contract, as the ships it crews.
- Ports and adapters. src/core holds domain, use cases and ports, with no framework, Prisma, pg or MCP SDK imports. The lint rule enforces it; never disable it.
- Prisma lives in src/adapters/prisma only, against the gateway's own database.
- Every table has fleet_id. Every query is scoped by it.
- @aeolus-fleet/common comes from npm at a stated version; ids and the fleet's schemas come from it.
- Policy stays in core: the gateway shows and allows exactly what core answers for the proxy ship.
- Before 1.0.0 breaking changes are allowed (decision 0013). Keep designs minimal: no compatibility layers, no backward-compatibility work and no paid-product polish for zero customers. Flag such a request as overengineering.
- Payloads are at most 64 KB. A message is the travelling ticket; the reference is where the content lives.

## Skills

Load the matching skills from `.claude/skills/` (Codex: `.agents/skills/`) before the work they name. They are mandatory, not suggestions:

- `test-driven-development` and `aeolus-fleet-gateway`: every code change. Strict red, green, refactor.
- `domain-modelling`: anything under `src/core` or `src/adapters`.
- `typescript`: every `.ts` change.
- `code-review`: reviewing a branch, pull request or diff.
- `pull-request`: writing a pull request body.
- `writing-for-agents`: editing CLAUDE.md, a skill, or a doc agents read.

`aeolus-fleet-gateway` lives here. The others come from ThomasHendrickx/skills, pinned in `skills-lock.json`: never edit them here; change them there, tag a release, then `npx skills@1.7.2 add ThomasHendrickx/skills#<tag> --agent claude-code codex -y`.

## Quality

- npm run typecheck, npm run lint and npm test green before every commit, except a test-driven red commit that only adds the failing test and is labelled `(red)`. Push only a green head. Zero lint errors, no eslint-disable without a comment explaining why.
- Every use case has unit tests with in-memory ports. Every adapter that touches Postgres has a Testcontainers test.
- Delivery guarantees are proven by tests: concurrency, rollback, restart. A guarantee without a test does not exist.
- Report a test as passing only after you saw it run by name.
- No any without a comment explaining why.

## Working

Do what the prompt and the docs ask, nothing more: done means the acceptance criteria are met, and earlier slices are not precedent.

- One slice per session, one PR per slice, kept thin. Commit per logical step, not one catch-up commit.
- A finding that does not block the criteria is not acted on: a real defect is filed as an issue, anything else goes in the PR.
- New core fleet functionality is built only from a design Thomas approved. A design goes purpose first, then the lessons to check against, then questions, with no detailed decisions before the purpose is agreed. A backbone design has a full flow diagram, happy and unhappy paths. Foundational work goes structure first, approved, then one part at a time.
- Repo text must serve the current commit. What git shows (what changed, the steps taken) lives in commits and the PR, never in files. Decisions go into the docs or an ADR as current state.
- New rules, checks, exceptions or process steps come only from Thomas: propose, never add.
- No self-review passes. The one review is a clean-room session after the PR.

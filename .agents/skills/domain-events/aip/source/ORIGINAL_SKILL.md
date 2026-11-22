---
name: domain-events
description: Use when a state change must reach another bounded context or outside system (email, bus, third-party API), others must learn what happened, or a consumer must survive redelivery or reordering.
---

# Problem

Matters when one or more holds:

1. A state change must trigger work in another bounded context or outside system, and a direct call couples them. Signal: a use case calls another context's API or module after saving.
2. A side effect outside the database (email, bus, third-party API) runs before commit or without retry. Signal: send or publish inside or right after the transaction, no outbox.
3. Others must learn what happened (another context's projection, audit). Signal: polling or diffing another context's tables.
4. Consumers break on redelivery or reordering. Signal: a handler that increments or inserts with no record of what it processed.

# Solution

- The aggregate records a past-tense event in the same unit of work as its change (`domain-modelling`); the use case writes it to an outbox table in that transaction. (2, 3)
- A relay publishes outbox rows after commit, at least once, with retry. (2)
- Across contexts, an integration event: a versioned published contract mapped from the internal event. (1, 3)
- Consumers are idempotent and check the aggregate version. (4)
- Inside one context, follow-up work is an explicit call in the use case, not an event handler. (1)

# Not needed when

The reaction lives in the same context and the same transaction: call it explicitly. No consumer exists yet: record the event (`domain-modelling`), publish nothing.

# Rules

1. An event is a past-tense fact from the domain's event list, never a command in disguise (`SendWelcomeEmail`).
2. An event is written to the outbox in the change's transaction; nothing publishes directly.
3. Only the relay publishes, after commit, at least once.
4. A consumer records the event id it processed in the same transaction as its effect.
5. A consumer ignores an event older than the aggregate version it has seen; no ordering is assumed across aggregates.
6. Internal events never leave their context; other contexts get an integration event, a published contract with one producer.
7. A contract carries ids and the facts of the change; carrying state for consumers is a declared choice in the contract.
8. Contract changes are additive; a breaking change is a new version.
9. A failing consumer retries, then lands in a dead-letter with an alert; never silently dropped.

# Failure modes

1. Dual write: save, then publish to the bus.
2. Dispatch before commit: an email for an order that rolled back.
3. A command disguised as an event.
4. Chains of in-process handlers that hide the flow.
5. Internal domain events published to other contexts, coupling them to the model.
6. A consumer that double-applies on redelivery.
7. The whole aggregate as payload by default.
8. Integration events published "for later" with no consumer.
9. Consumer failures swallowed.

# Procedures

Companion inputs: `paths.domain`, `paths.eventList`, `paths.integrationEvents`, `paths.consumers`, `checks.dependencyDirection`, `checks.eventTests`, `infraModules` (bus, mail and third-party clients).

## P0 Applicability gate (entry)

1. script: parse `paths.domain` and use cases for imports of bus, mail or third-party clients from `infraModules` -> `violations[]` (rule 2).
2. agent: check the task for problems 1-4 -> `problems[]`.
3. agent: the task touches a direct publish or an in-process handler chain -> `applies` (P4); reaction in the same context and transaction -> stop, explicit call; no problems -> stop; else -> `applies`.

## P1 Record and publish an event

1. agent: name the fact in past tense; add it to `paths.eventList` first -> event spec.
2. agent: scenarios: change commits -> one outbox row; change rolls back -> none -> failing tests.
3. agent: the aggregate records the event; the use case writes it to the outbox in the unit of work.
4. agent: relay publishes after commit with retry (reuse an existing relay).
5. script: run `checks.dependencyDirection` and `checks.eventTests`.

## P2 Publish to another context

1. agent: name the consumer and its need; none -> stop.
2. agent: contract in `paths.integrationEvents`: name, version, the fields the need requires; state transfer declared if carried -> contract spec.
3. agent: contract test on the payload.
4. agent: relay maps the internal event to the contract.
5. script: run `checks.dependencyDirection` and `checks.eventTests`.

## P3 Add a consumer

1. agent: scenarios: event once -> effect once; same event twice -> effect once; older version after newer -> ignored; handler failure -> retried, then dead-letter -> failing tests.
2. agent: handler records the processed event id in the effect's transaction.
3. agent: retry, then dead-letter with alert.
4. script: run `checks.dependencyDirection` and `checks.eventTests`.

## P4 Replace a direct publish or in-process chain

1. agent: scope = the direct publishes or in-process handler chains the task touches; everything else stays unchanged -> scope list.
2. agent: direct publish -> P1; same-transaction handler -> explicit call in the use case.
3. agent: remove the old path only when nothing uses it.
4. script: run `checks.dependencyDirection` and `checks.eventTests`.

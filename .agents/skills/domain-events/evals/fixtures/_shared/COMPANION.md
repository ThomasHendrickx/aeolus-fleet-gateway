# Repo companion (fixture)

Bounded contexts: `src/sales` (orders, invoices) and `src/shipping` (fulfilment), each with `core` (domain model, use cases in `core/commands`) and `adapters`.

paths.domain: src/sales/core src/shipping/core
paths.eventList: docs/event-list.md
paths.integrationEvents: src/contracts
paths.consumers: src/shipping/consumers
paths.compositionRoot: src/main.py
checks.dependencyDirection: python3 check_direction.py
checks.eventTests: python3 -m unittest discover -s tests -t .
infraModules: src.infra.bus src.infra.mail
database: Postgres; its URL is in database.url. Tests reset the schema from schema.sql.
bus: `src/infra/bus.py` is the message-bus client (`publish`, `fetch`); the broker keeps its messages in `bus_messages`, written on the client's own connection.

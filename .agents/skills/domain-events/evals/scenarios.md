# domain-events scenarios

Run every scenario independently against a fresh fixture with both `SKILL.md` and `aip/`, with `harness.py` (see its docstring); results live in `results/`. A result is PASS, FAIL, or NOT RUN. A missing run is NOT RUN. Fixtures are real Python code on a real Postgres (`harness.py postgres` starts a container; each run gets its own database), with a task written as a person would; none names a problem number or the expected behaviour. A fixture is `fixtures/_shared` (a shop with a Sales and a Shipping context, a bus client and a mail client that write on their own connections) plus its own folder.

| ID | Kind | Fixture | Given / When / Then |
| --- | --- | --- | --- |
| S0.1 | script | `order-total` | Given a task to recompute an order's total inside the Order aggregate, When P0 runs, Then applies is false and no event is added. |
| S0.2 | script | `direct-publish` | Given a use case importing the bus client, When P0 runs, Then it is in violations. |
| S0.3 | agent | `invoice-paid` | Given "when an invoice is paid, shipping must start fulfilment", When P0 runs, Then problems includes 1. |
| S1.1 | script | `invoice-paid` | Given InvoicePaid, When P1 completes, Then a committed change leaves one outbox row and a rolled-back change leaves none. |
| S1.2 | script | `invoice-paid` | Then no domain or use case file imports the bus client. |
| S1.3 | agent | `invoice-paid` | Then the event is a past-tense fact and listed in paths.eventList. |
| S2.1 | script | `invoice-paid` | Given shipping as the consumer, When P2 completes, Then a versioned contract exists in paths.integrationEvents and no shipping code imports the internal event type. |
| S2.2 | agent | `invoice-paid` | Then the payload holds only the fields Shipping needs, plus the ids and version every event carries (rule 7). |
| S2.3 | script | `no-consumer` | Given a task with no consumer named, When P2 runs, Then it stops and no contract file exists. |
| S3.1 | script | `consumer` | Given a consumer, When the same event arrives twice, Then the effect happens once. |
| S3.2 | script | `consumer` | When an older version arrives after a newer one for the same aggregate, Then it is ignored. |
| S3.3 | script | `consumer` | When the handler fails, Then it is retried and ends in the dead-letter, not dropped. |
| S4.1 | script | `direct-publish` | Given two use cases publishing directly, one touched by the task, When P4 completes, Then the touched one writes to the outbox and the other is unchanged. |
| S4.2 | agent | `handler-chain` | Given an in-process handler doing a same-transaction update, When P4 completes, Then it is an explicit call in the use case. |

S0.1 is the intentional no-problem control. A scenario S1.x to S4.x whose run P0 stopped (applies not true) is NOT RUN, whatever its check says: its procedure never ran. Every other fixture carries a real problem signal: `direct-publish` publishes before the save, `invoice-paid` needs another context to react, `no-consumer` mails the payment receipt before commit and has other teams asking what happened, with no team subscribing, `consumer` double-applies, reorders and swallows failures, `handler-chain` also mails a receipt from an in-process handler before commit.

How the script checks work, beyond the obvious:

- S1.1 and S4.1 seed through the app's own use cases, then add a deferred constraint trigger on `invoices` that refuses one invoice's commit, so the payment's transaction rolls back after all its statements ran. No table may change (the broker's `bus_messages` included); a committed payment must add exactly one row to one table the fixture did not have (the outbox).
- S1.2 runs the P0 scanner over `paths.domain`.
- S2.1: a contract is a new module in `paths.integrationEvents` that names a version (`version`, `v1`, `V1`); shipping code is checked for any import of `src.sales`.
- S3.1 to S3.3 publish to the bus directly and run the `deliver` command the agent declared in `CONSUMER.json` (3 passes; 8 for S3.3). S3.2 publishes InvoiceRefunded (invoice version 3) before InvoicePaid (version 2): no fulfilment may be left requested. S3.3 adds a trigger that refuses the fulfilment and counts attempts with a sequence (sequences survive rollback): at least 2 attempts, and the message in the result of the declared `dead_letter` query.
- S0.2 and S0.3 are read from the agent's `RESULT.json`; S1.3, S2.2 and S4.2 are judged by a separate agent from the diff.

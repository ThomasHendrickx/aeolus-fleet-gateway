# Report

P0: no violations (core imports no infra; check_direction ok); problem 4 (redelivery/reordering, plus swallowed failures, rule 9) -> applies true. RESULT.json written first. Not P4 (no direct publish or handler chain in scope).

P3 done:
- Scenario tests added in tests/test_invoice_consumer.py: duplicate event -> one fulfilment; refund before payment -> none; failure retried then dead-lettered; retry succeeds after transient failure.
- schema.sql: processed_events, seen_invoice_versions, consumer_retries, dead_letters.
- Core use case `handle_invoice_event` (src/shipping/core/commands.py) records event id and invoice version in the effect's transaction; ignores duplicates and versions <= seen. Pg adapters and main.py wiring added.
- worker.py: failed messages go to consumer_retries with exponential backoff (30s*2^n); after 5 attempts moved to dead_letters with a critical-log alert. `--ignore-backoff` / run_once(ignore_backoff=True) treats waits as elapsed.
- check_direction ok; all 11 tests pass.

CONSUMER.json: deliver = `python3 -m src.shipping.consumers.worker --ignore-backoff`; dead_letter = SELECT from dead_letters.
Not done: the alert is a log line only (no alerting system in the repo). Not a git repo, so no diff.

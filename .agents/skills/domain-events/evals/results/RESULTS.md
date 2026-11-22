# Scenario results

Every run was rerun on 2026-11-07 for issue #48, after P0 step 3 changed: P0 is the entry for every run. That makes one fresh run per fixture and form, all by Sonnet 5.5 subagents (`claude-sonnet-5-5`). Each run followed the form under test (`SKILL.md`, or `aip/` with its scripts) and was driven by `../harness.py`. Each agent was told to read its run's `PROMPT.md` and do exactly what it says. Each run had its own database on a real Postgres 17 container (`harness.py postgres`, podman). Script scenarios are executable checks the harness ran on the finished repositories, each against a fresh check database. S0.2 and S0.3 are read from the agent's own P0 output (`RESULT.json`). S1.3, S2.2 and S4.2 were judged by separate Sonnet 5.5 judges from the diff and the finished repository. A pass is a single observation, not a rate.

S1.x to S4.x are gated: if P0 stopped the run (`applies` not true), the scenario is NOT RUN, whatever its check says, because its procedure never ran (aip-skill-writing rule 7). Every gated scenario below ran with `applies` true. `self-test.md` is `check` on the unchanged fixtures with no agent:
- With `applies` false, every gated scenario is NOT RUN.
- With `applies` true, S1.2 and S2.3 hold for a repository that did nothing, and every other script check fails.

Evidence per run is in `transcripts/<form>-<run>.{prompt.md,md,diff}`: the exact prompt, the agent's own report and the repository diff. `check-output.md` is the raw `harness.py check` output and `results.json` the table as data. The compiler validation (`validate-aip.txt`, real `validate.py` output) and the count check (`check-aip.txt`) were rerun after the recompile. The scanner unit test (`scan-unit-test.txt`) is from #47; the scanner is unchanged.

| Scenario | SKILL.md | AIP | notes (SKILL.md / AIP) |
| --- | --- | --- | --- |
| S0.1 | PASS | PASS | applies=false, event list and events module unchanged / same, and P0 notes that no direct publish or handler chain is touched |
| S0.2 | PASS | PASS | `pay_invoice.py` and `cancel_invoice.py` in violations / same |
| S0.3 | PASS | PASS | problems 1 / problems 1, 2, 3 |
| S1.1 | PASS | PASS | rolled-back payment changed no table; committed payment added one `sales_outbox` row / same |
| S1.2 | PASS | PASS | no domain or use case file imports the bus client / same |
| S1.3 | PASS | PASS | `InvoicePaid`, recorded by `Invoice.pay`, listed in `docs/event-list.md` / same |
| S2.1 | PASS | PASS | `src/contracts/invoice_paid.py` (`sales.invoice-paid.v1`), no shipping import of sales / `src/contracts/invoice_paid.py` (InvoicePaid v1), same |
| S2.2 | PASS | PASS | order id and date, plus event id, invoice id and invoice version / same |
| S2.3 | PASS | PASS | P0 applied (problem 2: receipt mailed before commit), P1 moved the receipt to an outbox and relay, P2 step 1 stopped with no consumer, no contract file / same |
| S3.1 | PASS | PASS | the same InvoicePaid delivered twice gives one fulfilment / same |
| S3.2 | PASS | PASS | InvoiceRefunded v3 before InvoicePaid v2 leaves no fulfilment requested / same |
| S3.3 | PASS | PASS | 5 attempts, then the message is in the dead-letter / 5 attempts, then the same |
| S4.1 | PASS | PASS | rolled-back payment changed no table; committed payment added one outbox row; `cancel_invoice.py` unchanged / same |
| S4.2 | PASS | PASS | P0 applied through the new P4 branch, `pay_invoice` credits the account explicitly, `credit_customer_account` removed from `HANDLERS` / same |

## Notes

- S4.2 (#48): P0 step 3 now checks first whether the task touches a direct publish or an in-process handler chain, and if so applies through P4. Before, its same-context stop ended the run, so P4 never ran. Both agents now set `applies` true with no problem numbers, citing the handler chain. Both replaced the `credit_customer_account` handler with an explicit call in `pay_invoice` that also stores the date, and kept the dispatcher for the receipt handler. Both kept the receipt, mailed before commit, out of scope as untouched by the task (P4 step 1).
- S2.3 (#48): the `no-consumer` fixture's `pay_invoice` now also mails the receipt inside the transaction, and the task asks to send it only for a recorded payment. The publish request is unchanged. Problem 2 holds, so P0 applies; the run is "P0, then P1, then P2" (it was "P0, then P2"). Both agents fixed the receipt through P1 (outbox and relay), and both stopped at P2 step 1 with no consumer. The AIP agent also ran P4 on the mail call, and added a test that `bus_messages` stays empty.
- S2.2 (#48): Thomas reworded the scenario to "Then the payload holds only the fields Shipping needs, plus the ids and version every event carries (rule 7)." It was rejudged on both forms from the existing run records, by a fresh Sonnet 5.5 judge per form. Each got the scenario sentence, `TASK.md` and the run's repository diff, and no rules or procedure steps (`judge-skill-md.json`, `judge-aip.json`). Both passed: the contract holds order_id and paid_on, plus event_id, invoice_id and invoice_version.
- `judge-skill-md-first.json` and `judge-aip-first.json` judged the earlier wording and are not scored.
- The SKILL.md form ships no scripts, so those agents did the P0 import scan by hand; the AIP agents ran `scan_infra_imports.py`. The SKILL.md direct-publish agent notes that `check_direction.py` misses `from src.infra import bus`; it found both violations by reading the imports.
- Beyond the tasks: no run scheduled its relay (each says something must call it), and the alert on dead-letter is a log line or a mail to a placeholder address. Not scored.

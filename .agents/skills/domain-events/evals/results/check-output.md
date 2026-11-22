| Scenario | SKILL.md | AIP | notes (SKILL.md / AIP) |
| --- | --- | --- | --- |
| S0.1 | PASS | PASS | applies=False event list or events module changed=[] / applies=False event list or events module changed=[] |
| S0.2 | PASS | PASS | violations=['src/sales/core/commands/cancel_invoice.py', 'src/sales/core/commands/pay_invoice.py'] / violations=['src/sales/core/commands/cancel_invoice.py', 'src/sales/core/commands/pay_invoice.py'] |
| S0.3 | PASS | PASS | problems=[1] applies=True (agent's P0 output) / problems=[1, 2, 3] applies=True (agent's P0 output) |
| S1.1 | PASS | PASS | rolled-back payment: raised RaiseException, tables changed=[]; committed payment: committed, rows gained in new tables={'sales_outbox': 1} / rolled-back payment: raised RaiseException, tables changed=[]; committed payment: committed, rows gained in new tables={'sales_outbox': 1} |
| S1.2 | PASS | PASS | domain or use case files importing the bus client=[] / domain or use case files importing the bus client=[] |
| S1.3 | PASS | PASS | InvoicePaid is a past-tense event in src/sales/core/events.py and is listed in docs/event-list.md as 'a customer paid an invoice'. / src/sales/core/events.py adds InvoicePaid (past-tense fact, raised in invoices.py pay()), and docs/event-list.md lists InvoicePaid with its fields. |
| S2.1 | PASS | PASS | contract files=['invoice_paid.py'] versioned={'invoice_paid.py': True} shipping imports of sales=[] / contract files=['invoice_paid.py'] versioned={'invoice_paid.py': True} shipping imports of sales=[] |
| S2.2 | PASS | PASS | In invoice_paid.py (src/contracts) the published FIELDS are only order_id and paid_on, which TASK.md says Shipping needs, plus the ids and version (event_id, invoice_id, invoice_version). Nothing else is included, such as an amount or customer data. / In invoice_paid.py the contract FIELDS are event_id, invoice_id, order_id, paid_on and invoice_version. TASK.md says Shipping needs the order and the payment date, which are order_id and paid_on. The remaining fields are the ids and the version every event carries, so the payload has no extra state. |
| S2.3 | PASS | PASS | applies=True contract files added=[] / applies=True contract files added=[] |
| S3.1 | PASS | PASS | same InvoicePaid delivered twice -> fulfilments for o1=[('requested',)] deliver exits=[0, 0, 0] / same InvoicePaid delivered twice -> fulfilments for o1=[('requested',)] deliver exits=[0, 0, 0] |
| S3.2 | PASS | PASS | InvoiceRefunded v3 then InvoicePaid v2 -> fulfilments for o2=[] deliver exits=[0, 0, 0] / InvoiceRefunded v3 then InvoicePaid v2 -> fulfilments for o2=[] deliver exits=[0, 0, 0] |
| S3.3 | PASS | PASS | handler attempts=5 dead-letter rows=['(1,shipping,sales.invoices.v1,1,"{""type"": ""InvoicePaid"", ""event_id"": ""e4"", ""order_id"": ""o3"", ""invoice_id"": ""i3"", ""occurred_on"": ""2026-11-02"", ""invoice_version"": 2}",5,"RaiseException: harness: fulfilment refused\nCONTEXT:  PL/pgSQL function harness_fail_o3() line 3 at RAISE","2026-11-07 17:05:55.281633+00")'] message e4 (bus id 1) dead-le / handler attempts=5 dead-letter rows=['(1,"{""type"": ""InvoicePaid"", ""event_id"": ""e4"", ""order_id"": ""o3"", ""invoice_id"": ""i3"", ""occurred_on"": ""2026-11-02"", ""invoice_version"": 2}",5,"RaiseException: harness: fulfilment refused\nCONTEXT:  PL/pgSQL function harness_fail_o3() line 3 at RAISE","2026-11-07 17:06:10.775344+00",t)'] message e4 (bus id 1) dead-lettered=True deliver exits=[ |
| S4.1 | PASS | PASS | rolled-back payment: raised RaiseException, tables changed=[]; committed payment: committed, rows gained in new tables={'outbox': 1}; cancel_invoice.py unchanged=True / rolled-back payment: raised RaiseException, tables changed=[]; committed payment: committed, rows gained in new tables={'sales_outbox': 1}; cancel_invoice.py unchanged=True |
| S4.2 | PASS | PASS | src/sales/core/commands/pay_invoice.py now calls uow.accounts.get, record_payment and save directly in the same transaction, and credit_customer_account is removed from the handler registry in src/sales/core/handlers.py. / src/sales/core/commands/pay_invoice.py now calls uow.accounts.get, record_payment and save explicitly, and credit_customer_account is removed from HANDLERS in src/sales/core/handlers.py (only the receipt remains). |

### S1.3 [skill-md] Then the event is a past-tense fact and listed in paths.eventList.
diff base -> repo:
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/docs/event-list.md ../repo/docs/event-list.md
--- ../base/docs/event-list.md	2026-11-07 17:53:34.559439980 +0100
+++ ../repo/docs/event-list.md	2026-11-07 18:02:41.913882106 +0100
@@ -6,6 +6,7 @@
 
 - OrderPlaced: a customer placed an order (order id, customer id, total).
 - InvoiceIssued: an invoice was issued for an order (invoice id, order id, amount).
+- InvoicePaid: a customer paid an invoice (invoice id, order id, paid on date).
 
 ## shipping
 
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/schema.sql ../repo/schema.sql
--- ../base/schema.sql	2026-11-07 17:53:34.559439980 +0100
+++ ../repo/schema.sql	2026-11-07 18:02:41.913882106 +0100
@@ -25,6 +25,18 @@
     version integer NOT NULL DEFAULT 1
 );
 
+-- Sales outbox: written in the same transaction as the change; the relay publishes rows after commit.
+CREATE TABLE sales_outbox (
+    id bigserial PRIMARY KEY,
+    event_type text NOT NULL,
+    aggregate_id text NOT NULL,
+    aggregate_version integer NOT NULL,
+    payload jsonb NOT NULL,
+    created_at timestamptz NOT NULL DEFAULT now(),
+    published_at timestamptz,
+    attempts integer NOT NULL DEFAULT 0
+);
+
 -- Shipping context
 CREATE TABLE fulfilments (
     id text PRIMARY KEY,
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/contracts/invoice_paid.py ../repo/src/contracts/invoice_paid.py
--- ../base/src/contracts/invoice_paid.py	1970-01-01 01:00:00.000000000 +0100
+++ ../repo/src/contracts/invoice_paid.py	2026-11-07 18:02:41.918882055 +0100
@@ -0,0 +1,24 @@
+"""Integration event sales.invoice-paid, version 1. Producer: sales. Consumer: shipping (starts fulfilment).
+
+Fields are additive-only; a breaking change is a new version (new topic, e.g. sales.invoice-paid.v2).
+Carries ids and the facts of the change only; no state transfer is declared.
+"""
+TOPIC = "sales.invoice-paid.v1"
+VERSION = 1
+FIELDS = {
+    "event_id": int,         # outbox row id; consumers record it to stay idempotent
+    "invoice_id": str,
+    "invoice_version": int,  # aggregate version after the change; consumers ignore older ones
+    "order_id": str,         # the order that was paid
+    "paid_on": str,          # ISO date (YYYY-MM-DD) the invoice was paid
+}
+
+
+def build(event_id: int, invoice_version: int, internal: dict) -> dict:
+    return {
+        "event_id": event_id,
+        "invoice_id": internal["invoice_id"],
+        "invoice_version": invoice_version,
+        "order_id": internal["order_id"],
+        "paid_on": internal["paid_on"],
+    }
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/main.py ../repo/src/main.py
--- ../base/src/main.py	2026-11-07 17:53:34.559439980 +0100
+++ ../repo/src/main.py	2026-11-07 18:02:41.914882096 +0100
@@ -1,4 +1,5 @@
 """Composition root: wires each context's use cases to Postgres."""
+from src.sales.adapters.relay import publish_pending
 from src.sales.adapters.pg import PgSalesUnitOfWork
 from src.sales.core.commands.cancel_invoice import cancel_invoice as _cancel_invoice
 from src.sales.core.commands.issue_invoice import issue_invoice as _issue_invoice
@@ -17,7 +18,9 @@
 
 
 def pay_invoice(invoice_id, paid_on):
-    return _pay_invoice(PgSalesUnitOfWork(), invoice_id, paid_on)
+    version = _pay_invoice(PgSalesUnitOfWork(), invoice_id, paid_on)
+    publish_pending()  # after commit; rows that fail stay in the outbox for the next run
+    return version
 
 
 def cancel_invoice(invoice_id):
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/sales/adapters/pg.py ../repo/src/sales/adapters/pg.py
--- ../base/src/sales/adapters/pg.py	2026-11-07 17:53:34.559439980 +0100
+++ ../repo/src/sales/adapters/pg.py	2026-11-07 18:02:41.914882096 +0100
@@ -1,3 +1,8 @@
+import dataclasses
+import datetime
+
+from psycopg.types.json import Jsonb
+
 from src.db import connect
 from src.sales.core.invoices import Invoice
 from src.sales.core.orders import Order, OrderLine
@@ -50,6 +55,19 @@
         invoice.version = row[0]
 
 
+class PgOutbox:
+    """Writes recorded domain events to sales_outbox on the use case's connection (same transaction)."""
+
+    def __init__(self, conn):
+        self.conn = conn
+
+    def add(self, aggregate_id, aggregate_version, events):
+        for event in events:
+            payload = {k: v.isoformat() if isinstance(v, datetime.date) else v for k, v in dataclasses.asdict(event).items()}
+            self.conn.execute("INSERT INTO sales_outbox (event_type, aggregate_id, aggregate_version, payload) VALUES (%s, %s, %s, %s)",
+                              (type(event).__name__, aggregate_id, aggregate_version, Jsonb(payload)))
+
+
 class PgSalesUnitOfWork:
     """One transaction per use case: commits when the block succeeds, rolls back when it raises."""
 
@@ -59,6 +77,7 @@
         self.tx.__enter__()
         self.orders = PgOrderRepository(self.conn)
         self.invoices = PgInvoiceRepository(self.conn)
+        self.outbox = PgOutbox(self.conn)
         return self
 
     def __exit__(self, *exc):
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/sales/adapters/relay.py ../repo/src/sales/adapters/relay.py
--- ../base/src/sales/adapters/relay.py	1970-01-01 01:00:00.000000000 +0100
+++ ../repo/src/sales/adapters/relay.py	2026-11-07 18:02:41.919882045 +0100
@@ -0,0 +1,39 @@
+"""Outbox relay: publishes sales_outbox rows to the bus after commit, at least once, with retry.
+Maps internal events to integration-event contracts; internal events never leave the context."""
+import time
+
+from src.contracts import invoice_paid
+from src.db import connect
+from src.infra import bus
+
+RETRIES = 3
+
+
+def _to_contract(event_type, row_id, version, payload):
+    """(topic, body) for an internal event that has a published contract, else None."""
+    if event_type == "InvoicePaid":
+        return invoice_paid.TOPIC, invoice_paid.build(row_id, version, payload)
+    return None
+
+
+def publish_pending(retries: int = RETRIES, delay: float = 0.0) -> int:
+    """Publish unpublished rows in id order; returns how many were published. A row is marked published
+    only after the bus accepted it, so a crash in between re-publishes (at least once)."""
+    published = 0
+    with connect(autocommit=True) as conn:
+        rows = conn.execute("SELECT id, event_type, aggregate_version, payload FROM sales_outbox"
+                            " WHERE published_at IS NULL AND event_type = 'InvoicePaid' ORDER BY id").fetchall()
+        for row_id, event_type, version, payload in rows:
+            topic, body = _to_contract(event_type, row_id, version, payload)
+            for attempt in range(1, retries + 1):
+                conn.execute("UPDATE sales_outbox SET attempts = attempts + 1 WHERE id = %s", (row_id,))
+                try:
+                    bus.publish(topic, body)
+                    break
+                except Exception:
+                    if attempt == retries:
+                        return published  # stays unpublished; the next run retries it, order preserved
+                    time.sleep(delay)
+            conn.execute("UPDATE sales_outbox SET published_at = now() WHERE id = %s", (row_id,))
+            published += 1
+    return published
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/sales/core/commands/pay_invoice.py ../repo/src/sales/core/commands/pay_invoice.py
--- ../base/src/sales/core/commands/pay_invoice.py	2026-11-07 17:53:34.559439980 +0100
+++ ../repo/src/sales/core/commands/pay_invoice.py	2026-11-07 18:02:41.914882096 +0100
@@ -6,4 +6,5 @@
         invoice = uow.invoices.get(invoice_id)
         invoice.pay(paid_on)
         uow.invoices.save(invoice)
+        uow.outbox.add(invoice.id, invoice.version, invoice.events)
     return invoice.version
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/sales/core/events.py ../repo/src/sales/core/events.py
--- ../base/src/sales/core/events.py	2026-11-07 17:53:34.559439980 +0100
+++ ../repo/src/sales/core/events.py	2026-11-07 18:02:41.913882106 +0100
@@ -1,5 +1,6 @@
 """Sales domain events (see docs/event-list.md). Aggregates record them in `events`."""
 from dataclasses import dataclass
+from datetime import date
 
 
 @dataclass(frozen=True)
@@ -14,3 +15,10 @@
     invoice_id: str
     order_id: str
     amount_cents: int
+
+
+@dataclass(frozen=True)
+class InvoicePaid:
+    invoice_id: str
+    order_id: str
+    paid_on: date
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/sales/core/invoices.py ../repo/src/sales/core/invoices.py
--- ../base/src/sales/core/invoices.py	2026-11-07 17:53:34.559439980 +0100
+++ ../repo/src/sales/core/invoices.py	2026-11-07 18:02:41.913882106 +0100
@@ -1,7 +1,7 @@
 from dataclasses import dataclass, field
 from datetime import date
 
-from src.sales.core.events import InvoiceIssued
+from src.sales.core.events import InvoiceIssued, InvoicePaid
 
 
 class InvoiceNotPayable(Exception):
@@ -29,6 +29,7 @@
         if self.status != "issued":
             raise InvoiceNotPayable(f"invoice {self.id} is {self.status}")
         self.status, self.paid_on = "paid", on
+        self.events.append(InvoicePaid(self.id, self.order_id, on))
 
     def cancel(self) -> None:
         if self.status != "issued":
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/sales/core/ports.py ../repo/src/sales/core/ports.py
--- ../base/src/sales/core/ports.py	2026-11-07 17:53:34.559439980 +0100
+++ ../repo/src/sales/core/ports.py	2026-11-07 18:02:41.914882096 +0100
@@ -22,9 +22,14 @@
     def save(self, invoice: Invoice) -> None: ...
 
 
+class Outbox(Protocol):
+    def add(self, aggregate_id: str, aggregate_version: int, events: list) -> None: ...
+
+
 class SalesUnitOfWork(Protocol):
     orders: OrderRepository
     invoices: InvoiceRepository
+    outbox: Outbox
 
     def __enter__(self) -> "SalesUnitOfWork": ...
 
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/tests/test_invoice_paid_contract.py ../repo/tests/test_invoice_paid_contract.py
--- ../base/tests/test_invoice_paid_contract.py	1970-01-01 01:00:00.000000000 +0100
+++ ../repo/tests/test_invoice_paid_contract.py	2026-11-07 18:02:41.920882035 +0100
@@ -0,0 +1,50 @@
+import json
+from datetime import date
+from unittest import mock
+
+from src import main
+from src.contracts import invoice_paid
+from src.infra import bus
+from src.sales.adapters import relay
+from tests.support import DbTest
+
+
+class InvoicePaidContractTest(DbTest):
+    def messages(self):
+        return bus.fetch(invoice_paid.TOPIC)
+
+    def test_payload_matches_the_contract(self):
+        self.invoice()
+        main.pay_invoice("i1", date(2026, 11, 2))
+        (_, body), = self.messages()
+        self.assertEqual(set(body), set(invoice_paid.FIELDS))
+        for name, kind in invoice_paid.FIELDS.items():
+            self.assertIsInstance(body[name], kind)
+        self.assertEqual((body["order_id"], body["paid_on"], body["invoice_id"], body["invoice_version"]),
+                         ("o1", "2026-11-02", "i1", 2))
+        json.dumps(body)
+
+    def test_nothing_is_published_for_a_payment_that_did_not_happen(self):
+        self.invoice()
+        self.assertEqual(self.messages(), [])
+        main.pay_invoice("i1", date(2026, 11, 2))
+        try:
+            main.pay_invoice("i1", date(2026, 11, 3))
+        except Exception:
+            pass
+        self.assertEqual(len(self.messages()), 1)
+
+    def test_other_internal_events_are_not_published(self):
+        self.invoice()
+        self.assertEqual(self.rows("SELECT count(*) FROM bus_messages"), [(0,)])
+
+    def test_publish_failure_is_retried_and_published_later_exactly_once_marked(self):
+        self.invoice()
+        with mock.patch.object(bus, "publish", side_effect=ConnectionError):
+            main.pay_invoice("i1", date(2026, 11, 2))  # payment succeeds; publish fails
+        self.assertEqual(self.messages(), [])
+        self.assertEqual(self.rows("SELECT attempts FROM sales_outbox WHERE event_type = 'InvoicePaid' AND published_at IS NULL"),
+                         [(relay.RETRIES,)])
+        self.assertEqual(relay.publish_pending(), 1)
+        self.assertEqual(len(self.messages()), 1)
+        self.assertEqual(relay.publish_pending(), 0)
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/tests/test_sales.py ../repo/tests/test_sales.py
--- ../base/tests/test_sales.py	2026-11-07 17:53:34.559439980 +0100
+++ ../repo/tests/test_sales.py	2026-11-07 18:02:41.919882045 +0100
@@ -26,3 +26,32 @@
         self.invoice()
         main.cancel_invoice("i1")
         self.assertEqual(self.rows("SELECT status FROM invoices"), [("cancelled",)])
+
+
+class InvoicePaidOutboxTest(DbTest):
+    def test_paying_writes_one_outbox_row_in_the_same_transaction(self):
+        self.invoice()
+        main.pay_invoice("i1", date(2026, 11, 2))
+        self.assertEqual(self.rows("SELECT event_type, aggregate_id, aggregate_version, payload FROM sales_outbox"
+                                   " WHERE event_type = 'InvoicePaid'"),
+                         [("InvoicePaid", "i1", 2, {"invoice_id": "i1", "order_id": "o1", "paid_on": "2026-11-02"})])
+
+    def test_a_failed_payment_leaves_no_outbox_row(self):
+        self.invoice()
+        main.pay_invoice("i1", date(2026, 11, 2))
+        with self.assertRaises(InvoiceNotPayable):
+            main.pay_invoice("i1", date(2026, 11, 3))
+        self.assertEqual(self.rows("SELECT count(*) FROM sales_outbox WHERE event_type = 'InvoicePaid'"), [(1,)])
+
+    def test_rollback_after_the_outbox_write_leaves_no_row(self):
+        from src.sales.adapters.pg import PgSalesUnitOfWork
+        self.invoice()
+        with self.assertRaises(RuntimeError):
+            with PgSalesUnitOfWork() as uow:
+                invoice = uow.invoices.get("i1")
+                invoice.pay(date(2026, 11, 2))
+                uow.invoices.save(invoice)
+                uow.outbox.add(invoice.id, invoice.version, invoice.events)
+                raise RuntimeError("boom")
+        self.assertEqual(self.rows("SELECT count(*) FROM sales_outbox"), [(0,)])
+        self.assertEqual(self.rows("SELECT status FROM invoices"), [("issued",)])

### S2.2 [skill-md] Then the payload holds only the fields Shipping needs, plus the ids and version every event carries (rule 7).
diff base -> repo:
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/docs/event-list.md ../repo/docs/event-list.md
--- ../base/docs/event-list.md	2026-11-07 17:53:34.559439980 +0100
+++ ../repo/docs/event-list.md	2026-11-07 18:02:41.913882106 +0100
@@ -6,6 +6,7 @@
 
 - OrderPlaced: a customer placed an order (order id, customer id, total).
 - InvoiceIssued: an invoice was issued for an order (invoice id, order id, amount).
+- InvoicePaid: a customer paid an invoice (invoice id, order id, paid on date).
 
 ## shipping
 
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/schema.sql ../repo/schema.sql
--- ../base/schema.sql	2026-11-07 17:53:34.559439980 +0100
+++ ../repo/schema.sql	2026-11-07 18:02:41.913882106 +0100
@@ -25,6 +25,18 @@
     version integer NOT NULL DEFAULT 1
 );
 
+-- Sales outbox: written in the same transaction as the change; the relay publishes rows after commit.
+CREATE TABLE sales_outbox (
+    id bigserial PRIMARY KEY,
+    event_type text NOT NULL,
+    aggregate_id text NOT NULL,
+    aggregate_version integer NOT NULL,
+    payload jsonb NOT NULL,
+    created_at timestamptz NOT NULL DEFAULT now(),
+    published_at timestamptz,
+    attempts integer NOT NULL DEFAULT 0
+);
+
 -- Shipping context
 CREATE TABLE fulfilments (
     id text PRIMARY KEY,
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/contracts/invoice_paid.py ../repo/src/contracts/invoice_paid.py
--- ../base/src/contracts/invoice_paid.py	1970-01-01 01:00:00.000000000 +0100
+++ ../repo/src/contracts/invoice_paid.py	2026-11-07 18:02:41.918882055 +0100
@@ -0,0 +1,24 @@
+"""Integration event sales.invoice-paid, version 1. Producer: sales. Consumer: shipping (starts fulfilment).
+
+Fields are additive-only; a breaking change is a new version (new topic, e.g. sales.invoice-paid.v2).
+Carries ids and the facts of the change only; no state transfer is declared.
+"""
+TOPIC = "sales.invoice-paid.v1"
+VERSION = 1
+FIELDS = {
+    "event_id": int,         # outbox row id; consumers record it to stay idempotent
+    "invoice_id": str,
+    "invoice_version": int,  # aggregate version after the change; consumers ignore older ones
+    "order_id": str,         # the order that was paid
+    "paid_on": str,          # ISO date (YYYY-MM-DD) the invoice was paid
+}
+
+
+def build(event_id: int, invoice_version: int, internal: dict) -> dict:
+    return {
+        "event_id": event_id,
+        "invoice_id": internal["invoice_id"],
+        "invoice_version": invoice_version,
+        "order_id": internal["order_id"],
+        "paid_on": internal["paid_on"],
+    }
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/main.py ../repo/src/main.py
--- ../base/src/main.py	2026-11-07 17:53:34.559439980 +0100
+++ ../repo/src/main.py	2026-11-07 18:02:41.914882096 +0100
@@ -1,4 +1,5 @@
 """Composition root: wires each context's use cases to Postgres."""
+from src.sales.adapters.relay import publish_pending
 from src.sales.adapters.pg import PgSalesUnitOfWork
 from src.sales.core.commands.cancel_invoice import cancel_invoice as _cancel_invoice
 from src.sales.core.commands.issue_invoice import issue_invoice as _issue_invoice
@@ -17,7 +18,9 @@
 
 
 def pay_invoice(invoice_id, paid_on):
-    return _pay_invoice(PgSalesUnitOfWork(), invoice_id, paid_on)
+    version = _pay_invoice(PgSalesUnitOfWork(), invoice_id, paid_on)
+    publish_pending()  # after commit; rows that fail stay in the outbox for the next run
+    return version
 
 
 def cancel_invoice(invoice_id):
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/sales/adapters/pg.py ../repo/src/sales/adapters/pg.py
--- ../base/src/sales/adapters/pg.py	2026-11-07 17:53:34.559439980 +0100
+++ ../repo/src/sales/adapters/pg.py	2026-11-07 18:02:41.914882096 +0100
@@ -1,3 +1,8 @@
+import dataclasses
+import datetime
+
+from psycopg.types.json import Jsonb
+
 from src.db import connect
 from src.sales.core.invoices import Invoice
 from src.sales.core.orders import Order, OrderLine
@@ -50,6 +55,19 @@
         invoice.version = row[0]
 
 
+class PgOutbox:
+    """Writes recorded domain events to sales_outbox on the use case's connection (same transaction)."""
+
+    def __init__(self, conn):
+        self.conn = conn
+
+    def add(self, aggregate_id, aggregate_version, events):
+        for event in events:
+            payload = {k: v.isoformat() if isinstance(v, datetime.date) else v for k, v in dataclasses.asdict(event).items()}
+            self.conn.execute("INSERT INTO sales_outbox (event_type, aggregate_id, aggregate_version, payload) VALUES (%s, %s, %s, %s)",
+                              (type(event).__name__, aggregate_id, aggregate_version, Jsonb(payload)))
+
+
 class PgSalesUnitOfWork:
     """One transaction per use case: commits when the block succeeds, rolls back when it raises."""
 
@@ -59,6 +77,7 @@
         self.tx.__enter__()
         self.orders = PgOrderRepository(self.conn)
         self.invoices = PgInvoiceRepository(self.conn)
+        self.outbox = PgOutbox(self.conn)
         return self
 
     def __exit__(self, *exc):
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/sales/adapters/relay.py ../repo/src/sales/adapters/relay.py
--- ../base/src/sales/adapters/relay.py	1970-01-01 01:00:00.000000000 +0100
+++ ../repo/src/sales/adapters/relay.py	2026-11-07 18:02:41.919882045 +0100
@@ -0,0 +1,39 @@
+"""Outbox relay: publishes sales_outbox rows to the bus after commit, at least once, with retry.
+Maps internal events to integration-event contracts; internal events never leave the context."""
+import time
+
+from src.contracts import invoice_paid
+from src.db import connect
+from src.infra import bus
+
+RETRIES = 3
+
+
+def _to_contract(event_type, row_id, version, payload):
+    """(topic, body) for an internal event that has a published contract, else None."""
+    if event_type == "InvoicePaid":
+        return invoice_paid.TOPIC, invoice_paid.build(row_id, version, payload)
+    return None
+
+
+def publish_pending(retries: int = RETRIES, delay: float = 0.0) -> int:
+    """Publish unpublished rows in id order; returns how many were published. A row is marked published
+    only after the bus accepted it, so a crash in between re-publishes (at least once)."""
+    published = 0
+    with connect(autocommit=True) as conn:
+        rows = conn.execute("SELECT id, event_type, aggregate_version, payload FROM sales_outbox"
+                            " WHERE published_at IS NULL AND event_type = 'InvoicePaid' ORDER BY id").fetchall()
+        for row_id, event_type, version, payload in rows:
+            topic, body = _to_contract(event_type, row_id, version, payload)
+            for attempt in range(1, retries + 1):
+                conn.execute("UPDATE sales_outbox SET attempts = attempts + 1 WHERE id = %s", (row_id,))
+                try:
+                    bus.publish(topic, body)
+                    break
+                except Exception:
+                    if attempt == retries:
+                        return published  # stays unpublished; the next run retries it, order preserved
+                    time.sleep(delay)
+            conn.execute("UPDATE sales_outbox SET published_at = now() WHERE id = %s", (row_id,))
+            published += 1
+    return published
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/sales/core/commands/pay_invoice.py ../repo/src/sales/core/commands/pay_invoice.py
--- ../base/src/sales/core/commands/pay_invoice.py	2026-11-07 17:53:34.559439980 +0100
+++ ../repo/src/sales/core/commands/pay_invoice.py	2026-11-07 18:02:41.914882096 +0100
@@ -6,4 +6,5 @@
         invoice = uow.invoices.get(invoice_id)
         invoice.pay(paid_on)
         uow.invoices.save(invoice)
+        uow.outbox.add(invoice.id, invoice.version, invoice.events)
     return invoice.version
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/sales/core/events.py ../repo/src/sales/core/events.py
--- ../base/src/sales/core/events.py	2026-11-07 17:53:34.559439980 +0100
+++ ../repo/src/sales/core/events.py	2026-11-07 18:02:41.913882106 +0100
@@ -1,5 +1,6 @@
 """Sales domain events (see docs/event-list.md). Aggregates record them in `events`."""
 from dataclasses import dataclass
+from datetime import date
 
 
 @dataclass(frozen=True)
@@ -14,3 +15,10 @@
     invoice_id: str
     order_id: str
     amount_cents: int
+
+
+@dataclass(frozen=True)
+class InvoicePaid:
+    invoice_id: str
+    order_id: str
+    paid_on: date
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/sales/core/invoices.py ../repo/src/sales/core/invoices.py
--- ../base/src/sales/core/invoices.py	2026-11-07 17:53:34.559439980 +0100
+++ ../repo/src/sales/core/invoices.py	2026-11-07 18:02:41.913882106 +0100
@@ -1,7 +1,7 @@
 from dataclasses import dataclass, field
 from datetime import date
 
-from src.sales.core.events import InvoiceIssued
+from src.sales.core.events import InvoiceIssued, InvoicePaid
 
 
 class InvoiceNotPayable(Exception):
@@ -29,6 +29,7 @@
         if self.status != "issued":
             raise InvoiceNotPayable(f"invoice {self.id} is {self.status}")
         self.status, self.paid_on = "paid", on
+        self.events.append(InvoicePaid(self.id, self.order_id, on))
 
     def cancel(self) -> None:
         if self.status != "issued":
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/sales/core/ports.py ../repo/src/sales/core/ports.py
--- ../base/src/sales/core/ports.py	2026-11-07 17:53:34.559439980 +0100
+++ ../repo/src/sales/core/ports.py	2026-11-07 18:02:41.914882096 +0100
@@ -22,9 +22,14 @@
     def save(self, invoice: Invoice) -> None: ...
 
 
+class Outbox(Protocol):
+    def add(self, aggregate_id: str, aggregate_version: int, events: list) -> None: ...
+
+
 class SalesUnitOfWork(Protocol):
     orders: OrderRepository
     invoices: InvoiceRepository
+    outbox: Outbox
 
     def __enter__(self) -> "SalesUnitOfWork": ...
 
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/tests/test_invoice_paid_contract.py ../repo/tests/test_invoice_paid_contract.py
--- ../base/tests/test_invoice_paid_contract.py	1970-01-01 01:00:00.000000000 +0100
+++ ../repo/tests/test_invoice_paid_contract.py	2026-11-07 18:02:41.920882035 +0100
@@ -0,0 +1,50 @@
+import json
+from datetime import date
+from unittest import mock
+
+from src import main
+from src.contracts import invoice_paid
+from src.infra import bus
+from src.sales.adapters import relay
+from tests.support import DbTest
+
+
+class InvoicePaidContractTest(DbTest):
+    def messages(self):
+        return bus.fetch(invoice_paid.TOPIC)
+
+    def test_payload_matches_the_contract(self):
+        self.invoice()
+        main.pay_invoice("i1", date(2026, 11, 2))
+        (_, body), = self.messages()
+        self.assertEqual(set(body), set(invoice_paid.FIELDS))
+        for name, kind in invoice_paid.FIELDS.items():
+            self.assertIsInstance(body[name], kind)
+        self.assertEqual((body["order_id"], body["paid_on"], body["invoice_id"], body["invoice_version"]),
+                         ("o1", "2026-11-02", "i1", 2))
+        json.dumps(body)
+
+    def test_nothing_is_published_for_a_payment_that_did_not_happen(self):
+        self.invoice()
+        self.assertEqual(self.messages(), [])
+        main.pay_invoice("i1", date(2026, 11, 2))
+        try:
+            main.pay_invoice("i1", date(2026, 11, 3))
+        except Exception:
+            pass
+        self.assertEqual(len(self.messages()), 1)
+
+    def test_other_internal_events_are_not_published(self):
+        self.invoice()
+        self.assertEqual(self.rows("SELECT count(*) FROM bus_messages"), [(0,)])
+
+    def test_publish_failure_is_retried_and_published_later_exactly_once_marked(self):
+        self.invoice()
+        with mock.patch.object(bus, "publish", side_effect=ConnectionError):
+            main.pay_invoice("i1", date(2026, 11, 2))  # payment succeeds; publish fails
+        self.assertEqual(self.messages(), [])
+        self.assertEqual(self.rows("SELECT attempts FROM sales_outbox WHERE event_type = 'InvoicePaid' AND published_at IS NULL"),
+                         [(relay.RETRIES,)])
+        self.assertEqual(relay.publish_pending(), 1)
+        self.assertEqual(len(self.messages()), 1)
+        self.assertEqual(relay.publish_pending(), 0)
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/tests/test_sales.py ../repo/tests/test_sales.py
--- ../base/tests/test_sales.py	2026-11-07 17:53:34.559439980 +0100
+++ ../repo/tests/test_sales.py	2026-11-07 18:02:41.919882045 +0100
@@ -26,3 +26,32 @@
         self.invoice()
         main.cancel_invoice("i1")
         self.assertEqual(self.rows("SELECT status FROM invoices"), [("cancelled",)])
+
+
+class InvoicePaidOutboxTest(DbTest):
+    def test_paying_writes_one_outbox_row_in_the_same_transaction(self):
+        self.invoice()
+        main.pay_invoice("i1", date(2026, 11, 2))
+        self.assertEqual(self.rows("SELECT event_type, aggregate_id, aggregate_version, payload FROM sales_outbox"
+                                   " WHERE event_type = 'InvoicePaid'"),
+                         [("InvoicePaid", "i1", 2, {"invoice_id": "i1", "order_id": "o1", "paid_on": "2026-11-02"})])
+
+    def test_a_failed_payment_leaves_no_outbox_row(self):
+        self.invoice()
+        main.pay_invoice("i1", date(2026, 11, 2))
+        with self.assertRaises(InvoiceNotPayable):
+            main.pay_invoice("i1", date(2026, 11, 3))
+        self.assertEqual(self.rows("SELECT count(*) FROM sales_outbox WHERE event_type = 'InvoicePaid'"), [(1,)])
+
+    def test_rollback_after_the_outbox_write_leaves_no_row(self):
+        from src.sales.adapters.pg import PgSalesUnitOfWork
+        self.invoice()
+        with self.assertRaises(RuntimeError):
+            with PgSalesUnitOfWork() as uow:
+                invoice = uow.invoices.get("i1")
+                invoice.pay(date(2026, 11, 2))
+                uow.invoices.save(invoice)
+                uow.outbox.add(invoice.id, invoice.version, invoice.events)
+                raise RuntimeError("boom")
+        self.assertEqual(self.rows("SELECT count(*) FROM sales_outbox"), [(0,)])
+        self.assertEqual(self.rows("SELECT status FROM invoices"), [("issued",)])

### S4.2 [skill-md] Given an in-process handler doing a same-transaction update, When P4 completes, Then it is an explicit call in the use case.
diff base -> repo:
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/schema.sql ../repo/schema.sql
--- ../base/schema.sql	2026-11-07 18:01:06.850847147 +0100
+++ ../repo/schema.sql	2026-11-07 18:02:14.824157103 +0100
@@ -54,5 +54,6 @@
     customer_id text PRIMARY KEY,
     email text NOT NULL,
     paid_total_cents integer NOT NULL DEFAULT 0,
+    last_payment_on date,
     version integer NOT NULL DEFAULT 1
 );
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/sales/adapters/pg.py ../repo/src/sales/adapters/pg.py
--- ../base/src/sales/adapters/pg.py	2026-11-07 18:01:06.851847137 +0100
+++ ../repo/src/sales/adapters/pg.py	2026-11-07 18:02:14.828157063 +0100
@@ -60,7 +60,7 @@
         self.conn = conn
 
     def get(self, customer_id):
-        row = self.conn.execute("SELECT customer_id, email, paid_total_cents, version FROM customer_accounts WHERE customer_id = %s",
+        row = self.conn.execute("SELECT customer_id, email, paid_total_cents, last_payment_on, version FROM customer_accounts WHERE customer_id = %s",
                                 (customer_id,)).fetchone()
         if row is None:
             raise NotFound(customer_id)
@@ -70,9 +70,9 @@
         self.conn.execute("INSERT INTO customer_accounts (customer_id, email) VALUES (%s, %s)", (account.customer_id, account.email))
 
     def save(self, account):
-        row = self.conn.execute("UPDATE customer_accounts SET paid_total_cents = %s, version = version + 1"
+        row = self.conn.execute("UPDATE customer_accounts SET paid_total_cents = %s, last_payment_on = %s, version = version + 1"
                                 " WHERE customer_id = %s AND version = %s RETURNING version",
-                                (account.paid_total_cents, account.customer_id, account.version)).fetchone()
+                                (account.paid_total_cents, account.last_payment_on, account.customer_id, account.version)).fetchone()
         if row is None:
             raise StaleInvoice(account.customer_id)
         account.version = row[0]
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/sales/core/accounts.py ../repo/src/sales/core/accounts.py
--- ../base/src/sales/core/accounts.py	2026-11-07 18:01:06.851847137 +0100
+++ ../repo/src/sales/core/accounts.py	2026-11-07 18:02:14.827157073 +0100
@@ -1,4 +1,5 @@
 from dataclasses import dataclass
+from datetime import date
 
 
 @dataclass
@@ -6,9 +7,11 @@
     customer_id: str
     email: str
     paid_total_cents: int = 0
+    last_payment_on: date | None = None
     version: int = 1
 
-    def record_payment(self, amount_cents: int) -> None:
+    def record_payment(self, amount_cents: int, on: date) -> None:
         if amount_cents <= 0:
             raise ValueError("a payment is positive")
         self.paid_total_cents += amount_cents
+        self.last_payment_on = on
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/sales/core/commands/pay_invoice.py ../repo/src/sales/core/commands/pay_invoice.py
--- ../base/src/sales/core/commands/pay_invoice.py	2026-11-07 17:53:34.559439980 +0100
+++ ../repo/src/sales/core/commands/pay_invoice.py	2026-11-07 18:02:14.828157063 +0100
@@ -6,4 +6,7 @@
         invoice = uow.invoices.get(invoice_id)
         invoice.pay(paid_on)
         uow.invoices.save(invoice)
+        account = uow.accounts.get(invoice.customer_id)
+        account.record_payment(invoice.amount_cents, paid_on)
+        uow.accounts.save(account)
     return invoice.version
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/sales/core/handlers.py ../repo/src/sales/core/handlers.py
--- ../base/src/sales/core/handlers.py	2026-11-07 18:01:06.851847137 +0100
+++ ../repo/src/sales/core/handlers.py	2026-11-07 18:02:14.828157063 +0100
@@ -2,16 +2,10 @@
 from src.sales.core.events import InvoicePaid
 
 
-def credit_customer_account(uow, event: InvoicePaid) -> None:
-    account = uow.accounts.get(event.customer_id)
-    account.record_payment(event.amount_cents)
-    uow.accounts.save(account)
-
-
 def send_payment_receipt(uow, event: InvoicePaid) -> None:
     account = uow.accounts.get(event.customer_id)
     uow.mailer.send(account.email, f"Receipt for invoice {event.invoice_id}",
                     f"We received {event.amount_cents / 100:.2f} on {event.paid_on}.")
 
 
-HANDLERS = {InvoicePaid: [credit_customer_account, send_payment_receipt]}
+HANDLERS = {InvoicePaid: [send_payment_receipt]}
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/tests/test_accounts.py ../repo/tests/test_accounts.py
--- ../base/tests/test_accounts.py	2026-11-07 18:01:06.852847127 +0100
+++ ../repo/tests/test_accounts.py	2026-11-07 18:02:14.828157063 +0100
@@ -10,4 +10,5 @@
         self.invoice(customer_id="ann")
         main.pay_invoice("i1", date(2026, 11, 2))
         self.assertEqual(self.rows("SELECT paid_total_cents FROM customer_accounts"), [(1000,)])
+        self.assertEqual(self.rows("SELECT last_payment_on FROM customer_accounts"), [(date(2026, 11, 2),)])
         self.assertEqual(self.rows("SELECT to_address FROM sent_mail"), [("ann@example.com",)])

### S1.3 [aip] Then the event is a past-tense fact and listed in paths.eventList.
diff base -> repo:
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/docs/event-list.md ../repo/docs/event-list.md
--- ../base/docs/event-list.md	2026-11-07 17:53:34.559439980 +0100
+++ ../repo/docs/event-list.md	2026-11-07 18:02:41.547885821 +0100
@@ -6,6 +6,7 @@
 
 - OrderPlaced: a customer placed an order (order id, customer id, total).
 - InvoiceIssued: an invoice was issued for an order (invoice id, order id, amount).
+- InvoicePaid: a customer paid an invoice (invoice id, order id, paid date).
 
 ## shipping
 
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/schema.sql ../repo/schema.sql
--- ../base/schema.sql	2026-11-07 17:53:34.559439980 +0100
+++ ../repo/schema.sql	2026-11-07 18:02:41.547885821 +0100
@@ -25,6 +25,19 @@
     version integer NOT NULL DEFAULT 1
 );
 
+-- Sales outbox: events written in the same transaction as the change, published by the relay after commit.
+CREATE TABLE sales_outbox (
+    id bigserial PRIMARY KEY,
+    event_type text NOT NULL,
+    aggregate_id text NOT NULL,
+    aggregate_version integer NOT NULL,
+    payload jsonb NOT NULL,
+    created_at timestamptz NOT NULL DEFAULT now(),
+    published_at timestamptz,
+    attempts integer NOT NULL DEFAULT 0,
+    last_error text
+);
+
 -- Shipping context
 CREATE TABLE fulfilments (
     id text PRIMARY KEY,
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/contracts/invoice_paid.py ../repo/src/contracts/invoice_paid.py
--- ../base/src/contracts/invoice_paid.py	1970-01-01 01:00:00.000000000 +0100
+++ ../repo/src/contracts/invoice_paid.py	2026-11-07 18:02:41.554885750 +0100
@@ -0,0 +1,16 @@
+"""Integration event published by Sales; Shipping consumes it. One producer: sales.
+
+InvoicePaid v1 (topic `sales.invoice-paid.v1`). Changes are additive; a breaking change is a new version.
+  event_id: unique per event, stable across redeliveries (consumers dedupe on it)
+  invoice_id, order_id: ids
+  paid_on: ISO date the invoice was paid
+  invoice_version: aggregate version after the payment (consumers ignore older ones)
+No state transfer: only ids and the facts of the change.
+"""
+TOPIC = "sales.invoice-paid.v1"
+FIELDS = ("event_id", "invoice_id", "order_id", "paid_on", "invoice_version")
+
+
+def from_outbox(outbox_id, aggregate_version, payload):
+    return {"event_id": f"sales-outbox-{outbox_id}", "invoice_id": payload["invoice_id"], "order_id": payload["order_id"],
+            "paid_on": payload["paid_on"], "invoice_version": aggregate_version}
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/main.py ../repo/src/main.py
--- ../base/src/main.py	2026-11-07 17:53:34.559439980 +0100
+++ ../repo/src/main.py	2026-11-07 18:02:41.556885730 +0100
@@ -30,3 +30,8 @@
 
 def cancel_fulfilment(order_id):
     return shipping.cancel_fulfilment(PgShippingUnitOfWork(), order_id)
+
+
+def relay_sales_outbox():
+    from src.sales.adapters.relay import run_once
+    return run_once()
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/sales/adapters/pg.py ../repo/src/sales/adapters/pg.py
--- ../base/src/sales/adapters/pg.py	2026-11-07 17:53:34.559439980 +0100
+++ ../repo/src/sales/adapters/pg.py	2026-11-07 18:02:41.548885811 +0100
@@ -1,3 +1,7 @@
+from dataclasses import asdict
+
+from psycopg.types.json import Jsonb
+
 from src.db import connect
 from src.sales.core.invoices import Invoice
 from src.sales.core.orders import Order, OrderLine
@@ -50,6 +54,19 @@
         invoice.version = row[0]
 
 
+class PgOutbox:
+    """Writes events on the use case's connection, so they commit or roll back with the change."""
+
+    def __init__(self, conn):
+        self.conn = conn
+
+    def add(self, aggregate_id, aggregate_version, events):
+        for event in events:
+            payload = {k: v.isoformat() if hasattr(v, "isoformat") else v for k, v in asdict(event).items()}
+            self.conn.execute("INSERT INTO sales_outbox (event_type, aggregate_id, aggregate_version, payload) VALUES (%s, %s, %s, %s)",
+                              (type(event).__name__, aggregate_id, aggregate_version, Jsonb(payload)))
+
+
 class PgSalesUnitOfWork:
     """One transaction per use case: commits when the block succeeds, rolls back when it raises."""
 
@@ -59,6 +76,7 @@
         self.tx.__enter__()
         self.orders = PgOrderRepository(self.conn)
         self.invoices = PgInvoiceRepository(self.conn)
+        self.outbox = PgOutbox(self.conn)
         return self
 
     def __exit__(self, *exc):
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/sales/adapters/relay.py ../repo/src/sales/adapters/relay.py
--- ../base/src/sales/adapters/relay.py	1970-01-01 01:00:00.000000000 +0100
+++ ../repo/src/sales/adapters/relay.py	2026-11-07 18:02:41.555885740 +0100
@@ -0,0 +1,30 @@
+"""Outbox relay: publishes committed outbox rows to the bus, at least once, with retry."""
+from src.contracts import invoice_paid
+from src.db import connect
+from src.infra import bus
+
+MAPPERS = {"InvoicePaid": (invoice_paid.TOPIC, invoice_paid.from_outbox)}
+
+
+def run_once(max_attempts: int = 3) -> int:
+    """Publish every unpublished row; a failed publish is retried up to max_attempts, then left with last_error. Returns rows published."""
+    published = 0
+    with connect(autocommit=True) as conn:
+        rows = conn.execute("SELECT id, event_type, aggregate_version, payload FROM sales_outbox"
+                            " WHERE published_at IS NULL AND attempts < %s ORDER BY id", (max_attempts,)).fetchall()
+        for row_id, event_type, version, payload in rows:
+            if event_type not in MAPPERS:
+                continue
+            topic, mapper = MAPPERS[event_type]
+            for _ in range(max_attempts):
+                try:
+                    bus.publish(topic, mapper(row_id, version, payload))
+                except Exception as exc:
+                    conn.execute("UPDATE sales_outbox SET attempts = attempts + 1, last_error = %s WHERE id = %s", (str(exc), row_id))
+                    continue
+                conn.execute("UPDATE sales_outbox SET published_at = now() WHERE id = %s", (row_id,))
+                published += 1
+                break
+            else:
+                break  # keep order: stop at the first row that exhausted its attempts
+    return published
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/sales/core/commands/pay_invoice.py ../repo/src/sales/core/commands/pay_invoice.py
--- ../base/src/sales/core/commands/pay_invoice.py	2026-11-07 17:53:34.559439980 +0100
+++ ../repo/src/sales/core/commands/pay_invoice.py	2026-11-07 18:02:41.548885811 +0100
@@ -6,4 +6,5 @@
         invoice = uow.invoices.get(invoice_id)
         invoice.pay(paid_on)
         uow.invoices.save(invoice)
+        uow.outbox.add(invoice.id, invoice.version, invoice.events)
     return invoice.version
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/sales/core/events.py ../repo/src/sales/core/events.py
--- ../base/src/sales/core/events.py	2026-11-07 17:53:34.559439980 +0100
+++ ../repo/src/sales/core/events.py	2026-11-07 18:02:41.548885811 +0100
@@ -1,5 +1,6 @@
 """Sales domain events (see docs/event-list.md). Aggregates record them in `events`."""
 from dataclasses import dataclass
+from datetime import date
 
 
 @dataclass(frozen=True)
@@ -14,3 +15,10 @@
     invoice_id: str
     order_id: str
     amount_cents: int
+
+
+@dataclass(frozen=True)
+class InvoicePaid:
+    invoice_id: str
+    order_id: str
+    paid_on: date
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/sales/core/invoices.py ../repo/src/sales/core/invoices.py
--- ../base/src/sales/core/invoices.py	2026-11-07 17:53:34.559439980 +0100
+++ ../repo/src/sales/core/invoices.py	2026-11-07 18:02:41.548885811 +0100
@@ -1,7 +1,7 @@
 from dataclasses import dataclass, field
 from datetime import date
 
-from src.sales.core.events import InvoiceIssued
+from src.sales.core.events import InvoiceIssued, InvoicePaid
 
 
 class InvoiceNotPayable(Exception):
@@ -29,6 +29,7 @@
         if self.status != "issued":
             raise InvoiceNotPayable(f"invoice {self.id} is {self.status}")
         self.status, self.paid_on = "paid", on
+        self.events.append(InvoicePaid(self.id, self.order_id, on))
 
     def cancel(self) -> None:
         if self.status != "issued":
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/sales/core/ports.py ../repo/src/sales/core/ports.py
--- ../base/src/sales/core/ports.py	2026-11-07 17:53:34.559439980 +0100
+++ ../repo/src/sales/core/ports.py	2026-11-07 18:02:41.548885811 +0100
@@ -22,7 +22,12 @@
     def save(self, invoice: Invoice) -> None: ...
 
 
+class Outbox(Protocol):
+    def add(self, aggregate_id: str, aggregate_version: int, events: list) -> None: ...
+
+
 class SalesUnitOfWork(Protocol):
+    outbox: Outbox
     orders: OrderRepository
     invoices: InvoiceRepository
 
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/tests/test_invoice_paid_event.py ../repo/tests/test_invoice_paid_event.py
--- ../base/tests/test_invoice_paid_event.py	1970-01-01 01:00:00.000000000 +0100
+++ ../repo/tests/test_invoice_paid_event.py	2026-11-07 18:02:41.557885720 +0100
@@ -0,0 +1,62 @@
+from datetime import date
+from unittest import mock
+
+from src import main
+from src.contracts import invoice_paid
+from src.infra import bus
+from src.sales.core.invoices import InvoiceNotPayable
+from tests.support import DbTest
+
+
+class InvoicePaidOutboxTest(DbTest):
+    def test_payment_writes_one_outbox_row_and_publishes_nothing(self):
+        self.invoice()
+        main.pay_invoice("i1", date(2026, 11, 2))
+        self.assertEqual(self.rows("SELECT event_type, aggregate_id, aggregate_version FROM sales_outbox"), [("InvoicePaid", "i1", 2)])
+        self.assertEqual(bus.fetch(invoice_paid.TOPIC), [])
+
+    def test_failed_payment_writes_no_row(self):
+        self.invoice()
+        main.pay_invoice("i1", date(2026, 11, 2))
+        with self.assertRaises(InvoiceNotPayable):
+            main.pay_invoice("i1", date(2026, 11, 3))
+        self.assertEqual(len(self.rows("SELECT 1 FROM sales_outbox")), 1)
+
+    def test_rollback_after_outbox_write_leaves_no_row(self):
+        self.invoice()
+        with mock.patch("src.sales.adapters.pg.PgInvoiceRepository.save", side_effect=RuntimeError):
+            with self.assertRaises(RuntimeError):
+                main.pay_invoice("i1", date(2026, 11, 2))
+        self.assertEqual(self.rows("SELECT 1 FROM sales_outbox"), [])
+
+
+class InvoicePaidRelayTest(DbTest):
+    def test_relay_publishes_the_contract_once(self):
+        self.invoice()
+        main.pay_invoice("i1", date(2026, 11, 2))
+        self.assertEqual(main.relay_sales_outbox(), 1)
+        self.assertEqual(main.relay_sales_outbox(), 0)
+        (_, body), = bus.fetch(invoice_paid.TOPIC)
+        self.assertEqual(set(body), set(invoice_paid.FIELDS))
+        self.assertEqual((body["order_id"], body["paid_on"], body["invoice_id"], body["invoice_version"]), ("o1", "2026-11-02", "i1", 2))
+
+    def test_relay_retries_a_failed_publish(self):
+        self.invoice()
+        main.pay_invoice("i1", date(2026, 11, 2))
+        real = bus.publish
+        calls = []
+
+        def flaky(topic, body):
+            calls.append(1)
+            if len(calls) == 1:
+                raise ConnectionError("bus down")
+            real(topic, body)
+
+        with mock.patch("src.infra.bus.publish", flaky):
+            self.assertEqual(main.relay_sales_outbox(), 1)
+        self.assertEqual(len(bus.fetch(invoice_paid.TOPIC)), 1)
+
+    def test_nothing_is_published_for_unpaid_invoices(self):
+        self.invoice()
+        self.assertEqual(main.relay_sales_outbox(), 0)
+        self.assertEqual(bus.fetch(invoice_paid.TOPIC), [])

### S2.2 [aip] Then the payload holds only the fields Shipping needs, plus the ids and version every event carries (rule 7).
diff base -> repo:
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/docs/event-list.md ../repo/docs/event-list.md
--- ../base/docs/event-list.md	2026-11-07 17:53:34.559439980 +0100
+++ ../repo/docs/event-list.md	2026-11-07 18:02:41.547885821 +0100
@@ -6,6 +6,7 @@
 
 - OrderPlaced: a customer placed an order (order id, customer id, total).
 - InvoiceIssued: an invoice was issued for an order (invoice id, order id, amount).
+- InvoicePaid: a customer paid an invoice (invoice id, order id, paid date).
 
 ## shipping
 
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/schema.sql ../repo/schema.sql
--- ../base/schema.sql	2026-11-07 17:53:34.559439980 +0100
+++ ../repo/schema.sql	2026-11-07 18:02:41.547885821 +0100
@@ -25,6 +25,19 @@
     version integer NOT NULL DEFAULT 1
 );
 
+-- Sales outbox: events written in the same transaction as the change, published by the relay after commit.
+CREATE TABLE sales_outbox (
+    id bigserial PRIMARY KEY,
+    event_type text NOT NULL,
+    aggregate_id text NOT NULL,
+    aggregate_version integer NOT NULL,
+    payload jsonb NOT NULL,
+    created_at timestamptz NOT NULL DEFAULT now(),
+    published_at timestamptz,
+    attempts integer NOT NULL DEFAULT 0,
+    last_error text
+);
+
 -- Shipping context
 CREATE TABLE fulfilments (
     id text PRIMARY KEY,
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/contracts/invoice_paid.py ../repo/src/contracts/invoice_paid.py
--- ../base/src/contracts/invoice_paid.py	1970-01-01 01:00:00.000000000 +0100
+++ ../repo/src/contracts/invoice_paid.py	2026-11-07 18:02:41.554885750 +0100
@@ -0,0 +1,16 @@
+"""Integration event published by Sales; Shipping consumes it. One producer: sales.
+
+InvoicePaid v1 (topic `sales.invoice-paid.v1`). Changes are additive; a breaking change is a new version.
+  event_id: unique per event, stable across redeliveries (consumers dedupe on it)
+  invoice_id, order_id: ids
+  paid_on: ISO date the invoice was paid
+  invoice_version: aggregate version after the payment (consumers ignore older ones)
+No state transfer: only ids and the facts of the change.
+"""
+TOPIC = "sales.invoice-paid.v1"
+FIELDS = ("event_id", "invoice_id", "order_id", "paid_on", "invoice_version")
+
+
+def from_outbox(outbox_id, aggregate_version, payload):
+    return {"event_id": f"sales-outbox-{outbox_id}", "invoice_id": payload["invoice_id"], "order_id": payload["order_id"],
+            "paid_on": payload["paid_on"], "invoice_version": aggregate_version}
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/main.py ../repo/src/main.py
--- ../base/src/main.py	2026-11-07 17:53:34.559439980 +0100
+++ ../repo/src/main.py	2026-11-07 18:02:41.556885730 +0100
@@ -30,3 +30,8 @@
 
 def cancel_fulfilment(order_id):
     return shipping.cancel_fulfilment(PgShippingUnitOfWork(), order_id)
+
+
+def relay_sales_outbox():
+    from src.sales.adapters.relay import run_once
+    return run_once()
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/sales/adapters/pg.py ../repo/src/sales/adapters/pg.py
--- ../base/src/sales/adapters/pg.py	2026-11-07 17:53:34.559439980 +0100
+++ ../repo/src/sales/adapters/pg.py	2026-11-07 18:02:41.548885811 +0100
@@ -1,3 +1,7 @@
+from dataclasses import asdict
+
+from psycopg.types.json import Jsonb
+
 from src.db import connect
 from src.sales.core.invoices import Invoice
 from src.sales.core.orders import Order, OrderLine
@@ -50,6 +54,19 @@
         invoice.version = row[0]
 
 
+class PgOutbox:
+    """Writes events on the use case's connection, so they commit or roll back with the change."""
+
+    def __init__(self, conn):
+        self.conn = conn
+
+    def add(self, aggregate_id, aggregate_version, events):
+        for event in events:
+            payload = {k: v.isoformat() if hasattr(v, "isoformat") else v for k, v in asdict(event).items()}
+            self.conn.execute("INSERT INTO sales_outbox (event_type, aggregate_id, aggregate_version, payload) VALUES (%s, %s, %s, %s)",
+                              (type(event).__name__, aggregate_id, aggregate_version, Jsonb(payload)))
+
+
 class PgSalesUnitOfWork:
     """One transaction per use case: commits when the block succeeds, rolls back when it raises."""
 
@@ -59,6 +76,7 @@
         self.tx.__enter__()
         self.orders = PgOrderRepository(self.conn)
         self.invoices = PgInvoiceRepository(self.conn)
+        self.outbox = PgOutbox(self.conn)
         return self
 
     def __exit__(self, *exc):
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/sales/adapters/relay.py ../repo/src/sales/adapters/relay.py
--- ../base/src/sales/adapters/relay.py	1970-01-01 01:00:00.000000000 +0100
+++ ../repo/src/sales/adapters/relay.py	2026-11-07 18:02:41.555885740 +0100
@@ -0,0 +1,30 @@
+"""Outbox relay: publishes committed outbox rows to the bus, at least once, with retry."""
+from src.contracts import invoice_paid
+from src.db import connect
+from src.infra import bus
+
+MAPPERS = {"InvoicePaid": (invoice_paid.TOPIC, invoice_paid.from_outbox)}
+
+
+def run_once(max_attempts: int = 3) -> int:
+    """Publish every unpublished row; a failed publish is retried up to max_attempts, then left with last_error. Returns rows published."""
+    published = 0
+    with connect(autocommit=True) as conn:
+        rows = conn.execute("SELECT id, event_type, aggregate_version, payload FROM sales_outbox"
+                            " WHERE published_at IS NULL AND attempts < %s ORDER BY id", (max_attempts,)).fetchall()
+        for row_id, event_type, version, payload in rows:
+            if event_type not in MAPPERS:
+                continue
+            topic, mapper = MAPPERS[event_type]
+            for _ in range(max_attempts):
+                try:
+                    bus.publish(topic, mapper(row_id, version, payload))
+                except Exception as exc:
+                    conn.execute("UPDATE sales_outbox SET attempts = attempts + 1, last_error = %s WHERE id = %s", (str(exc), row_id))
+                    continue
+                conn.execute("UPDATE sales_outbox SET published_at = now() WHERE id = %s", (row_id,))
+                published += 1
+                break
+            else:
+                break  # keep order: stop at the first row that exhausted its attempts
+    return published
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/sales/core/commands/pay_invoice.py ../repo/src/sales/core/commands/pay_invoice.py
--- ../base/src/sales/core/commands/pay_invoice.py	2026-11-07 17:53:34.559439980 +0100
+++ ../repo/src/sales/core/commands/pay_invoice.py	2026-11-07 18:02:41.548885811 +0100
@@ -6,4 +6,5 @@
         invoice = uow.invoices.get(invoice_id)
         invoice.pay(paid_on)
         uow.invoices.save(invoice)
+        uow.outbox.add(invoice.id, invoice.version, invoice.events)
     return invoice.version
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/sales/core/events.py ../repo/src/sales/core/events.py
--- ../base/src/sales/core/events.py	2026-11-07 17:53:34.559439980 +0100
+++ ../repo/src/sales/core/events.py	2026-11-07 18:02:41.548885811 +0100
@@ -1,5 +1,6 @@
 """Sales domain events (see docs/event-list.md). Aggregates record them in `events`."""
 from dataclasses import dataclass
+from datetime import date
 
 
 @dataclass(frozen=True)
@@ -14,3 +15,10 @@
     invoice_id: str
     order_id: str
     amount_cents: int
+
+
+@dataclass(frozen=True)
+class InvoicePaid:
+    invoice_id: str
+    order_id: str
+    paid_on: date
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/sales/core/invoices.py ../repo/src/sales/core/invoices.py
--- ../base/src/sales/core/invoices.py	2026-11-07 17:53:34.559439980 +0100
+++ ../repo/src/sales/core/invoices.py	2026-11-07 18:02:41.548885811 +0100
@@ -1,7 +1,7 @@
 from dataclasses import dataclass, field
 from datetime import date
 
-from src.sales.core.events import InvoiceIssued
+from src.sales.core.events import InvoiceIssued, InvoicePaid
 
 
 class InvoiceNotPayable(Exception):
@@ -29,6 +29,7 @@
         if self.status != "issued":
             raise InvoiceNotPayable(f"invoice {self.id} is {self.status}")
         self.status, self.paid_on = "paid", on
+        self.events.append(InvoicePaid(self.id, self.order_id, on))
 
     def cancel(self) -> None:
         if self.status != "issued":
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/sales/core/ports.py ../repo/src/sales/core/ports.py
--- ../base/src/sales/core/ports.py	2026-11-07 17:53:34.559439980 +0100
+++ ../repo/src/sales/core/ports.py	2026-11-07 18:02:41.548885811 +0100
@@ -22,7 +22,12 @@
     def save(self, invoice: Invoice) -> None: ...
 
 
+class Outbox(Protocol):
+    def add(self, aggregate_id: str, aggregate_version: int, events: list) -> None: ...
+
+
 class SalesUnitOfWork(Protocol):
+    outbox: Outbox
     orders: OrderRepository
     invoices: InvoiceRepository
 
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/tests/test_invoice_paid_event.py ../repo/tests/test_invoice_paid_event.py
--- ../base/tests/test_invoice_paid_event.py	1970-01-01 01:00:00.000000000 +0100
+++ ../repo/tests/test_invoice_paid_event.py	2026-11-07 18:02:41.557885720 +0100
@@ -0,0 +1,62 @@
+from datetime import date
+from unittest import mock
+
+from src import main
+from src.contracts import invoice_paid
+from src.infra import bus
+from src.sales.core.invoices import InvoiceNotPayable
+from tests.support import DbTest
+
+
+class InvoicePaidOutboxTest(DbTest):
+    def test_payment_writes_one_outbox_row_and_publishes_nothing(self):
+        self.invoice()
+        main.pay_invoice("i1", date(2026, 11, 2))
+        self.assertEqual(self.rows("SELECT event_type, aggregate_id, aggregate_version FROM sales_outbox"), [("InvoicePaid", "i1", 2)])
+        self.assertEqual(bus.fetch(invoice_paid.TOPIC), [])
+
+    def test_failed_payment_writes_no_row(self):
+        self.invoice()
+        main.pay_invoice("i1", date(2026, 11, 2))
+        with self.assertRaises(InvoiceNotPayable):
+            main.pay_invoice("i1", date(2026, 11, 3))
+        self.assertEqual(len(self.rows("SELECT 1 FROM sales_outbox")), 1)
+
+    def test_rollback_after_outbox_write_leaves_no_row(self):
+        self.invoice()
+        with mock.patch("src.sales.adapters.pg.PgInvoiceRepository.save", side_effect=RuntimeError):
+            with self.assertRaises(RuntimeError):
+                main.pay_invoice("i1", date(2026, 11, 2))
+        self.assertEqual(self.rows("SELECT 1 FROM sales_outbox"), [])
+
+
+class InvoicePaidRelayTest(DbTest):
+    def test_relay_publishes_the_contract_once(self):
+        self.invoice()
+        main.pay_invoice("i1", date(2026, 11, 2))
+        self.assertEqual(main.relay_sales_outbox(), 1)
+        self.assertEqual(main.relay_sales_outbox(), 0)
+        (_, body), = bus.fetch(invoice_paid.TOPIC)
+        self.assertEqual(set(body), set(invoice_paid.FIELDS))
+        self.assertEqual((body["order_id"], body["paid_on"], body["invoice_id"], body["invoice_version"]), ("o1", "2026-11-02", "i1", 2))
+
+    def test_relay_retries_a_failed_publish(self):
+        self.invoice()
+        main.pay_invoice("i1", date(2026, 11, 2))
+        real = bus.publish
+        calls = []
+
+        def flaky(topic, body):
+            calls.append(1)
+            if len(calls) == 1:
+                raise ConnectionError("bus down")
+            real(topic, body)
+
+        with mock.patch("src.infra.bus.publish", flaky):
+            self.assertEqual(main.relay_sales_outbox(), 1)
+        self.assertEqual(len(bus.fetch(invoice_paid.TOPIC)), 1)
+
+    def test_nothing_is_published_for_unpaid_invoices(self):
+        self.invoice()
+        self.assertEqual(main.relay_sales_outbox(), 0)
+        self.assertEqual(bus.fetch(invoice_paid.TOPIC), [])

### S4.2 [aip] Given an in-process handler doing a same-transaction update, When P4 completes, Then it is an explicit call in the use case.
diff base -> repo:
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/schema.sql ../repo/schema.sql
--- ../base/schema.sql	2026-11-07 18:01:15.482759517 +0100
+++ ../repo/schema.sql	2026-11-07 18:02:14.065164808 +0100
@@ -54,5 +54,6 @@
     customer_id text PRIMARY KEY,
     email text NOT NULL,
     paid_total_cents integer NOT NULL DEFAULT 0,
+    last_paid_on date,
     version integer NOT NULL DEFAULT 1
 );
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/sales/adapters/pg.py ../repo/src/sales/adapters/pg.py
--- ../base/src/sales/adapters/pg.py	2026-11-07 18:01:15.482759517 +0100
+++ ../repo/src/sales/adapters/pg.py	2026-11-07 18:02:14.353161884 +0100
@@ -60,7 +60,7 @@
         self.conn = conn
 
     def get(self, customer_id):
-        row = self.conn.execute("SELECT customer_id, email, paid_total_cents, version FROM customer_accounts WHERE customer_id = %s",
+        row = self.conn.execute("SELECT customer_id, email, paid_total_cents, last_paid_on, version FROM customer_accounts WHERE customer_id = %s",
                                 (customer_id,)).fetchone()
         if row is None:
             raise NotFound(customer_id)
@@ -70,9 +70,9 @@
         self.conn.execute("INSERT INTO customer_accounts (customer_id, email) VALUES (%s, %s)", (account.customer_id, account.email))
 
     def save(self, account):
-        row = self.conn.execute("UPDATE customer_accounts SET paid_total_cents = %s, version = version + 1"
+        row = self.conn.execute("UPDATE customer_accounts SET paid_total_cents = %s, last_paid_on = %s, version = version + 1"
                                 " WHERE customer_id = %s AND version = %s RETURNING version",
-                                (account.paid_total_cents, account.customer_id, account.version)).fetchone()
+                                (account.paid_total_cents, account.last_paid_on, account.customer_id, account.version)).fetchone()
         if row is None:
             raise StaleInvoice(account.customer_id)
         account.version = row[0]
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/sales/core/accounts.py ../repo/src/sales/core/accounts.py
--- ../base/src/sales/core/accounts.py	2026-11-07 18:01:15.482759517 +0100
+++ ../repo/src/sales/core/accounts.py	2026-11-07 18:02:14.353161884 +0100
@@ -1,4 +1,5 @@
 from dataclasses import dataclass
+from datetime import date
 
 
 @dataclass
@@ -6,9 +7,12 @@
     customer_id: str
     email: str
     paid_total_cents: int = 0
+    last_paid_on: date | None = None
     version: int = 1
 
-    def record_payment(self, amount_cents: int) -> None:
+    def record_payment(self, amount_cents: int, paid_on: date) -> None:
         if amount_cents <= 0:
             raise ValueError("a payment is positive")
         self.paid_total_cents += amount_cents
+        if self.last_paid_on is None or paid_on > self.last_paid_on:
+            self.last_paid_on = paid_on
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/sales/core/commands/pay_invoice.py ../repo/src/sales/core/commands/pay_invoice.py
--- ../base/src/sales/core/commands/pay_invoice.py	2026-11-07 17:53:34.559439980 +0100
+++ ../repo/src/sales/core/commands/pay_invoice.py	2026-11-07 18:02:14.358161834 +0100
@@ -6,4 +6,7 @@
         invoice = uow.invoices.get(invoice_id)
         invoice.pay(paid_on)
         uow.invoices.save(invoice)
+        account = uow.accounts.get(invoice.customer_id)
+        account.record_payment(invoice.amount_cents, paid_on)
+        uow.accounts.save(account)
     return invoice.version
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/sales/core/handlers.py ../repo/src/sales/core/handlers.py
--- ../base/src/sales/core/handlers.py	2026-11-07 18:01:15.483759506 +0100
+++ ../repo/src/sales/core/handlers.py	2026-11-07 18:02:14.353161884 +0100
@@ -1,17 +1,11 @@
-"""Reactions to sales events. The unit of work dispatches each recorded event to its handlers before it commits."""
+"""Reactions to sales events (the receipt; crediting the account is an explicit call in pay_invoice). The unit of work dispatches each recorded event to its handlers before it commits."""
 from src.sales.core.events import InvoicePaid
 
 
-def credit_customer_account(uow, event: InvoicePaid) -> None:
-    account = uow.accounts.get(event.customer_id)
-    account.record_payment(event.amount_cents)
-    uow.accounts.save(account)
-
-
 def send_payment_receipt(uow, event: InvoicePaid) -> None:
     account = uow.accounts.get(event.customer_id)
     uow.mailer.send(account.email, f"Receipt for invoice {event.invoice_id}",
                     f"We received {event.amount_cents / 100:.2f} on {event.paid_on}.")
 
 
-HANDLERS = {InvoicePaid: [credit_customer_account, send_payment_receipt]}
+HANDLERS = {InvoicePaid: [send_payment_receipt]}
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/sales/core/ports.py ../repo/src/sales/core/ports.py
--- ../base/src/sales/core/ports.py	2026-11-07 18:01:15.483759506 +0100
+++ ../repo/src/sales/core/ports.py	2026-11-07 18:02:14.370161712 +0100
@@ -25,6 +25,7 @@
 class SalesUnitOfWork(Protocol):
     orders: OrderRepository
     invoices: InvoiceRepository
+    accounts: "AccountRepository"
 
     def __enter__(self) -> "SalesUnitOfWork": ...
 
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/tests/test_accounts.py ../repo/tests/test_accounts.py
--- ../base/tests/test_accounts.py	2026-11-07 18:01:15.483759506 +0100
+++ ../repo/tests/test_accounts.py	2026-11-07 18:02:14.371161702 +0100
@@ -11,3 +11,16 @@
         main.pay_invoice("i1", date(2026, 11, 2))
         self.assertEqual(self.rows("SELECT paid_total_cents FROM customer_accounts"), [(1000,)])
         self.assertEqual(self.rows("SELECT to_address FROM sent_mail"), [("ann@example.com",)])
+
+    def test_the_account_shows_the_last_payment_date(self):
+        main.open_account("ann", "ann@example.com")
+        self.invoice(customer_id="ann")
+        main.pay_invoice("i1", date(2026, 11, 2))
+        self.assertEqual(self.rows("SELECT last_paid_on, paid_total_cents FROM customer_accounts"), [(date(2026, 11, 2), 1000)])
+
+    def test_a_rolled_back_payment_leaves_the_account_alone(self):
+        self.invoice(customer_id="ann")
+        main.pay_invoice("i1", date(2026, 11, 2))
+        with self.assertRaises(Exception):
+            main.pay_invoice("i1", date(2026, 11, 3))
+        self.assertEqual(self.rows("SELECT last_paid_on, paid_total_cents FROM customer_accounts"), [(date(2026, 11, 2), 1000)])


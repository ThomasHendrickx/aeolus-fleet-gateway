| Scenario | SKILL.md | AIP | notes (SKILL.md / AIP) |
| --- | --- | --- | --- |
| S0.1 | NOT RUN | NOT RUN | no agent run recorded / no agent run recorded |
| S0.2 | NOT RUN | NOT RUN | no agent run recorded / no agent run recorded |
| S0.3 | NOT RUN | NOT RUN | no agent run recorded / no agent run recorded |
| S0.4 | NOT RUN | NOT RUN | no agent run recorded / no agent run recorded |
| S1.1 | NOT RUN | NOT RUN | no agent run recorded / no agent run recorded |
| S1.2 | NOT RUN | NOT RUN | no agent run recorded / no agent run recorded |
| S1.3 | NOT RUN | NOT RUN | no agent run recorded / no agent run recorded |
| S1.4 | NOT RUN | NOT RUN | no agent run recorded / no agent run recorded |
| S1.5 | NOT RUN | NOT RUN | no agent run recorded / no agent run recorded |
| S2.1 | PASS | PASS | applies=True new tables=[] PROJECTION.json=False / applies=True new tables=[] PROJECTION.json=False |
| S2.2 | NOT RUN | PASS | no agent run recorded / table=monthly_revenue_projection query reads projection=True query reads invoices=False report correct=True ([["2026-11-01", 900, 1], ["2026-10-01", 700, 1], ["2026-09-01", 3500, 2]]) same change twice same rows=True rebuild equals incremental=True rows=4 rebuild exit=0 |
| S2.3 | NOT RUN | PASS | no agent run recorded / src/adapters/pg_revenue_projection.py docstring declares the trigger (same transaction as the invoice change), staleness (zero), idempotency key ((invoice_id, change) in monthly_revenue_applied) and the rebuild command, with a rebuild() implementation. schema.sql repeats the key and rebuild. The projection is synchronous, and the docstring states the read-your-own-writes outcome. |
| S2.4 | NOT RUN | PASS | no agent run recorded / rolled-back dispatch: raised RaiseException, tables changed=[]; committed dispatch: committed, new tables that gained a row=['processed_shipping_events', 'shipping_outbox']; PROJECTION.json={"table": "order_shipping_status", "rebuild": "python3 -m src.rebuild_projection", "process": "python3 -m src.process_projection"} |
| S3.1 | NOT RUN | NOT RUN | no agent run recorded / no agent run recorded |
| S4.1 | NOT RUN | NOT RUN | no agent run recorded / no agent run recorded |
| S4.2 | NOT RUN | NOT RUN | no agent run recorded / no agent run recorded |

### S2.3 [aip] Then the projection declares its trigger, staleness bound, idempotency key and rebuild procedure, plus a read-your-own-writes strategy when async.
PROJECTION.json: {"table": "monthly_revenue_projection", "rebuild": "python3 -m src.adapters.pg_revenue_projection", "process": null}

diff base -> repo (src, schema.sql):
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/adapters/pg_invoices.py ../repo/src/adapters/pg_invoices.py
--- ../base/src/adapters/pg_invoices.py	2026-11-07 18:01:28.188630528 +0100
+++ ../repo/src/adapters/pg_invoices.py	2026-11-07 18:02:28.647016782 +0100
@@ -1,3 +1,4 @@
+from src.adapters import pg_revenue_projection
 from src.core.invoices import Invoice
 
 
@@ -18,6 +19,8 @@
     def add(self, invoice):
         self.conn.execute("INSERT INTO invoices (id, customer_id, amount_cents, issued_on, voided) VALUES (%s, %s, %s, %s, %s)",
                           (invoice.id, invoice.customer_id, invoice.amount_cents, invoice.issued_on, invoice.voided))
+        pg_revenue_projection.apply_issued(self.conn, invoice)
 
     def save(self, invoice):
         self.conn.execute("UPDATE invoices SET voided = %s WHERE id = %s", (invoice.voided, invoice.id))
+        pg_revenue_projection.apply_voided(self.conn, invoice)
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/adapters/pg_revenue_projection.py ../repo/src/adapters/pg_revenue_projection.py
--- ../base/src/adapters/pg_revenue_projection.py	1970-01-01 01:00:00.000000000 +0100
+++ ../repo/src/adapters/pg_revenue_projection.py	2026-11-07 18:02:28.634016914 +0100
@@ -0,0 +1,50 @@
+"""Monthly revenue projection (table monthly_revenue_projection), level 2 of cqrs.
+
+Trigger: same transaction as the invoice change (PgInvoiceRepository calls apply_* on its connection),
+so staleness is zero and the user reads their own writes.
+Idempotency key: (invoice_id, change) in monthly_revenue_applied; a change is applied once.
+Rebuild: python3 -m src.adapters.pg_revenue_projection  (recomputes every month from invoices).
+"""
+from src.db import connect
+
+
+def _first_time(conn, invoice_id, change):
+    row = conn.execute("INSERT INTO monthly_revenue_applied (invoice_id, change) VALUES (%s, %s) ON CONFLICT DO NOTHING RETURNING 1",
+                       (invoice_id, change)).fetchone()
+    return row is not None
+
+
+def _bump(conn, issued_on, cents, count):
+    conn.execute("""INSERT INTO monthly_revenue_projection (month, revenue_cents, invoices)
+                    VALUES (date_trunc('month', %(d)s::date)::date, %(c)s, %(n)s)
+                    ON CONFLICT (month) DO UPDATE SET revenue_cents = monthly_revenue_projection.revenue_cents + %(c)s,
+                                                      invoices = monthly_revenue_projection.invoices + %(n)s""",
+                 {"d": issued_on, "c": cents, "n": count})
+
+
+def apply_issued(conn, invoice):
+    if not invoice.voided and _first_time(conn, invoice.id, "issued"):
+        _bump(conn, invoice.issued_on, invoice.amount_cents, 1)
+
+
+def apply_voided(conn, invoice):
+    if invoice.voided and _first_time(conn, invoice.id, "voided"):
+        _bump(conn, invoice.issued_on, -invoice.amount_cents, -1)
+
+
+def rebuild(conn):
+    """Recompute the projection from invoices (the source). Also resets the idempotency markers."""
+    conn.execute("LOCK TABLE invoices IN SHARE MODE")
+    conn.execute("DELETE FROM monthly_revenue_projection")
+    conn.execute("DELETE FROM monthly_revenue_applied")
+    conn.execute("""INSERT INTO monthly_revenue_projection (month, revenue_cents, invoices)
+                    SELECT date_trunc('month', issued_on)::date, sum(amount_cents), count(*)
+                    FROM invoices WHERE NOT voided GROUP BY 1""")
+    conn.execute("INSERT INTO monthly_revenue_applied SELECT id, 'issued' FROM invoices WHERE NOT voided")
+    conn.execute("INSERT INTO monthly_revenue_applied SELECT id, 'issued' FROM invoices WHERE voided")
+    conn.execute("INSERT INTO monthly_revenue_applied SELECT id, 'voided' FROM invoices WHERE voided")
+
+
+if __name__ == "__main__":
+    with connect() as c:
+        rebuild(c)
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/queries/monthly_revenue.py ../repo/src/queries/monthly_revenue.py
--- ../base/src/queries/monthly_revenue.py	2026-11-07 18:01:28.190630508 +0100
+++ ../repo/src/queries/monthly_revenue.py	2026-11-07 18:02:28.647016782 +0100
@@ -12,11 +12,10 @@
 
 
 SQL = """
-SELECT date_trunc('month', issued_on)::date AS month, sum(amount_cents) AS revenue_cents, count(*) AS invoices
-FROM invoices
-WHERE NOT voided AND issued_on >= (date_trunc('month', %(today)s::date) - interval '23 months')::date AND issued_on <= %(today)s
-GROUP BY 1
-ORDER BY 1 DESC
+SELECT month, revenue_cents, invoices
+FROM monthly_revenue_projection
+WHERE invoices > 0 AND month >= (date_trunc('month', %(today)s::date) - interval '23 months')::date AND month <= %(today)s
+ORDER BY month DESC
 """
 
 
--- ../base/schema.sql	2026-11-07 18:01:28.188630528 +0100
+++ ../repo/schema.sql	2026-11-07 18:02:28.630016954 +0100
@@ -34,3 +34,18 @@
     issued_on date NOT NULL,
     voided boolean NOT NULL DEFAULT false
 );
+
+-- Projection for the monthly revenue report: one row per calendar month, updated in the
+-- transaction that issues or voids an invoice. Rebuild: python3 -m src.adapters.pg_revenue_projection
+CREATE TABLE monthly_revenue_projection (
+    month date PRIMARY KEY,
+    revenue_cents bigint NOT NULL DEFAULT 0,
+    invoices integer NOT NULL DEFAULT 0
+);
+
+-- Idempotency key: (invoice_id, change). A change is applied to the projection at most once.
+CREATE TABLE monthly_revenue_applied (
+    invoice_id text NOT NULL,
+    change text NOT NULL CHECK (change IN ('issued', 'voided')),
+    PRIMARY KEY (invoice_id, change)
+);


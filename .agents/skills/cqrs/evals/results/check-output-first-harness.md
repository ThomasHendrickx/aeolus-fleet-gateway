| Scenario | SKILL.md | AIP | notes (SKILL.md / AIP) |
| --- | --- | --- | --- |
| S0.1 | PASS | PASS | applies=False files added in src/queries=[] / applies=False files added in src/queries=[] |
| S0.2 | FAIL | PASS | violations=['src/core/commands/cancel_order.py imports src.queries.order_summary (command handler reads a query to decide, rule 9)', 'src/queries/order_summary.py imports src.core.orders (query side imports domain model, rule 4)'] / violations=['src/core/commands/cancel_order.py', 'src/queries/order_summary.py'] |
| S0.3 | FAIL | PASS | violations=['src/core/commands/cancel_order.py imports src.queries.order_summary (command handler reads a query to decide, rule 9)', 'src/queries/order_summary.py imports src.core.orders (query side imports domain model, rule 4)'] / violations=['src/core/commands/cancel_order.py', 'src/queries/order_summary.py'] |
| S0.4 | PASS | PASS | problems=[1, 3] applies=True (agent's P0 output) / problems=[1, 3] applies=True (agent's P0 output) |
| S1.1 | PASS | FAIL | query modules=['customer_totals.py'] read types={'customer_totals.py': ['CustomerTotalsPage', 'CustomerTotalsRow']} query imports of domain=[] page uses src.queries=True page still loads all orders=False queryTests exit=0 (OK) / query modules=['customer_totals.py'] read types={'customer_totals.py': ['CustomerTotalsPage', 'CustomerTotalsRow']} query imports of domain=[] page uses src.queries=False page still loads all orders=False queryTests exit=0 (OK) |
| S1.2 | NOT RUN | NOT RUN | agent ran, judge verdict missing / agent ran, judge verdict missing |
| S1.3 | PASS | PASS | methods added to repository ports or adapters=[] / methods added to repository ports or adapters=[] |
| S1.4 | PASS | PASS | query modules=['order_edit_form.py'] read types={'order_edit_form.py': ['OrderEditForm', 'OrderEditFormNotFound']} query imports of domain=[] form loads the Order=False new tables=[] queryTests exit=0 (OK) / query modules=['order_edit_form.py'] read types={'order_edit_form.py': ['OrderEditForm', 'OrderNotFound']} query imports of domain=[] form loads the Order=False new tables=[] queryTests exit=0 (OK) |
| S1.5 | NOT RUN | NOT RUN | agent ran, judge verdict missing / agent ran, judge verdict missing |
| S2.1 | PASS | PASS | applies=False new tables=[] PROJECTION.json=False / applies=False new tables=[] PROJECTION.json=False |
| S2.2 | PASS | PASS | table=monthly_revenue_projection query reads projection=True query reads invoices=False report correct=True ([["2026-11-01", 900, 1], ["2026-10-01", 700, 1], ["2026-09-01", 3500, 2]]) same change twice same rows=True rebuild equals incremental=True rows=4 rebuild exit=0 / table=monthly_revenue_projection query reads projection=True query reads invoices=False report correct=True ([["2026-11-01", 900, 1], ["2026-10-01", 700, 1], ["2026-09-01", 3500, 2]]) same change twice same rows=True rebuild equals incremental=True rows=4 rebuild exit=0 |
| S2.3 | NOT RUN | NOT RUN | agent ran, judge verdict missing / agent ran, judge verdict missing |
| S2.4 | PASS | PASS | rolled-back dispatch: raised RaiseException, tables changed=[]; committed dispatch: committed, new tables that gained a row=['order_shipping_processed', 'shipping_outbox']; PROJECTION.json={"table": "order_shipping_status", "rebuild": "python3 -m src.projections.order_shipping rebuild", "process": "python3 -m src.projections.order_shipping"} / rolled-back dispatch: raised RaiseException, tables changed=[]; committed dispatch: committed, new tables that gained a row=['shipping_outbox']; PROJECTION.json={"table": "order_shipping_status", "rebuild": "python3 -m src.projections.order_shipping rebuild", "process": "python3 -m src.projections.order_shipping process"} |
| S3.1 | PASS | FAIL | touched page calls the finder=False imports src.queries=True untouched page unchanged=True finder still in port and adapter=True queryTests exit=0 (OK) / touched page calls the finder=False imports src.queries=False untouched page unchanged=True finder still in port and adapter=True queryTests exit=0 (OK) |
| S4.1 | NOT RUN | NOT RUN | agent ran, judge verdict missing / agent ran, judge verdict missing |
| S4.2 | PASS | PASS | update_order still defined=True original UpdateOrder tests exit=0 (OK) / update_order still defined=True original UpdateOrder tests exit=0 (OK) |

### S1.2 [skill-md] Then paging, sort and totals are computed in SQL, not in code.
diff base -> repo (src, schema.sql):
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/queries/customer_totals.py ../repo/src/queries/customer_totals.py
--- ../base/src/queries/customer_totals.py	1970-01-01 01:00:00.000000000 +0100
+++ ../repo/src/queries/customer_totals.py	2026-11-07 09:25:17.264138815 +0100
@@ -0,0 +1,39 @@
+"""Query: customers with their non-cancelled order count and total spent, highest spender first."""
+from dataclasses import dataclass
+
+from src.db import connect
+
+
+@dataclass(frozen=True)
+class CustomerTotalsRow:
+    customer_id: str
+    name: str
+    orders: int
+    total_cents: int
+
+
+@dataclass(frozen=True)
+class CustomerTotalsPage:
+    rows: list
+    total: int
+
+
+_PER_CUSTOMER = """
+    SELECT c.id AS customer_id, c.name AS name, count(DISTINCT o.id) AS orders,
+           sum(l.quantity * l.unit_price_cents) AS total_cents
+    FROM customers c
+    JOIN orders o ON o.customer_id = c.id AND o.status <> 'cancelled'
+    JOIN order_lines l ON l.order_id = o.id
+    GROUP BY c.id, c.name
+    HAVING count(DISTINCT o.id) >= %(min_orders)s
+"""
+
+
+def customer_totals(page: int, page_size: int, min_orders: int = 0) -> CustomerTotalsPage:
+    params = {"min_orders": min_orders, "limit": page_size, "offset": (page - 1) * page_size}
+    with connect() as conn:
+        rows = conn.execute(
+            f"SELECT customer_id, name, orders, total_cents FROM ({_PER_CUSTOMER}) t"
+            " ORDER BY total_cents DESC, name, customer_id LIMIT %(limit)s OFFSET %(offset)s", params).fetchall()
+        total = conn.execute(f"SELECT count(*) FROM ({_PER_CUSTOMER}) t", params).fetchone()[0]
+    return CustomerTotalsPage([CustomerTotalsRow(r[0], r[1], int(r[2]), int(r[3])) for r in rows], total)
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/web/staff_pages.py ../repo/src/web/staff_pages.py
--- ../base/src/web/staff_pages.py	2026-11-07 09:24:37.152544696 +0100
+++ ../repo/src/web/staff_pages.py	2026-11-07 09:25:17.270138754 +0100
@@ -1,21 +1,11 @@
-from src.adapters.pg_unit_of_work import PgUnitOfWork
+from src.queries.customer_totals import customer_totals
 
 PAGE_SIZE = 20
 
 
 def customer_totals_page(page=1, min_orders=0):
     """Staff page: each customer's order count and total spent, highest spender first."""
-    with PgUnitOfWork() as uow:
-        orders = uow.orders.list_all()
-        customers = {c.id: c for c in uow.customers.list_all()}
-    totals = {}
-    for order in orders:
-        if order.status == "cancelled":
-            continue
-        row = totals.setdefault(order.customer_id, {"orders": 0, "total_cents": 0})
-        row["orders"] += 1
-        row["total_cents"] += order.total_cents
-    rows = [{"customer_id": cid, "name": customers[cid].name, **t} for cid, t in totals.items() if t["orders"] >= min_orders]
-    rows.sort(key=lambda r: (-r["total_cents"], r["name"]))
-    start = (page - 1) * PAGE_SIZE
-    return {"page": page, "rows": rows[start:start + PAGE_SIZE]}
+    result = customer_totals(page, PAGE_SIZE, min_orders)
+    rows = [{"customer_id": r.customer_id, "name": r.name, "orders": r.orders, "total_cents": r.total_cents}
+            for r in result.rows]
+    return {"page": page, "rows": rows, "total": result.total}

### S1.5 [skill-md] Then no query handler evaluates the tier rule; the tier is read from a field the write side persists.
diff base -> repo (src, schema.sql):
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/adapters/pg_customers.py ../repo/src/adapters/pg_customers.py
--- ../base/src/adapters/pg_customers.py	2026-11-07 09:24:37.846537674 +0100
+++ ../repo/src/adapters/pg_customers.py	2026-11-07 09:25:30.585004018 +0100
@@ -5,7 +5,7 @@
     pass
 
 
-COLUMNS = "id, name, email, created_on, suspended"
+COLUMNS = "id, name, email, created_on, suspended, counted_orders, loyalty_tier"
 
 
 class PgCustomerRepository:
@@ -13,16 +13,19 @@
         self.conn = conn
 
     def get(self, customer_id):
-        row = self.conn.execute(f"SELECT {COLUMNS} FROM customers WHERE id = %s", (customer_id,)).fetchone()
+        row = self.conn.execute(f"SELECT {COLUMNS} FROM customers WHERE id = %s FOR UPDATE", (customer_id,)).fetchone()
         if row is None:
             raise CustomerNotFound(customer_id)
         return Customer(*row)
 
     def save(self, customer):
         self.conn.execute(
-            "INSERT INTO customers (id, name, email, created_on, suspended) VALUES (%s, %s, %s, %s, %s)"
-            " ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email, suspended = EXCLUDED.suspended",
-            (customer.id, customer.name, customer.email, customer.created_on, customer.suspended))
+            "INSERT INTO customers (id, name, email, created_on, suspended, counted_orders, loyalty_tier)"
+            " VALUES (%s, %s, %s, %s, %s, %s, %s)"
+            " ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email, suspended = EXCLUDED.suspended,"
+            " counted_orders = EXCLUDED.counted_orders, loyalty_tier = EXCLUDED.loyalty_tier",
+            (customer.id, customer.name, customer.email, customer.created_on, customer.suspended,
+             customer.counted_orders, customer.loyalty_tier))
 
     def list_all(self):
         return [Customer(*row) for row in self.conn.execute(f"SELECT {COLUMNS} FROM customers ORDER BY name").fetchall()]
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/core/commands/customer_status.py ../repo/src/core/commands/customer_status.py
--- ../base/src/core/commands/customer_status.py	2026-11-07 09:24:37.847537664 +0100
+++ ../repo/src/core/commands/customer_status.py	2026-11-07 09:25:30.584004028 +0100
@@ -19,4 +19,7 @@
         order = uow.orders.get(order_id)
         order.cancel()
         uow.orders.save(order)
+        customer = uow.customers.get(order.customer_id)
+        customer.order_cancelled()
+        uow.customers.save(customer)
     return order.version
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/core/commands/place_order.py ../repo/src/core/commands/place_order.py
--- ../base/src/core/commands/place_order.py	2026-11-07 09:17:28.559879572 +0100
+++ ../repo/src/core/commands/place_order.py	2026-11-07 09:25:30.584004028 +0100
@@ -6,6 +6,8 @@
 def place_order(uow, order_id: str, number: str, customer_id: str, placed_on: date, address: Address, lines: list) -> str:
     order = Order(order_id, number, customer_id, placed_on, address, [OrderLine(**line) for line in lines])
     with uow:
-        uow.customers.get(customer_id)
+        customer = uow.customers.get(customer_id)
+        customer.order_placed()
+        uow.customers.save(customer)
         uow.orders.save(order)
     return order.id
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/core/customers.py ../repo/src/core/customers.py
--- ../base/src/core/customers.py	2026-11-07 09:24:37.847537664 +0100
+++ ../repo/src/core/customers.py	2026-11-07 09:25:30.584004028 +0100
@@ -1,6 +1,8 @@
 from dataclasses import dataclass
 from datetime import date
 
+from src.core.loyalty import loyalty_tier
+
 
 @dataclass
 class Customer:
@@ -9,9 +11,24 @@
     email: str
     created_on: date
     suspended: bool = False
+    counted_orders: int = 0
+    loyalty_tier: str = "standard"
+
+    def _retier(self):
+        self.loyalty_tier = loyalty_tier(self.counted_orders, self.suspended)
+
+    def order_placed(self):
+        self.counted_orders += 1
+        self._retier()
+
+    def order_cancelled(self):
+        self.counted_orders -= 1
+        self._retier()
 
     def suspend(self):
         self.suspended = True
+        self._retier()
 
     def reinstate(self):
         self.suspended = False
+        self._retier()
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/queries/customer_list.py ../repo/src/queries/customer_list.py
--- ../base/src/queries/customer_list.py	1970-01-01 01:00:00.000000000 +0100
+++ ../repo/src/queries/customer_list.py	2026-11-07 09:25:30.585004018 +0100
@@ -0,0 +1,31 @@
+"""Staff customer list query: one page of name, email and loyalty tier, by name."""
+from dataclasses import dataclass
+
+from src.db import connect
+
+PAGE_SIZE = 25
+
+
+@dataclass(frozen=True)
+class CustomerListRow:
+    customer_id: str
+    name: str
+    email: str
+    tier: str
+
+
+@dataclass(frozen=True)
+class CustomerListPage:
+    page: int
+    total: int
+    rows: list
+
+
+def customer_list(page: int = 1) -> CustomerListPage:
+    page = max(page, 1)
+    with connect() as conn:
+        total = conn.execute("SELECT count(*) FROM customers").fetchone()[0]
+        rows = conn.execute(
+            "SELECT id, name, email, loyalty_tier FROM customers ORDER BY name, id LIMIT %s OFFSET %s",
+            (PAGE_SIZE, (page - 1) * PAGE_SIZE)).fetchall()
+    return CustomerListPage(page, total, [CustomerListRow(*r) for r in rows])
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/web/staff_pages.py ../repo/src/web/staff_pages.py
--- ../base/src/web/staff_pages.py	2026-11-07 09:24:37.850537634 +0100
+++ ../repo/src/web/staff_pages.py	2026-11-07 09:25:30.585004018 +0100
@@ -1,17 +1,9 @@
-from src.adapters.pg_unit_of_work import PgUnitOfWork
-from src.core.loyalty import loyalty_tier
+from dataclasses import asdict
 
-PAGE_SIZE = 25
+from src.queries.customer_list import PAGE_SIZE, customer_list as _customer_list  # noqa: F401
 
 
 def customer_list(page=1):
     """Staff customer list: name, email and loyalty tier, by name."""
-    with PgUnitOfWork() as uow:
-        rows = []
-        for customer in uow.customers.list_all():
-            orders = uow.orders.list_for_customer(customer.id)
-            counted = sum(1 for o in orders if o.status != "cancelled")
-            rows.append({"customer_id": customer.id, "name": customer.name, "email": customer.email,
-                         "tier": loyalty_tier(counted, customer.suspended)})
-    start = (page - 1) * PAGE_SIZE
-    return {"page": page, "rows": rows[start:start + PAGE_SIZE]}
+    result = _customer_list(page)
+    return {"page": result.page, "total": result.total, "rows": [asdict(r) for r in result.rows]}
--- ../base/schema.sql	2026-11-07 09:24:37.846537674 +0100
+++ ../repo/schema.sql	2026-11-07 09:25:30.579004079 +0100
@@ -28,3 +28,14 @@
 );
 
 ALTER TABLE customers ADD COLUMN suspended boolean NOT NULL DEFAULT false;
+
+ALTER TABLE customers ADD COLUMN counted_orders integer NOT NULL DEFAULT 0;
+ALTER TABLE customers ADD COLUMN loyalty_tier text NOT NULL DEFAULT 'standard';
+CREATE INDEX customers_name_id ON customers (name, id);
+CREATE INDEX orders_customer_id ON orders (customer_id);
+
+-- Backfill for an existing database (no-op on an empty one). Mirrors src/core/loyalty.py.
+UPDATE customers c SET counted_orders = n.cnt
+  FROM (SELECT customer_id, count(*) AS cnt FROM orders WHERE status <> 'cancelled' GROUP BY customer_id) n
+ WHERE n.customer_id = c.id;
+UPDATE customers SET loyalty_tier = CASE WHEN counted_orders > 10 AND NOT suspended THEN 'gold' ELSE 'standard' END;

### S2.3 [skill-md] Then the projection declares its trigger, staleness bound, idempotency key and rebuild procedure, plus a read-your-own-writes strategy when async.
PROJECTION.json: {"table": "monthly_revenue_projection", "rebuild": "python3 -m src.adapters.revenue_projection", "process": null}

diff base -> repo (src, schema.sql):
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/adapters/pg_invoices.py ../repo/src/adapters/pg_invoices.py
--- ../base/src/adapters/pg_invoices.py	2026-11-07 09:24:38.511530945 +0100
+++ ../repo/src/adapters/pg_invoices.py	2026-11-07 09:25:42.909879299 +0100
@@ -1,3 +1,4 @@
+from src.adapters import revenue_projection
 from src.core.invoices import Invoice
 
 
@@ -18,6 +19,9 @@
     def add(self, invoice):
         self.conn.execute("INSERT INTO invoices (id, customer_id, amount_cents, issued_on, voided) VALUES (%s, %s, %s, %s, %s)",
                           (invoice.id, invoice.customer_id, invoice.amount_cents, invoice.issued_on, invoice.voided))
+        revenue_projection.on_issued(self.conn, invoice)
 
     def save(self, invoice):
         self.conn.execute("UPDATE invoices SET voided = %s WHERE id = %s", (invoice.voided, invoice.id))
+        if invoice.voided:
+            revenue_projection.on_voided(self.conn, invoice)
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/adapters/revenue_projection.py ../repo/src/adapters/revenue_projection.py
--- ../base/src/adapters/revenue_projection.py	1970-01-01 01:00:00.000000000 +0100
+++ ../repo/src/adapters/revenue_projection.py	2026-11-07 09:25:34.169967741 +0100
@@ -0,0 +1,55 @@
+"""monthly_revenue_projection: per-month revenue of non-voided invoices.
+
+Trigger: same transaction as the invoice command (called by PgInvoiceRepository). Staleness: none.
+Idempotency key: (invoice_id, change) in monthly_revenue_applied. Rebuild: python3 -m src.adapters.revenue_projection.
+"""
+from src.db import connect
+
+_APPLY = """
+INSERT INTO monthly_revenue_projection (month, revenue_cents, invoices)
+VALUES (date_trunc('month', %(on)s::date)::date, %(cents)s, %(n)s)
+ON CONFLICT (month) DO UPDATE SET revenue_cents = monthly_revenue_projection.revenue_cents + EXCLUDED.revenue_cents,
+                                  invoices = monthly_revenue_projection.invoices + EXCLUDED.invoices
+"""
+
+
+def _once(conn, invoice_id, change):
+    cur = conn.execute("INSERT INTO monthly_revenue_applied (invoice_id, change) VALUES (%s, %s) ON CONFLICT DO NOTHING",
+                       (invoice_id, change))
+    return cur.rowcount == 1
+
+
+def on_issued(conn, invoice):
+    if invoice.voided or not _once(conn, invoice.id, "issued"):
+        return
+    conn.execute(_APPLY, {"on": invoice.issued_on, "cents": invoice.amount_cents, "n": 1})
+
+
+def on_voided(conn, invoice):
+    if not _once(conn, invoice.id, "voided"):
+        return
+    if _was_counted(conn, invoice.id):
+        conn.execute(_APPLY, {"on": invoice.issued_on, "cents": -invoice.amount_cents, "n": -1})
+
+
+def _was_counted(conn, invoice_id):
+    # An invoice created voided is never counted; otherwise its issue was applied (or is covered by a rebuild).
+    return conn.execute("SELECT 1 FROM monthly_revenue_applied WHERE invoice_id = %s AND change = 'issued'",
+                        (invoice_id,)).fetchone() is not None
+
+
+def rebuild():
+    """Recompute the projection and its idempotency markers from invoices."""
+    with connect() as conn, conn.transaction():
+        conn.execute("LOCK TABLE invoices IN SHARE MODE")
+        conn.execute("TRUNCATE monthly_revenue_projection, monthly_revenue_applied")
+        conn.execute("""INSERT INTO monthly_revenue_projection
+                        SELECT date_trunc('month', issued_on)::date, sum(amount_cents), count(*)
+                        FROM invoices WHERE NOT voided GROUP BY 1""")
+        conn.execute("INSERT INTO monthly_revenue_applied SELECT id, 'issued' FROM invoices WHERE NOT voided")
+        conn.execute("INSERT INTO monthly_revenue_applied SELECT id, 'issued' FROM invoices WHERE voided")
+        conn.execute("INSERT INTO monthly_revenue_applied SELECT id, 'voided' FROM invoices WHERE voided")
+
+
+if __name__ == "__main__":
+    rebuild()
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/queries/monthly_revenue.py ../repo/src/queries/monthly_revenue.py
--- ../base/src/queries/monthly_revenue.py	2026-11-07 09:24:38.512530935 +0100
+++ ../repo/src/queries/monthly_revenue.py	2026-11-07 09:25:42.909879299 +0100
@@ -12,11 +12,11 @@
 
 
 SQL = """
-SELECT date_trunc('month', issued_on)::date AS month, sum(amount_cents) AS revenue_cents, count(*) AS invoices
-FROM invoices
-WHERE NOT voided AND issued_on >= (date_trunc('month', %(today)s::date) - interval '23 months')::date AND issued_on <= %(today)s
-GROUP BY 1
-ORDER BY 1 DESC
+SELECT month, revenue_cents, invoices
+FROM monthly_revenue_projection
+WHERE invoices > 0 AND month >= (date_trunc('month', %(today)s::date) - interval '23 months')::date
+  AND month <= date_trunc('month', %(today)s::date)::date
+ORDER BY month DESC
 """
 
 
--- ../base/schema.sql	2026-11-07 09:24:38.511530945 +0100
+++ ../repo/schema.sql	2026-11-07 09:25:34.169967741 +0100
@@ -34,3 +34,17 @@
     issued_on date NOT NULL,
     voided boolean NOT NULL DEFAULT false
 );
+
+-- Projection for the monthly revenue report (same transaction as invoice commands).
+CREATE TABLE monthly_revenue_projection (
+    month date PRIMARY KEY,
+    revenue_cents bigint NOT NULL,
+    invoices integer NOT NULL
+);
+
+-- Idempotency key: one row per (invoice, change); a repeated change is ignored.
+CREATE TABLE monthly_revenue_applied (
+    invoice_id text NOT NULL,
+    change text NOT NULL CHECK (change IN ('issued', 'voided')),
+    PRIMARY KEY (invoice_id, change)
+);

### S4.1 [skill-md] Then a command named for the address change carries only address fields and returns id, outcome or version.
diff base -> repo (src, schema.sql):
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/core/commands/change_shipping_address.py ../repo/src/core/commands/change_shipping_address.py
--- ../base/src/core/commands/change_shipping_address.py	1970-01-01 01:00:00.000000000 +0100
+++ ../repo/src/core/commands/change_shipping_address.py	2026-11-07 09:25:36.980939296 +0100
@@ -0,0 +1,10 @@
+from src.core.orders import Address
+
+
+def change_shipping_address(uow, order_id: str, street: str, city: str, postcode: str) -> int:
+    """Customer intent: ship this order to another address. Allowed until the order ships."""
+    with uow:
+        order = uow.orders.get(order_id)
+        order.change_shipping_address(Address(street, city, postcode))
+        uow.orders.save(order)
+    return order.version
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/core/orders.py ../repo/src/core/orders.py
--- ../base/src/core/orders.py	2026-11-07 09:17:28.555879613 +0100
+++ ../repo/src/core/orders.py	2026-11-07 09:25:36.975939346 +0100
@@ -50,6 +50,11 @@
     def total_cents(self):
         return sum(line.total_cents for line in self.lines)
 
+    def change_shipping_address(self, address):
+        if self.status != "placed":
+            raise OrderError(f"the address of a {self.status} order cannot change")
+        self.shipping_address = address
+
     def ship(self):
         if self.status != "placed":
             raise OrderError(f"cannot ship a {self.status} order")
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/main.py ../repo/src/main.py
--- ../base/src/main.py	2026-11-07 09:24:39.638519542 +0100
+++ ../repo/src/main.py	2026-11-07 09:25:36.975939346 +0100
@@ -1,5 +1,6 @@
 """Composition root: wires use cases and reads to Postgres. The web handlers in src/web call these."""
 from src.adapters.pg_unit_of_work import PgUnitOfWork
+from src.core.commands.change_shipping_address import change_shipping_address as _change_shipping_address
 from src.core.commands.place_order import place_order as _place_order
 from src.core.commands.register_customer import register_customer as _register_customer
 from src.core.commands.ship_order import ship_order as _ship_order
@@ -20,3 +21,7 @@
 def update_order(order_id, dto):
     from src.core.commands.update_order import update_order as _update
     return _update(PgUnitOfWork(), order_id, dto)
+
+
+def change_shipping_address(order_id, street, city, postcode):
+    return _change_shipping_address(PgUnitOfWork(), order_id, street, city, postcode)
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/web/order_pages.py ../repo/src/web/order_pages.py
--- ../base/src/web/order_pages.py	2026-11-07 09:24:39.638519542 +0100
+++ ../repo/src/web/order_pages.py	2026-11-07 09:25:36.981939286 +0100
@@ -4,3 +4,8 @@
 def put_order(order_id, body):
     """Staff edit screen saves the whole order form."""
     return {"version": main.update_order(order_id, body)}
+
+
+def post_shipping_address(order_id, body):
+    """Customer order page changes only the shipping address."""
+    return {"version": main.change_shipping_address(order_id, body["street"], body["city"], body["postcode"])}

### S1.2 [aip] Then paging, sort and totals are computed in SQL, not in code.
diff base -> repo (src, schema.sql):
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/adapters/pg_customers.py ../repo/src/adapters/pg_customers.py
--- ../base/src/adapters/pg_customers.py	2026-11-07 09:24:41.135504395 +0100
+++ ../repo/src/adapters/pg_customers.py	2026-11-07 09:25:31.604993697 +0100
@@ -20,6 +20,3 @@
             "INSERT INTO customers (id, name, email, created_on) VALUES (%s, %s, %s, %s)"
             " ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email",
             (customer.id, customer.name, customer.email, customer.created_on))
-
-    def list_all(self):
-        return [Customer(*row) for row in self.conn.execute("SELECT id, name, email, created_on FROM customers ORDER BY id").fetchall()]
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/adapters/pg_orders.py ../repo/src/adapters/pg_orders.py
--- ../base/src/adapters/pg_orders.py	2026-11-07 09:24:41.135504395 +0100
+++ ../repo/src/adapters/pg_orders.py	2026-11-07 09:25:31.604993697 +0100
@@ -42,7 +42,3 @@
                         [(order.id, n, l.sku, l.quantity, l.unit_price_cents) for n, l in enumerate(order.lines, 1)])
         except psycopg.errors.UniqueViolation as error:
             raise DuplicateOrderNumber(order.number) from error
-
-    def list_all(self):
-        ids = [row[0] for row in self.conn.execute("SELECT id FROM orders ORDER BY placed_on, id").fetchall()]
-        return [self.get(order_id) for order_id in ids]
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/core/ports.py ../repo/src/core/ports.py
--- ../base/src/core/ports.py	2026-11-07 09:24:41.136504385 +0100
+++ ../repo/src/core/ports.py	2026-11-07 09:25:31.604993697 +0100
@@ -17,16 +17,12 @@
 
     def save(self, order: Order) -> None: ...
 
-    def list_all(self) -> list[Order]: ...
-
 
 class CustomerRepository(Protocol):
     def get(self, customer_id: str) -> Customer: ...
 
     def save(self, customer: Customer) -> None: ...
 
-    def list_all(self) -> list[Customer]: ...
-
 
 class UnitOfWork(Protocol):
     orders: OrderRepository
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/main.py ../repo/src/main.py
--- ../base/src/main.py	2026-11-07 09:17:28.565879511 +0100
+++ ../repo/src/main.py	2026-11-07 09:25:16.080150795 +0100
@@ -15,3 +15,7 @@
 
 def register_customer(*args, **kwargs):
     return _register_customer(PgUnitOfWork(), *args, **kwargs)
+
+
+from src.queries.customer_totals import PAGE_SIZE as CUSTOMER_TOTALS_PAGE_SIZE  # noqa: E402
+from src.queries.customer_totals import customer_totals  # noqa: E402,F401
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/queries/customer_totals.py ../repo/src/queries/customer_totals.py
--- ../base/src/queries/customer_totals.py	1970-01-01 01:00:00.000000000 +0100
+++ ../repo/src/queries/customer_totals.py	2026-11-07 09:25:16.074150856 +0100
@@ -0,0 +1,43 @@
+"""Query: staff customer totals page. Reads the tables directly; no domain imports."""
+from dataclasses import dataclass
+
+from src.db import connect
+
+PAGE_SIZE = 20
+
+
+@dataclass(frozen=True)
+class CustomerTotalsRow:
+    customer_id: str
+    name: str
+    orders: int
+    total_cents: int
+
+
+@dataclass(frozen=True)
+class CustomerTotalsPage:
+    page: int
+    total_customers: int
+    rows: list
+
+
+_TOTALS = """
+    SELECT c.id AS customer_id, c.name, count(DISTINCT o.id) AS orders,
+           sum(l.quantity * l.unit_price_cents)::bigint AS total_cents
+    FROM customers c
+    JOIN orders o ON o.customer_id = c.id AND o.status <> 'cancelled'
+    JOIN order_lines l ON l.order_id = o.id
+    GROUP BY c.id, c.name
+    HAVING count(DISTINCT o.id) >= %(min_orders)s
+"""
+
+
+def customer_totals(page=1, min_orders=0):
+    params = {"min_orders": min_orders, "limit": PAGE_SIZE, "offset": (page - 1) * PAGE_SIZE}
+    with connect() as conn:
+        total = conn.execute(f"SELECT count(*) FROM ({_TOTALS}) t", params).fetchone()[0]
+        found = conn.execute(
+            f"{_TOTALS} ORDER BY total_cents DESC, c.name LIMIT %(limit)s OFFSET %(offset)s", params
+        ).fetchall()
+    rows = [CustomerTotalsRow(cid, name, int(n), int(t)) for cid, name, n, t in found]
+    return CustomerTotalsPage(page, total, rows)
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/web/staff_pages.py ../repo/src/web/staff_pages.py
--- ../base/src/web/staff_pages.py	2026-11-07 09:24:41.136504385 +0100
+++ ../repo/src/web/staff_pages.py	2026-11-07 09:25:16.075150846 +0100
@@ -1,21 +1,16 @@
-from src.adapters.pg_unit_of_work import PgUnitOfWork
+from src import main
 
-PAGE_SIZE = 20
+PAGE_SIZE = main.CUSTOMER_TOTALS_PAGE_SIZE
 
 
 def customer_totals_page(page=1, min_orders=0):
     """Staff page: each customer's order count and total spent, highest spender first."""
-    with PgUnitOfWork() as uow:
-        orders = uow.orders.list_all()
-        customers = {c.id: c for c in uow.customers.list_all()}
-    totals = {}
-    for order in orders:
-        if order.status == "cancelled":
-            continue
-        row = totals.setdefault(order.customer_id, {"orders": 0, "total_cents": 0})
-        row["orders"] += 1
-        row["total_cents"] += order.total_cents
-    rows = [{"customer_id": cid, "name": customers[cid].name, **t} for cid, t in totals.items() if t["orders"] >= min_orders]
-    rows.sort(key=lambda r: (-r["total_cents"], r["name"]))
-    start = (page - 1) * PAGE_SIZE
-    return {"page": page, "rows": rows[start:start + PAGE_SIZE]}
+    result = main.customer_totals(page, min_orders)
+    return {
+        "page": result.page,
+        "total_customers": result.total_customers,
+        "rows": [
+            {"customer_id": r.customer_id, "name": r.name, "orders": r.orders, "total_cents": r.total_cents}
+            for r in result.rows
+        ],
+    }

### S1.5 [aip] Then no query handler evaluates the tier rule; the tier is read from a field the write side persists.
diff base -> repo (src, schema.sql):
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/adapters/pg_customers.py ../repo/src/adapters/pg_customers.py
--- ../base/src/adapters/pg_customers.py	2026-11-07 09:24:42.412491473 +0100
+++ ../repo/src/adapters/pg_customers.py	2026-11-07 09:25:49.240815233 +0100
@@ -5,24 +5,23 @@
     pass
 
 
-COLUMNS = "id, name, email, created_on, suspended"
+COLUMNS = "id, name, email, created_on, suspended, loyalty_tier"
 
 
 class PgCustomerRepository:
     def __init__(self, conn):
         self.conn = conn
 
-    def get(self, customer_id):
-        row = self.conn.execute(f"SELECT {COLUMNS} FROM customers WHERE id = %s", (customer_id,)).fetchone()
+    def get(self, customer_id, for_update=False):
+        lock = " FOR UPDATE" if for_update else ""
+        row = self.conn.execute(f"SELECT {COLUMNS} FROM customers WHERE id = %s{lock}", (customer_id,)).fetchone()
         if row is None:
             raise CustomerNotFound(customer_id)
         return Customer(*row)
 
     def save(self, customer):
         self.conn.execute(
-            "INSERT INTO customers (id, name, email, created_on, suspended) VALUES (%s, %s, %s, %s, %s)"
-            " ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email, suspended = EXCLUDED.suspended",
-            (customer.id, customer.name, customer.email, customer.created_on, customer.suspended))
-
-    def list_all(self):
-        return [Customer(*row) for row in self.conn.execute(f"SELECT {COLUMNS} FROM customers ORDER BY name").fetchall()]
+            "INSERT INTO customers (id, name, email, created_on, suspended, loyalty_tier) VALUES (%s, %s, %s, %s, %s, %s)"
+            " ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email, suspended = EXCLUDED.suspended,"
+            " loyalty_tier = EXCLUDED.loyalty_tier",
+            (customer.id, customer.name, customer.email, customer.created_on, customer.suspended, customer.loyalty_tier))
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/adapters/pg_orders.py ../repo/src/adapters/pg_orders.py
--- ../base/src/adapters/pg_orders.py	2026-11-07 09:24:42.413491463 +0100
+++ ../repo/src/adapters/pg_orders.py	2026-11-07 09:25:49.240815233 +0100
@@ -43,6 +43,6 @@
         except psycopg.errors.UniqueViolation as error:
             raise DuplicateOrderNumber(order.number) from error
 
-    def list_for_customer(self, customer_id):
-        ids = [row[0] for row in self.conn.execute("SELECT id FROM orders WHERE customer_id = %s ORDER BY placed_on", (customer_id,)).fetchall()]
-        return [self.get(order_id) for order_id in ids]
+    def count_not_cancelled(self, customer_id):
+        return self.conn.execute("SELECT count(*) FROM orders WHERE customer_id = %s AND status <> 'cancelled'",
+                                 (customer_id,)).fetchone()[0]
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/core/commands/customer_status.py ../repo/src/core/commands/customer_status.py
--- ../base/src/core/commands/customer_status.py	2026-11-07 09:24:42.413491463 +0100
+++ ../repo/src/core/commands/customer_status.py	2026-11-07 09:25:37.010938992 +0100
@@ -1,8 +1,12 @@
+from src.core.commands.loyalty_tier import refresh_loyalty_tier
+
+
 def suspend_customer(uow, customer_id: str) -> str:
     with uow:
         customer = uow.customers.get(customer_id)
         customer.suspend()
         uow.customers.save(customer)
+        refresh_loyalty_tier(uow, customer_id)
     return customer_id
 
 
@@ -11,6 +15,7 @@
         customer = uow.customers.get(customer_id)
         customer.reinstate()
         uow.customers.save(customer)
+        refresh_loyalty_tier(uow, customer_id)
     return customer_id
 
 
@@ -19,4 +24,5 @@
         order = uow.orders.get(order_id)
         order.cancel()
         uow.orders.save(order)
+        refresh_loyalty_tier(uow, order.customer_id)
     return order.version
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/core/commands/loyalty_tier.py ../repo/src/core/commands/loyalty_tier.py
--- ../base/src/core/commands/loyalty_tier.py	1970-01-01 01:00:00.000000000 +0100
+++ ../repo/src/core/commands/loyalty_tier.py	2026-11-07 09:25:37.010938992 +0100
@@ -0,0 +1,8 @@
+from src.core.loyalty import loyalty_tier
+
+
+def refresh_loyalty_tier(uow, customer_id: str) -> None:
+    """Recompute and persist the customer's tier inside the caller's transaction (the customer row is locked)."""
+    customer = uow.customers.get(customer_id, for_update=True)
+    customer.loyalty_tier = loyalty_tier(uow.orders.count_not_cancelled(customer_id), customer.suspended)
+    uow.customers.save(customer)
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/core/commands/place_order.py ../repo/src/core/commands/place_order.py
--- ../base/src/core/commands/place_order.py	2026-11-07 09:17:28.559879572 +0100
+++ ../repo/src/core/commands/place_order.py	2026-11-07 09:25:37.010938992 +0100
@@ -1,5 +1,6 @@
 from datetime import date
 
+from src.core.commands.loyalty_tier import refresh_loyalty_tier
 from src.core.orders import Address, Order, OrderLine
 
 
@@ -8,4 +9,5 @@
     with uow:
         uow.customers.get(customer_id)
         uow.orders.save(order)
+        refresh_loyalty_tier(uow, customer_id)
     return order.id
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/core/customers.py ../repo/src/core/customers.py
--- ../base/src/core/customers.py	2026-11-07 09:24:42.414491453 +0100
+++ ../repo/src/core/customers.py	2026-11-07 09:25:37.009939003 +0100
@@ -9,6 +9,7 @@
     email: str
     created_on: date
     suspended: bool = False
+    loyalty_tier: str = "standard"
 
     def suspend(self):
         self.suspended = True
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/core/ports.py ../repo/src/core/ports.py
--- ../base/src/core/ports.py	2026-11-07 09:24:42.414491453 +0100
+++ ../repo/src/core/ports.py	2026-11-07 09:25:49.240815233 +0100
@@ -17,16 +17,14 @@
 
     def save(self, order: Order) -> None: ...
 
-    def list_for_customer(self, customer_id: str) -> list[Order]: ...
+    def count_not_cancelled(self, customer_id: str) -> int: ...
 
 
 class CustomerRepository(Protocol):
-    def get(self, customer_id: str) -> Customer: ...
+    def get(self, customer_id: str, for_update: bool = False) -> Customer: ...
 
     def save(self, customer: Customer) -> None: ...
 
-    def list_all(self) -> list[Customer]: ...
-
 
 class UnitOfWork(Protocol):
     orders: OrderRepository
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/main.py ../repo/src/main.py
--- ../base/src/main.py	2026-11-07 09:24:42.415491443 +0100
+++ ../repo/src/main.py	2026-11-07 09:25:37.010938992 +0100
@@ -30,3 +30,8 @@
 def cancel_order(order_id):
     from src.core.commands.customer_status import cancel_order as _cancel
     return _cancel(PgUnitOfWork(), order_id)
+
+
+def customer_list(page=1):
+    from src.queries.customer_list import customer_list as _customer_list
+    return _customer_list(page)
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/queries/customer_list.py ../repo/src/queries/customer_list.py
--- ../base/src/queries/customer_list.py	1970-01-01 01:00:00.000000000 +0100
+++ ../repo/src/queries/customer_list.py	2026-11-07 09:25:37.010938992 +0100
@@ -0,0 +1,32 @@
+"""Query: staff customer list. Reads the tables directly; the tier is persisted by the write side."""
+from dataclasses import dataclass
+
+from src.db import connect
+
+PAGE_SIZE = 25
+
+
+@dataclass(frozen=True)
+class CustomerListRow:
+    customer_id: str
+    name: str
+    email: str
+    tier: str
+
+
+@dataclass(frozen=True)
+class CustomerListPage:
+    page: int
+    page_size: int
+    total: int
+    rows: list
+
+
+def customer_list(page: int = 1) -> CustomerListPage:
+    page = max(page, 1)
+    with connect() as conn:
+        total = conn.execute("SELECT count(*) FROM customers").fetchone()[0]
+        found = conn.execute(
+            "SELECT id, name, email, loyalty_tier FROM customers ORDER BY name, id LIMIT %s OFFSET %s",
+            (PAGE_SIZE, (page - 1) * PAGE_SIZE)).fetchall()
+    return CustomerListPage(page, PAGE_SIZE, total, [CustomerListRow(*row) for row in found])
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/web/staff_pages.py ../repo/src/web/staff_pages.py
--- ../base/src/web/staff_pages.py	2026-11-07 09:24:42.415491443 +0100
+++ ../repo/src/web/staff_pages.py	2026-11-07 09:25:37.010938992 +0100
@@ -1,17 +1,9 @@
-from src.adapters.pg_unit_of_work import PgUnitOfWork
-from src.core.loyalty import loyalty_tier
+from dataclasses import asdict
 
-PAGE_SIZE = 25
+from src import main
 
 
 def customer_list(page=1):
     """Staff customer list: name, email and loyalty tier, by name."""
-    with PgUnitOfWork() as uow:
-        rows = []
-        for customer in uow.customers.list_all():
-            orders = uow.orders.list_for_customer(customer.id)
-            counted = sum(1 for o in orders if o.status != "cancelled")
-            rows.append({"customer_id": customer.id, "name": customer.name, "email": customer.email,
-                         "tier": loyalty_tier(counted, customer.suspended)})
-    start = (page - 1) * PAGE_SIZE
-    return {"page": page, "rows": rows[start:start + PAGE_SIZE]}
+    result = main.customer_list(page)
+    return {"page": result.page, "total": result.total, "rows": [asdict(r) for r in result.rows]}
--- ../base/schema.sql	2026-11-07 09:24:42.412491473 +0100
+++ ../repo/schema.sql	2026-11-07 09:25:37.009939003 +0100
@@ -28,3 +28,11 @@
 );
 
 ALTER TABLE customers ADD COLUMN suspended boolean NOT NULL DEFAULT false;
+
+-- Loyalty tier is persisted by the write side (src/core/loyalty.py); the staff list only reads it.
+ALTER TABLE customers ADD COLUMN loyalty_tier text NOT NULL DEFAULT 'standard';
+UPDATE customers c SET loyalty_tier = 'gold'
+ WHERE NOT c.suspended AND (SELECT count(*) FROM orders o WHERE o.customer_id = c.id AND o.status <> 'cancelled') > 10;
+
+CREATE INDEX customers_name_id ON customers (name, id);
+CREATE INDEX orders_customer_id ON orders (customer_id);

### S2.3 [aip] Then the projection declares its trigger, staleness bound, idempotency key and rebuild procedure, plus a read-your-own-writes strategy when async.
PROJECTION.json: {"table": "monthly_revenue_projection", "rebuild": "python3 -m src.rebuild_revenue_projection", "process": null}

diff base -> repo (src, schema.sql):
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/adapters/pg_invoices.py ../repo/src/adapters/pg_invoices.py
--- ../base/src/adapters/pg_invoices.py	2026-11-07 09:24:44.002475385 +0100
+++ ../repo/src/adapters/pg_invoices.py	2026-11-07 09:25:39.670912075 +0100
@@ -5,6 +5,15 @@
     pass
 
 
+BUMP = """
+INSERT INTO monthly_revenue_projection (month, revenue_cents, invoices)
+VALUES (date_trunc('month', %(issued_on)s::date)::date, %(amount)s, %(count)s)
+ON CONFLICT (month) DO UPDATE
+SET revenue_cents = monthly_revenue_projection.revenue_cents + EXCLUDED.revenue_cents,
+    invoices = monthly_revenue_projection.invoices + EXCLUDED.invoices
+"""
+
+
 class PgInvoiceRepository:
     def __init__(self, conn):
         self.conn = conn
@@ -18,6 +27,17 @@
     def add(self, invoice):
         self.conn.execute("INSERT INTO invoices (id, customer_id, amount_cents, issued_on, voided) VALUES (%s, %s, %s, %s, %s)",
                           (invoice.id, invoice.customer_id, invoice.amount_cents, invoice.issued_on, invoice.voided))
+        if not invoice.voided:
+            self._bump(invoice.issued_on, invoice.amount_cents, 1)
 
     def save(self, invoice):
-        self.conn.execute("UPDATE invoices SET voided = %s WHERE id = %s", (invoice.voided, invoice.id))
+        # Only a real voided transition moves the projection, so a repeated save cannot double-update it.
+        changed = self.conn.execute(
+            "UPDATE invoices SET voided = %s WHERE id = %s AND voided <> %s RETURNING amount_cents, issued_on",
+            (invoice.voided, invoice.id, invoice.voided)).fetchone()
+        if changed:
+            sign = -1 if invoice.voided else 1
+            self._bump(changed[1], sign * changed[0], sign)
+
+    def _bump(self, issued_on, amount, count):
+        self.conn.execute(BUMP, {"issued_on": issued_on, "amount": amount, "count": count})
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/queries/monthly_revenue.py ../repo/src/queries/monthly_revenue.py
--- ../base/src/queries/monthly_revenue.py	2026-11-07 09:24:44.004475365 +0100
+++ ../repo/src/queries/monthly_revenue.py	2026-11-07 09:25:39.670912075 +0100
@@ -12,11 +12,11 @@
 
 
 SQL = """
-SELECT date_trunc('month', issued_on)::date AS month, sum(amount_cents) AS revenue_cents, count(*) AS invoices
-FROM invoices
-WHERE NOT voided AND issued_on >= (date_trunc('month', %(today)s::date) - interval '23 months')::date AND issued_on <= %(today)s
-GROUP BY 1
-ORDER BY 1 DESC
+SELECT month, revenue_cents, invoices
+FROM monthly_revenue_projection
+WHERE invoices > 0 AND month >= (date_trunc('month', %(today)s::date) - interval '23 months')::date
+  AND month <= %(today)s
+ORDER BY month DESC
 """
 
 
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/rebuild_revenue_projection.py ../repo/src/rebuild_revenue_projection.py
--- ../base/src/rebuild_revenue_projection.py	1970-01-01 01:00:00.000000000 +0100
+++ ../repo/src/rebuild_revenue_projection.py	2026-11-07 09:25:39.650912277 +0100
@@ -0,0 +1,28 @@
+"""Rebuild monthly_revenue_projection from invoices: python3 -m src.rebuild_revenue_projection"""
+from src.db import connect
+
+DDL = """
+CREATE TABLE IF NOT EXISTS monthly_revenue_projection (
+    month date PRIMARY KEY,
+    revenue_cents bigint NOT NULL,
+    invoices integer NOT NULL
+)
+"""
+
+REBUILD = """
+INSERT INTO monthly_revenue_projection (month, revenue_cents, invoices)
+SELECT date_trunc('month', issued_on)::date, sum(amount_cents), count(*) FROM invoices WHERE NOT voided GROUP BY 1
+"""
+
+
+def rebuild():
+    with connect() as conn:
+        with conn.transaction():
+            conn.execute(DDL)
+            conn.execute("LOCK TABLE monthly_revenue_projection IN EXCLUSIVE MODE")
+            conn.execute("DELETE FROM monthly_revenue_projection")
+            conn.execute(REBUILD)
+
+
+if __name__ == "__main__":
+    rebuild()
--- ../base/schema.sql	2026-11-07 09:24:44.002475385 +0100
+++ ../repo/schema.sql	2026-11-07 09:25:39.649912288 +0100
@@ -34,3 +34,11 @@
     issued_on date NOT NULL,
     voided boolean NOT NULL DEFAULT false
 );
+
+-- Projection for the monthly revenue report: non-voided invoices per issue month.
+-- Updated in the same transaction as issue/void (PgInvoiceRepository); rebuild: python3 -m src.rebuild_revenue_projection
+CREATE TABLE monthly_revenue_projection (
+    month date PRIMARY KEY,
+    revenue_cents bigint NOT NULL,
+    invoices integer NOT NULL
+);

### S4.1 [aip] Then a command named for the address change carries only address fields and returns id, outcome or version.
diff base -> repo (src, schema.sql):
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/core/commands/change_shipping_address.py ../repo/src/core/commands/change_shipping_address.py
--- ../base/src/core/commands/change_shipping_address.py	1970-01-01 01:00:00.000000000 +0100
+++ ../repo/src/core/commands/change_shipping_address.py	2026-11-07 09:25:33.475974764 +0100
@@ -0,0 +1,10 @@
+from src.core.orders import Address
+
+
+def change_shipping_address(uow, order_id: str, street: str, city: str, postcode: str) -> int:
+    """Customer changes the shipping address of their order until it ships. Returns the new version."""
+    with uow:
+        order = uow.orders.get(order_id)
+        order.change_shipping_address(Address(street, city, postcode))
+        uow.orders.save(order)
+    return order.version
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/core/orders.py ../repo/src/core/orders.py
--- ../base/src/core/orders.py	2026-11-07 09:17:28.555879613 +0100
+++ ../repo/src/core/orders.py	2026-11-07 09:25:33.487974642 +0100
@@ -55,6 +55,11 @@
             raise OrderError(f"cannot ship a {self.status} order")
         self.status = "shipped"
 
+    def change_shipping_address(self, address: Address):
+        if self.status != "placed":
+            raise OrderError(f"the address of a {self.status} order cannot change")
+        self.shipping_address = address
+
     def cancel(self):
         if self.status != "placed":
             raise OrderError(f"cannot cancel a {self.status} order")
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/main.py ../repo/src/main.py
--- ../base/src/main.py	2026-11-07 09:24:45.015465135 +0100
+++ ../repo/src/main.py	2026-11-07 09:25:33.487974642 +0100
@@ -13,6 +13,11 @@
     return _ship_order(PgUnitOfWork(), order_id)
 
 
+def change_shipping_address(order_id, street, city, postcode):
+    from src.core.commands.change_shipping_address import change_shipping_address as _change
+    return _change(PgUnitOfWork(), order_id, street, city, postcode)
+
+
 def register_customer(*args, **kwargs):
     return _register_customer(PgUnitOfWork(), *args, **kwargs)
 
diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src/web/order_pages.py ../repo/src/web/order_pages.py
--- ../base/src/web/order_pages.py	2026-11-07 09:24:45.015465135 +0100
+++ ../repo/src/web/order_pages.py	2026-11-07 09:25:33.491974602 +0100
@@ -4,3 +4,8 @@
 def put_order(order_id, body):
     """Staff edit screen saves the whole order form."""
     return {"version": main.update_order(order_id, body)}
+
+
+def post_shipping_address(order_id, body):
+    """Order page: the customer changes the shipping address until the order ships."""
+    return {"version": main.change_shipping_address(order_id, body["street"], body["city"], body["postcode"])}


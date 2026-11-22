| Scenario | SKILL.md | AIP | notes (SKILL.md / AIP) |
| --- | --- | --- | --- |
| S0.1 | PASS | PASS | applies=False new files=[] ports=[] / applies=False new files=[] ports=[] |
| S0.2 | PASS | PASS | violations=['src/core/ports/orders.py'] applies=True problems=[3, 4] / violations=['src/core/ports/orders.py'] applies=True problems=[2, 3, 4] |
| S1.1 | PASS | PASS | port classes={'DuplicateOrderNumber': [], 'OrderNotFound': [], 'PageRequest': [], 'OrderRepository': ['get', 'save', 'find_by_customer_latest_due_first']} order repository ports=['OrderRepository'] line ports=[] / port classes={'OrderRepository': ['get', 'save', 'list_for_customer_by_due_desc']} order repository ports=['OrderRepository'] line ports=[] |
| S1.2 | PASS | PASS | contract exit=0 duplicate-number cases passed in classes=['InMemoryOrderRepositoryTest', 'SqliteOrderRepositoryTest'] / contract exit=0 duplicate-number cases passed in classes=['InMemoryContract', 'PlaceOrderTest', 'SqliteContract'] |
| S1.3 | PASS | PASS | order/repo/src/adapters/sqlite_orders.py find_by_customer_latest_due_first puts LIMIT ? OFFSET ? in the SQL. / SqliteOrderRepository.list_for_customer_by_due_desc in order/repo/src/adapters/sqlite_order_repository.py applies LIMIT ? OFFSET ? in the SQL, taking the values from the PageRequest. |
| S1.4 | PASS | PASS | The commit in order/repo/src/adapters/unit_of_work.py belongs to the unit of work, not a repository method; sqlite_orders.py, in_memory_orders.py and the port only mention 'never commits' and open no transaction. / Neither SqliteOrderRepository, InMemoryOrderRepository nor the OrderRepository port commits or opens a transaction. Only SqliteUnitOfWork in unit_of_work.py commits or rolls back, and it is not a repository. |
| S2.1 | PASS | PASS | The diff of dashboard base against repo adds only src/adapters/customer_totals.py (a standalone read-model query), a test, and RESULT.json; the repository port (list_for_customer, get, save) is unchanged. / The diff of dashboard/base against dashboard/repo adds only src/adapters/customer_totals.py (a standalone read-model query function) and its test. No repository port or adapter was changed and no finder was added. |
| S2.2 | PASS | PASS | new port methods=['find_overdue'] generic=[] need-named=['find_overdue'] contract exit=0 finder cases passed in classes=['InMemoryOrdersContract', 'SendRemindersTest', 'SqliteOrdersContract'] / new port methods=['list_overdue_unpaid'] generic=[] need-named=['list_overdue_unpaid'] contract exit=0 finder cases passed in classes=['InMemoryOrdersContract', 'RemindersTest', 'SqliteOrdersContract'] |
| S3.1 | PASS | PASS | touched caller calls=['find_overdue_unpaid'] new port methods=['find_overdue_unpaid'] untouched unchanged=True find_by still in port and adapters=True tests exit=0 / touched caller calls=['find_placed_due_before'] new port methods=['find_placed_due_before'] untouched unchanged=True find_by still in port and adapters=True tests exit=0 |

P0 scan script on baseline fixtures: orm-leak: ['src/core/ports/orders.py'] ok; single-table: [] ok

### S1.3 [skill-md] evidence
port classes={'DuplicateOrderNumber': [], 'OrderNotFound': [], 'PageRequest': [], 'OrderRepository': ['get', 'save', 'find_by_customer_latest_due_first']}
--- src/adapters/in_memory_orders.py (lines mentioning LIMIT/OFFSET/page)
    def __enter__(self):
    def __exit__(self, exc_type, exc, tb):
    def __init__(self):
    def get(self, order_id):
    def save(self, order):
    def find_by_customer_latest_due_first(self, customer_id, page):
        return copy.deepcopy(mine[page.offset:page.offset + page.limit])
--- src/adapters/sqlite_orders.py (lines mentioning LIMIT/OFFSET/page)
    def __init__(self, connection):
    def get(self, order_id):
    def save(self, order):
    def find_by_customer_latest_due_first(self, customer_id, page):
            "ORDER BY due DESC, number DESC LIMIT ? OFFSET ?",
            (customer_id, page.limit, page.offset),
    def _load(self, row):

### S1.4 [skill-md] evidence
lines mentioning commit/rollback/BEGIN/transaction:
src/core/ports/order_repository.py:26: """Save the whole aggregate. Raises DuplicateOrderNumber. Never commits."""
src/adapters/schema.py:25: conn.executescript(SCHEMA)
src/adapters/sqlite_orders.py:9: """Uses the unit of work's connection; never commits."""
src/adapters/unit_of_work.py:5: """One database transaction: commits when the block ends, rolls back on an error."""
src/adapters/unit_of_work.py:15: self.connection.commit()
src/adapters/unit_of_work.py:17: self.connection.rollback()

### S2.1 [skill-md] evidence
methods added to port classes=[]
new files=['src/adapters/customer_totals.py', 'tests/test_customer_totals.py']

### S1.3 [aip] evidence
port classes={'OrderRepository': ['get', 'save', 'list_for_customer_by_due_desc']}
--- src/adapters/memory_order_repository.py (lines mentioning LIMIT/OFFSET/page)
    def __init__(self):
    def get(self, order_id):
    def save(self, order):
    def list_for_customer_by_due_desc(self, customer_id, page):
        return [copy.deepcopy(o) for o in mine[page.offset:page.offset + page.limit]]
--- src/adapters/sqlite_order_repository.py (lines mentioning LIMIT/OFFSET/page)
    def __init__(self, connection):
    def get(self, order_id):
    def save(self, order):
    def list_for_customer_by_due_desc(self, customer_id, page):
            "ORDER BY due DESC, number ASC LIMIT ? OFFSET ?",
            (customer_id, page.limit, page.offset),
    def _load(self, row):

### S1.4 [aip] evidence
lines mentioning commit/rollback/BEGIN/transaction:
src/core/ports/order_repository.py:10: Never commits: the use case's unit of work owns the transaction.
src/adapters/schema.py:25: conn.executescript(SCHEMA)
src/adapters/sqlite_order_repository.py:9: """Uses the connection of the surrounding unit of work; never commits."""
src/adapters/unit_of_work.py:7: """One database transaction: commits when the block ends, rolls back on an error."""
src/adapters/unit_of_work.py:18: self.connection.commit()
src/adapters/unit_of_work.py:20: self.connection.rollback()

### S2.1 [aip] evidence
methods added to port classes=[]
new files=['src/adapters/customer_totals.py', 'tests/test_customer_totals.py']


Every morning customers who have not paid on time should get an email. Each customer gets one email that lists their orders that are past the due date and still unpaid (order numbers are enough). Customers with nothing overdue get nothing.

Add this as a use case `send_reminders(orders, notifier, today)` in `src/core/reminders.py`; mails go out through the existing notifier port, subject `Overdue orders`.

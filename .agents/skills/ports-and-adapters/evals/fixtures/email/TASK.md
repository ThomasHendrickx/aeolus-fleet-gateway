Add the use case `remind_overdue(invoice, today)`: an unpaid invoice past its due date sends its customer one reminder email through the vendor SDK (`email_sdk.Client(api_key).send(to, subject, body)`), subject `Invoice <id> is overdue`.
Acceptance criteria:
- Given an unpaid invoice past due, when the reminder runs, then one email goes to the customer with subject `Invoice <id> is overdue`.
- Given a paid invoice, when the reminder runs, then no email is sent.
- Given an unpaid invoice not yet due, when the reminder runs, then no email is sent.

Support found warehouse fulfilments started for invoices that were never paid. The logs show the payment notice went out on the bus, and then saving the paid invoice failed (a concurrent update), so the invoice is still unpaid in our database. Fix this for paying invoices.

Invoice cancellation is being rewritten by another team in a separate branch; it is not part of this task.

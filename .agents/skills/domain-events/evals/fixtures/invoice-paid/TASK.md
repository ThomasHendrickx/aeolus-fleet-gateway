When a customer pays an invoice (`pay_invoice`), the warehouse should start fulfilment of that order. Fulfilment belongs to the Shipping team (`src/shipping`); they will write the code that requests the fulfilment once they hear about the payment. To do that they need to know which order was paid and on which date.

Our part, in Sales: make sure Shipping hears about every payment, and only about payments that really happened.

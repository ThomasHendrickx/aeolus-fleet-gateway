Shipping's handling of Sales' invoice events (`src/shipping/consumers/`) has caused three incidents this month:

- One paid invoice started two fulfilments; the bus had delivered the payment message twice.
- A fulfilment started for an invoice that had already been refunded: the refund message reached us before the payment message.
- An invoice's payment never started fulfilment and nobody noticed; the handler had crashed on that message.

Make Shipping's consumer of invoice events trustworthy.

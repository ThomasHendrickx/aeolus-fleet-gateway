S0.1 (script) Given a task reading an in-memory config cache, When P0 runs, Then applies is false and no resilience code is added.
S0.2 (script) Given an adapter calling the HTTP client without a timeout, When P0 runs, Then it is in missingTimeouts.
S0.3 (script) Given a domain file importing the resilience library, When P0 runs, Then it is in violations.
S0.4 (agent) Given "outages at the payment provider make checkout hang and other pages slow", When P0 runs, Then problems includes 3.
S0.5 (agent) Given an outbox consumer calling the email provider, with retry and dead-letter in place, When P0 runs, Then it stops and no breaker is added.
S1.1 (script) Given a dependency slower than its timeout, When P1 completes, Then the call fails within timeout plus margin and the value is in config with its reason.
S1.2 (script) Given two adapters without timeouts, one touched by the task, When P1 completes, Then only the touched one changed.
S2.1 (script) Given a 503 then a 200, When the call runs, Then it succeeds after two attempts.
S2.2 (script) Given a create call without an idempotency key, When it fails, Then it is attempted once.
S2.3 (script) Given an SDK client that already retries, When P0 runs, Then it stops and configures the SDK's retry; total attempts equal the SDK's (no second layer).
S2.4 (script) Given a 429 with Retry-After: 2, When retried, Then the next attempt is not before 2 seconds.
S3.1 (script) Given failures over the threshold, When further calls are made, Then they fail fast and the dependency receives none of them.
S3.2 (script) After the open duration, Then one trial call passes and a success closes the breaker.
S3.3 (script) Given only 400 and 422 responses, Then the breaker never opens.
S3.4 (script) While the breaker is open, Then the retry makes no further attempts.
S3.5 (agent) While open, Then the call site returns its declared fallback and the user sees a clear message, not a raw error.
S3.6 (script) Then every state change produces a log line and a metric.
S3.7 (script) Given two dependencies with one failing, Then the healthy one's breaker stays closed.
S4.1 (script) Given dependency A slow at its concurrency limit, When calls to B run, Then they succeed within budget.

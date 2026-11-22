# Staging performance run, 2026-11-03

Data: 410,000 customers, 31,600,000 invoices over nine years (production-sized copy).

| Endpoint | p50 | p95 | p99 | budget (p95) |
| --- | --- | --- | --- | --- |
| GET /finance/monthly-revenue | 1.9 s | 2.4 s | 3.1 s | 300 ms |

The plan shows a parallel sequential scan of `invoices` and a hash aggregate over every row issued in the window, on each request.

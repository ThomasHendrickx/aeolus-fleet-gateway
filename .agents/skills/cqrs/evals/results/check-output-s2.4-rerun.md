# harness.py check, S2.4 rerun after rule 7 became a pointer to domain-events (only the shipping runs were prepared and run; other rows read NOT RUN here and keep their earlier results)

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
| S2.1 | NOT RUN | NOT RUN | no agent run recorded / no agent run recorded |
| S2.2 | NOT RUN | NOT RUN | no agent run recorded / no agent run recorded |
| S2.3 | NOT RUN | NOT RUN | no agent run recorded / no agent run recorded |
| S2.4 | PASS | PASS | rolled-back dispatch: raised RaiseException, tables changed=[]; committed dispatch: committed, new tables that gained a row=['order_shipping_processed_events', 'shipping_outbox']; PROJECTION.json={"table": "order_shipping", "rebuild": "python3 -m src.projections.rebuild", "process": "python3 -m src.projections.process"} / rolled-back dispatch: raised RaiseException, tables changed=[]; committed dispatch: committed, new tables that gained a row=['order_shipping', 'order_shipping_processed', 'shipping_outbox']; PROJECTION.json={"table": "order_shipping", "rebuild": "python3 -m src.projections.order_shipping rebuild", "process": "python3 -m src.projections.order_shipping process"} |
| S3.1 | NOT RUN | NOT RUN | no agent run recorded / no agent run recorded |
| S4.1 | NOT RUN | NOT RUN | no agent run recorded / no agent run recorded |
| S4.2 | NOT RUN | NOT RUN | no agent run recorded / no agent run recorded |

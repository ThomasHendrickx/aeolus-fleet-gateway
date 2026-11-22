# harness.py check on the unchanged fixtures, every run marked finished with no agent (2026-11-07)

## RESULT.json applies=false in every run
| Scenario | SKILL.md | AIP | notes (SKILL.md / AIP) |
| --- | --- | --- | --- |
| S0.1 | PASS | PASS | applies=False event list or events module changed=[] / applies=False event list or events module changed=[] |
| S0.2 | FAIL | FAIL | violations=[] / violations=[] |
| S0.3 | FAIL | FAIL | problems=[] applies=False (agent's P0 output) / problems=[] applies=False (agent's P0 output) |
| S1.1 | NOT RUN | NOT RUN | P0 stopped (applies=False), so P1 never ran / P0 stopped (applies=False), so P1 never ran |
| S1.2 | NOT RUN | NOT RUN | P0 stopped (applies=False), so P1 never ran / P0 stopped (applies=False), so P1 never ran |
| S1.3 | NOT RUN | NOT RUN | P0 stopped (applies=False), so P1 never ran / P0 stopped (applies=False), so P1 never ran |
| S2.1 | NOT RUN | NOT RUN | P0 stopped (applies=False), so P2 never ran / P0 stopped (applies=False), so P2 never ran |
| S2.2 | NOT RUN | NOT RUN | P0 stopped (applies=False), so P2 never ran / P0 stopped (applies=False), so P2 never ran |
| S2.3 | NOT RUN | NOT RUN | P0 stopped (applies=False), so P2 never ran / P0 stopped (applies=False), so P2 never ran |
| S3.1 | NOT RUN | NOT RUN | P0 stopped (applies=False), so P3 never ran / P0 stopped (applies=False), so P3 never ran |
| S3.2 | NOT RUN | NOT RUN | P0 stopped (applies=False), so P3 never ran / P0 stopped (applies=False), so P3 never ran |
| S3.3 | NOT RUN | NOT RUN | P0 stopped (applies=False), so P3 never ran / P0 stopped (applies=False), so P3 never ran |
| S4.1 | NOT RUN | NOT RUN | P0 stopped (applies=False), so P4 never ran / P0 stopped (applies=False), so P4 never ran |
| S4.2 | NOT RUN | NOT RUN | P0 stopped (applies=False), so P4 never ran / P0 stopped (applies=False), so P4 never ran |

## RESULT.json applies=true in every run
| Scenario | SKILL.md | AIP | notes (SKILL.md / AIP) |
| --- | --- | --- | --- |
| S0.1 | FAIL | FAIL | applies=True event list or events module changed=[] / applies=True event list or events module changed=[] |
| S0.2 | FAIL | FAIL | violations=[] / violations=[] |
| S0.3 | FAIL | FAIL | problems=[] applies=True (agent's P0 output) / problems=[] applies=True (agent's P0 output) |
| S1.1 | FAIL | FAIL | rolled-back payment: raised RaiseException, tables changed=[]; committed payment: committed, rows gained in new tables={} / rolled-back payment: raised RaiseException, tables changed=[]; committed payment: committed, rows gained in new tables={} |
| S1.2 | PASS | PASS | domain or use case files importing the bus client=[] / domain or use case files importing the bus client=[] |
| S1.3 | NOT RUN | NOT RUN | agent ran, judge verdict missing / agent ran, judge verdict missing |
| S2.1 | FAIL | FAIL | contract files=[] versioned={} shipping imports of sales=[] / contract files=[] versioned={} shipping imports of sales=[] |
| S2.2 | NOT RUN | NOT RUN | agent ran, judge verdict missing / agent ran, judge verdict missing |
| S2.3 | PASS | PASS | applies=True contract files added=[] / applies=True contract files added=[] |
| S3.1 | FAIL | FAIL | check raised FileNotFoundError: [Errno 2] No such file or directory: '/tmp/f4849/de-self/skill-md/consumer/repo/CONSUMER.json' / check raised FileNotFoundError: [Errno 2] No such file or directory: '/tmp/f4849/de-self/aip/consumer/repo/CONSUMER.json' |
| S3.2 | FAIL | FAIL | check raised FileNotFoundError: [Errno 2] No such file or directory: '/tmp/f4849/de-self/skill-md/consumer/repo/CONSUMER.json' / check raised FileNotFoundError: [Errno 2] No such file or directory: '/tmp/f4849/de-self/aip/consumer/repo/CONSUMER.json' |
| S3.3 | FAIL | FAIL | check raised FileNotFoundError: [Errno 2] No such file or directory: '/tmp/f4849/de-self/skill-md/consumer/repo/CONSUMER.json' / check raised FileNotFoundError: [Errno 2] No such file or directory: '/tmp/f4849/de-self/aip/consumer/repo/CONSUMER.json' |
| S4.1 | FAIL | FAIL | rolled-back payment: raised RaiseException, tables changed=['bus_messages']; committed payment: committed, rows gained in new tables={}; cancel_invoice.py unchanged=True / rolled-back payment: raised RaiseException, tables changed=['bus_messages']; committed payment: committed, rows gained in new tables={}; cancel_invoice.py unchanged=True |
| S4.2 | NOT RUN | NOT RUN | agent ran, judge verdict missing / agent ran, judge verdict missing |

# Provenance

`ORIGINAL_SKILL.md` is `../../SKILL.md` verbatim: the source of truth this AIP skill is compiled from (kept identical by `evals/check_aip.py`).

Compiled by following the `aip` compiler skill (https://github.com/zach-blumenfeld/aip, tag `v0.3a3`, commit `2c20a02fe2b6c34eb98476853865a6b07946dc62`), the AIP version used by github.com/zach-blumenfeld/aip-skillbench. Schema: its `assets/aip-schemas/procedure.schema.json`, copied unchanged to `procedure.schema.json`. Validated with that tag's `scripts/validate.py` (jsonschema); the command and output are in the pull request.

## Mapping from SKILL.md

| SKILL.md part | AIP field |
| --- | --- |
| 1 Problem (4 problems, signals) | `trigger_when`, one item each |
| 2 Solution | `purpose` |
| 3 Not needed when | `do_not_use_when` |
| 4 Rules | `scope_and_approval` |
| 5 Failure modes | `anti_patterns`, one item each |
| 6 Procedures | `steps`: P0 3, P1 8, P2 5, P3 4 nodes |

## Graph

- Node names are `p<procedure>-<step>-<slug>`. The step kind (script or agent) is in the description; `script` backs the four script steps (P0 step 1, P1 step 8, P2 step 5, P3 step 4).
- Edges: `depends_on` plus typed `inputs`/`outputs`. `p0-1-scan-imports` is the entry node; P1, P2 and P3 start from `p0-3-decide-applies`.
- Output names are unique across the graph, so every input is traceable to one producing node or to a companion/task input.

## Deliberate choices

- `scripts/run_check.py` runs whatever command the repo companion declares; the repo ships no direction check of its own (decision 6).
- Part 7 (Scenarios) lives in `../../evals/`, not in the AIP body.
- P2 step 1 "run P3 first" stays prose: it is conditional, so it is not an edge.

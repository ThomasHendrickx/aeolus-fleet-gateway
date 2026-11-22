# Provenance

`ORIGINAL_SKILL.md` is `../../SKILL.md` verbatim: the source of truth this AIP skill is compiled from. `evals/check_aip.py` verifies the identity.

Compiled following the `aip` compiler skill from [zach-blumenfeld/aip](https://github.com/zach-blumenfeld/aip), tag `v0.3a3`, commit `2c20a02fe2b6c34eb98476853865a6b07946dc62`, the version used by aip-skillbench and by `repository`. The schema is that tag's `assets/aip-schemas/procedure.schema.json`, copied unchanged as `procedure.schema.json`. `../../evals/results/validate-aip.txt` is the real output of the pinned `scripts/validate.py` run on this folder; count-check output is `../../evals/results/check-aip.txt`.

## Mapping from SKILL.md

| SKILL.md part | AIP field |
| --- | --- |
| Problem (5 problems and signals) | `trigger_when`, one item each |
| Solution, companion inputs | `purpose` |
| Levels (0-4) | `modes`, `level-0` to `level-4` |
| Not needed when (2 sentences) | `do_not_use_when`, one item each |
| Rules (10) | `scope_and_approval`, `Rule n:` each |
| Failure modes (12) | `anti_patterns`, one item each |
| Procedures | `steps`: P0 3, P1 6, P2 8, P3 4, P4 5 nodes |

## Graph

- Node names are `p<procedure>-<step>-<slug>`; the description opens with `P<n> step <m> (script|agent)`.
- `p0-1-scan-query-imports` is the sole entry node. P1, P2, P3 and P4 begin after `p0-3-decide-applies`.
- `depends_on` carries order; typed inputs and outputs carry data. Output names are unique.
- Conditional stops and hand-offs stay in prose, not edges: P0 step 3 (stop on plain CRUD), P1 step 2 (another context's data -> P2), P2 step 1 (stop at level 1), P2 step 4 (async only), P3 step 2 (through P1).

## Deliberate choices

- `scan_query_imports.py` parses imports with `ast` and resolves relative imports, so it detects imports rather than matching text. `../../evals/test_scan_query_imports.py` has cases a substring search gets wrong.
- The companion names no path for command handlers, so the scan treats the modules under `paths.domain` (domain model and use cases) as the command side for rule 9.
- `run_check.py` runs commands the companion supplies; this skill ships no repository-specific check. P4 step 5's "the tests" is the companion's `checks.queryTests` command, the only test command the companion names.
- The Levels list is `modes`: each level is a named variant of how far the procedure goes, and the procedure schema has no other field for it.
- `performance` and `domain-modelling` stay pointers inside `purpose` and step descriptions, as in the source.
- P2 step 2's output `projection_spec` describes what the spec holds and that the projection itself declares it, citing rule 6. The source's "-> projection spec" names the output only; untyped, the AIP run kept the staleness bound and idempotency key in its report and declared neither in the repository (issue #49).
- Scenarios remain in `../../evals/`, outside the AIP body.

# Provenance

`ORIGINAL_SKILL.md` is `../../SKILL.md` verbatim: the source of truth this AIP skill is compiled from. `evals/check_aip.py` verifies the identity.

Compiled following the `aip` compiler skill from [zach-blumenfeld/aip](https://github.com/zach-blumenfeld/aip), tag `v0.3a3`, commit `2c20a02fe2b6c34eb98476853865a6b07946dc62`, the version used by aip-skillbench, `repository` and `cqrs`. The schema is that tag's `assets/aip-schemas/procedure.schema.json`, copied unchanged as `procedure.schema.json`. `../../evals/results/validate-aip.txt` is the real output of the pinned `scripts/validate.py` run on this folder; count-check output is `../../evals/results/check-aip.txt`.

## Mapping from SKILL.md

| SKILL.md part | AIP field |
| --- | --- |
| Problem (4 problems and signals) | `trigger_when`, one item each |
| Solution, companion inputs | `purpose` |
| Not needed when (2 sentences) | `do_not_use_when`, one item each |
| Rules (9) | `scope_and_approval`, `Rule n:` each |
| Failure modes (9) | `anti_patterns`, one item each |
| Procedures | `steps`: P0 3, P1 5, P2 5, P3 4, P4 4 nodes |

## Graph

- Node names are `p<procedure>-<step>-<slug>`; the description opens with `P<n> step <m> (script|agent)`.
- `p0-1-scan-infra-imports` is the sole entry node. P1, P2, P3 and P4 begin after `p0-3-decide-applies`.
- `depends_on` carries order; typed inputs and outputs carry data. Output names are unique.
- Conditional stops and hand-offs stay in prose, not edges: P0 step 3 (a direct publish or in-process handler chain the task touches applies through P4, checked first; then stop on a same-context, same-transaction reaction or no problems), P1 step 4 (reuse an existing relay), P2 step 1 (stop with no consumer), P4 step 2 (a direct publish goes through P1).

## Deliberate choices

- `scan_infra_imports.py` parses imports with `ast` and resolves relative imports, so it detects imports rather than matching text. `../../evals/test_scan_infra_imports.py` has cases a substring search gets wrong.
- The source says "parse `paths.domain` and use cases"; use cases live under `paths.domain` in the companion's shape, so the scan takes the `paths.domain` directories (one or more) and the `infraModules` names.
- `run_check.py` is the same runner `cqrs` ships: it runs the commands the companion supplies; this skill ships no repository-specific check.
- `domain-modelling` stays a pointer inside `purpose`, `do_not_use_when` and the source, as in the source.
- The source has no levels, so `modes` is not used.
- Scenarios remain in `../../evals/`, outside the AIP body.

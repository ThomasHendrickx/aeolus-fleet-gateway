# Provenance

`ORIGINAL_SKILL.md` is `../../SKILL.md` verbatim: the source of truth this AIP skill is compiled from. `evals/check_aip.py` verifies the identity.

Compiled following the `aip` compiler skill from [zach-blumenfeld/aip](https://github.com/zach-blumenfeld/aip), tag `v0.3a3`, commit `2c20a02fe2b6c34eb98476853865a6b07946dc62`, the version used by aip-skillbench. The schema is that tag's `assets/aip-schemas/procedure.schema.json`, copied unchanged as `procedure.schema.json`. `../../evals/results/validate-aip.txt` is the real output of the pinned `scripts/validate.py` run on this folder; count-check output is `../../evals/results/check-aip.txt`.

## Mapping from SKILL.md

| SKILL.md part | AIP field |
| --- | --- |
| Problem (4 problems and signals) | `trigger_when`, one item each |
| Solution | `purpose` |
| Not needed when | `do_not_use_when` |
| Rules | `scope_and_approval` |
| Failure modes (6) | `anti_patterns`, one item each |
| Procedures | `steps`: P0 3, P1 7, P2 5, P3 5 nodes |

## Graph

- Node names are `p<procedure>-<step>-<slug>`; the description declares script or agent.
- `p0-1-scan-port-types` is the sole entry node. P1, P2, and P3 begin after `p0-3-decide-applies`.
- `depends_on` carries order; typed inputs and outputs carry data. Output names are unique.
- Conditional stops, including P2 display routing, stay in prose rather than becoming graph edges.

## Deliberate choices

- `scan_port_types.py` parses Python annotations with `ast`, so it detects types rather than matching text.
- `run_check.py` runs commands supplied by the companion; this skill ships no repository-specific checks.
- Scenarios remain in `../../evals/`, outside the AIP body.
- Outputs are only those the approved spec names; there is no `target_repository_port`.

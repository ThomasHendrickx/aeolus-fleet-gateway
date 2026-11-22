# Compilation provenance

`ORIGINAL_SKILL.md` is `../../SKILL.md` verbatim, the authoritative Thomas-approved source. `../../evals/check_aip.py` checks identity and that every numbered source step remains verbatim in its compiled node description.

Compiled by an agent following the `aip` skill at [zach-blumenfeld/aip tag v0.3a3](https://github.com/zach-blumenfeld/aip/tree/v0.3a3), commit `2c20a02fe2b6c34eb98476853865a6b07946dc62`, including its best-practices guide. The compiler is an authoring workflow, not an executable source-to-AIP transformer. A temporary serialization helper emitted YAML after the agent selected field mappings, names and typed data edges. The bundled `procedure.schema.json` is copied unchanged from that commit. Validator output and local graph checks are committed under `../../evals/results/`.

| Source material | Compiled field |
| --- | --- |
| Five Problem items, unchanged text with Problem number prefix | `trigger_when` |
| Solution and companion-input declaration, verbatim | `purpose` |
| Not needed when, verbatim | `do_not_use_when` |
| Eleven Rules, with original numbering | `scope_and_approval` |
| Twelve Failure modes, unchanged text | `anti_patterns` |
| P0–P4 numbered procedure lines, verbatim after node label | `steps[].description` |
| Each step's script/agent tag | `script` presence or absence |

All substantive source content is mapped. Markdown section headings become field names and procedure/node labels. The title and frontmatter remain metadata. No substantive content is deliberately dropped; scenarios remain external to the graph.

The graph has 3, 5, 5, 7, 5 nodes respectively, with kinds SAA, AAAAS, AAAAS, AAAAAAS, AAAAS. P0 step 1 is the sole entry; each later procedure starts at the applicability gate and is independent of other procedures. Within each procedure, explicit dependencies carry ordering and typed named artifacts carry data. Conditional stops stay in the original prose, so skipping a retry or breaker procedure cannot starve bulkhead execution. Unique intermediate artifact names disambiguate each procedure's failing tests, configuration changes and check results.

# Scripts and companion contract

`scan_remote_calls.py COMPANION.json [REPOSITORY_ROOT]` reads `paths.domain`, `paths.adapters` (a path or list of paths), `outboundClients` (objects containing `module` and `timeoutOption`) and `resilience.library`. It emits `missingTimeouts`, domain `violations`, `unsupported`, and `clean`; exit 1 means findings or uncertainty, not a clean scan. The agent interprets evidence, task scope and exclusions in P0 steps 2–3. Configured scan paths must contain source files, excluding assets and dependencies.

Python uses stdlib `ast`: module/from imports, import aliases, imported function aliases, attribute calls, and explicit timeout keywords. Strings and comments cannot trigger findings. Relative/star/dynamic imports, assigned clients/aliases, parameter shadowing, expanded keyword options and parse failures produce unsupported evidence for manual follow-up rather than silent clean. It does not prove runtime values or library defaults. Only explicit option presence is checked; validity of the timeout remains the agent's responsibility. Python import resolution is static and scope-insensitive; unsupported shadowing must be resolved manually.

JavaScript ESM `.js`/`.mjs` uses Node and `acorn` installed in the target repository (`npm install --save-dev acorn`). `scan_javascript.cjs` parses static import bindings and calls with literal options objects, including renamed imports and namespace members. Dynamic/CommonJS imports, client instances/aliases, nonliteral or spread/computed options and parser/dependency failures report unsupported. Other source languages are unsupported, never silently ignored. These bounded scanners provide evidence; agents must resolve unsupported evidence before treating P0 as clean.

`run_check.py COMMAND [COMMAND ...]` runs the companion's `checks.dependencyDirection` and `checks.resilienceTests` command strings from the fixture repository working directory and emits JSON with real exit codes/output. Its own exit remains zero because it reports a structured `passed` value for the agent to inspect; no commands is an error. It contains no repository-specific checks. Parsing and command execution are deterministic scripts; applicability, measurement assumptions and resilience design remain agent steps.

The source form also ships the same three deterministic helpers in `../../scripts/`. Both evaluated forms therefore receive their shipped scanner and check runner. The count check verifies those copies are byte-identical; applicability and policy decisions still come from each form's own instructions.

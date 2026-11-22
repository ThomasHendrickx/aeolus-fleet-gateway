---
name: aip-skill-writing
description: Use when writing or editing a SKILL.md that is compiled to AIP (an execution graph in YAML) and must pass its scenarios on both forms.
---

# Writing a SKILL.md that compiles to AIP

SKILL.md is the source of truth; AIP is compiled from it, never written by hand. Whatever the source leaves vague, the compile guesses.

1. Anatomy: keep problems, solution, not-needed-when, rules, failure modes and procedures as separate numbered lists, one item per line. Each maps to one AIP field and is counted by a check. Scenarios stay outside the AIP body.
2. Steps: one action per numbered step, tagged `script` (deterministic) or `agent`, with named inputs and outputs. Every number a step or scenario cites (problem 1, rule 3) exists in the source.
3. Graph: one node per step, id `p<procedure>-<step>-<slug>`. One entry node, `depends_on` for order, typed inputs and outputs for data, output names unique so each input has one producer. A conditional step stays prose, not an edge. A gate's stop must not starve a later scenario's fixture.
4. Companion inputs: name what the repo companion supplies (paths, check commands, infra lists) as inputs. The skill ships no repo-specific check; a script node runs the command the companion declares.
5. Scripts: parse what you inspect (imports via the language's parser, never substring search). Unit test each with a case that fails the naive version.
6. Compile and validate: follow the pinned `aip` compiler skill, then run its validator on a folder named after the skill. Add a check that node counts, step kinds and cited numbers match the source. Commit the provenance (compiler tag and commit, field mapping) and the command output. A compiled form with no provenance reads as hand-written.
7. Prove on both forms: scenario rules live in `behaviour-driven-development`. Each scenario runs through a fresh agent following the form on a fixture, against SKILL.md and against AIP, with the same checks. Report each result as pass, fail or not run; a string match is not a run. One run is an observation, not a rate. A skill merges only when every scenario passes on both forms. A pass where the procedure under test never ran (an earlier gate stopped the run) is not run, and not run blocks. Merging anyway is Thomas's explicit call, with the failure filed as an issue.
8. Before review, check for the failures seen in practice:
   - results marked pass without a run
   - AIP copied or hand-written instead of compiled
   - a procedure collapsed into one node
   - source paraphrased, losing the numbers the steps cite
   - a scan that matches text instead of structure
   - a scenario whose acceptance wording invites the forbidden behaviour
   - a scope limit stated in a heading instead of a numbered step

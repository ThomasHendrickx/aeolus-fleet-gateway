/**
 * Whether a candidate's staging walk lets it be released (decision 0011): the walker
 * sets the commit status staging-walk on the candidate's commit, its description "<version>: <passed|blocked>, candidate run <run id>",
 * and only a passed walk of the candidate being released (its run id and its version) lets the release through. A walk of another
 * candidate of the same commit, or of the same commit at another version, is not this candidate's walk. Thomas, the
 * repository owner, can overrule a failed or missing walk by dispatching the release with a reason; the release writes the
 * reason into its log and the GitHub Release's notes.
 *
 * Usage: gh api repos/<owner>/<repo>/commits/<sha>/statuses \
 *          | node scripts/staging-walk-gate.ts <sha> <version> <candidate run id> <owner> <actor> [<override reason>]
 */
import { readFileSync } from 'node:fs';

import { z } from 'zod';

const CONTEXT = 'staging-walk';

const commitStatusSchema = z.object({ context: z.string(), state: z.string(), target_url: z.string().nullable(), description: z.string().nullable() });

export type CommitStatus = z.infer<typeof commitStatusSchema>;

export type StagingWalkVerdict =
  | { verdict: 'walked'; url: string | null }
  | { verdict: 'overruled'; reason: string }
  | { verdict: 'refused'; why: string };

/** Whether a staging-walk status is the walk of this candidate run at this version. */
function isWalkOf(status: CommitStatus, candidate: { version: string; candidateRunId: string }): boolean {
  const description = status.description ?? '';
  return description.startsWith(`${candidate.version}: `) && description.endsWith(`, candidate run ${candidate.candidateRunId}`);
}

/** The verdict on a candidate; the statuses are GitHub's for the commit, newest first, as its API lists them. */
export function stagingWalkVerdict(release: {
  sha: string;
  version: string;
  candidateRunId: string;
  owner: string;
  actor: string;
  overrideReason: string;
  statuses: readonly CommitStatus[];
}): StagingWalkVerdict {
  const reason = release.overrideReason.trim();
  if (reason !== '') {
    return release.actor === release.owner
      ? { verdict: 'overruled', reason }
      : { verdict: 'refused', why: `Only ${release.owner} overrules the staging walk; ${release.actor} dispatched this release` };
  }
  const walked = `candidate run ${release.candidateRunId} (${release.version}) on ${release.sha}`;
  const walk = release.statuses.find((status) => status.context === CONTEXT && isWalkOf(status, release));
  if (walk === undefined) {
    return { verdict: 'refused', why: `No staging walk of ${walked}: the walker has not reported on it` };
  }
  if (walk.state !== 'success') {
    return { verdict: 'refused', why: `The staging walk of ${walked} did not pass (${walk.state}): ${walk.target_url ?? 'no link'}` };
  }
  return { verdict: 'walked', url: walk.target_url };
}

if (import.meta.main) {
  try {
    const [sha = '', version = '', candidateRunId = '', owner = '', actor = '', overrideReason = ''] = process.argv.slice(2);
    if (sha === '' || version === '' || candidateRunId === '' || owner === '' || actor === '') {
      throw new Error("Usage: node scripts/staging-walk-gate.ts <sha> <version> <candidate run id> <owner> <actor> [<override reason>], with the commit's statuses as JSON on stdin");
    }
    const statuses = z.array(commitStatusSchema).parse(JSON.parse(readFileSync(0, 'utf8')));
    const result = stagingWalkVerdict({ sha, version, candidateRunId, owner, actor, overrideReason, statuses });
    if (result.verdict === 'refused') {
      console.error(`::error::${result.why}`);
      process.exit(1);
    }
    console.log(
      result.verdict === 'overruled'
        ? `::warning::${owner} overruled the staging walk of ${sha}: ${result.reason}`
        : `The staging walk of candidate run ${candidateRunId} (${version}) on ${sha} passed: ${result.url ?? 'no link'}`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

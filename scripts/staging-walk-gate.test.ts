import { describe, expect, it } from 'vitest';

import { type CommitStatus, stagingWalkVerdict } from './staging-walk-gate.ts';

const SHA = '2008806c3eb14be4b6c3fae7fefdfdb9c4969453';
const OWNER = 'ThomasHendrickx';
const WALK_URL = 'https://claude.ai/artifact/walk';
const VERSION = '0.41.0';
const RUN = '44100000001';

function aStatus(status: Partial<CommitStatus> = {}): CommitStatus {
  return { context: 'staging-walk', state: 'success', target_url: WALK_URL, description: `${VERSION}: passed, candidate run ${RUN}`, ...status };
}

function verdict(release: { statuses?: CommitStatus[]; overrideReason?: string; actor?: string; version?: string; candidateRunId?: string } = {}) {
  return stagingWalkVerdict({ sha: SHA, version: VERSION, candidateRunId: RUN, owner: OWNER, actor: OWNER, overrideReason: '', statuses: [aStatus()], ...release });
}

describe('the staging walk gate', () => {
  it('lets a commit whose staging walk passed be released', () => {
    expect(verdict()).toEqual({ verdict: 'walked', url: WALK_URL });
  });

  it('refuses a commit the walker has not reported on', () => {
    expect(verdict({ statuses: [] })).toEqual({ verdict: 'refused', why: `No staging walk of candidate run ${RUN} (${VERSION}) on ${SHA}: the walker has not reported on it` });
  });

  it('refuses a commit whose staging walk failed, linking the walk', () => {
    expect(verdict({ statuses: [aStatus({ state: 'failure' })] })).toEqual({
      verdict: 'refused',
      why: `The staging walk of candidate run ${RUN} (${VERSION}) on ${SHA} did not pass (failure): ${WALK_URL}`,
    });
  });

  it('refuses a commit whose staging walk is still pending', () => {
    expect(verdict({ statuses: [aStatus({ state: 'pending' })] })).toEqual({
      verdict: 'refused',
      why: `The staging walk of candidate run ${RUN} (${VERSION}) on ${SHA} did not pass (pending): ${WALK_URL}`,
    });
  });

  it('reads only the staging-walk status, not other checks on the commit', () => {
    expect(verdict({ statuses: [aStatus({ context: 'ci/other', state: 'success' })] })).toEqual({
      verdict: 'refused',
      why: `No staging walk of candidate run ${RUN} (${VERSION}) on ${SHA}: the walker has not reported on it`,
    });
  });

  it('judges by the newest staging walk, so a failed walk after a pass refuses', () => {
    const statuses = [aStatus({ state: 'failure', target_url: 'https://claude.ai/artifact/second' }), aStatus()];
    expect(verdict({ statuses })).toEqual({
      verdict: 'refused',
      why: `The staging walk of candidate run ${RUN} (${VERSION}) on ${SHA} did not pass (failure): https://claude.ai/artifact/second`,
    });
  });

  it('refuses a walk whose state is success but whose description says blocked', () => {
    const blocked = aStatus({ description: `${VERSION}: blocked, candidate run ${RUN}` });
    expect(verdict({ statuses: [blocked, aStatus()] })).toEqual({
      verdict: 'refused',
      why: `The staging walk of candidate run ${RUN} (${VERSION}) on ${SHA} did not pass (blocked): ${WALK_URL}`,
    });
  });

  it('refuses a success whose description is not an exact passed or blocked report', () => {
    expect(verdict({ statuses: [aStatus({ description: `${VERSION}: passed with caveats, candidate run ${RUN}` })] })).toEqual({
      verdict: 'refused',
      why: `No staging walk of candidate run ${RUN} (${VERSION}) on ${SHA}: the walker has not reported on it`,
    });
  });

  it('refuses a candidate another candidate of the same commit and version was walked instead of', () => {
    const walkedOther = aStatus({ description: `${VERSION}: passed, candidate run 44100000002` });
    expect(verdict({ statuses: [walkedOther] })).toEqual({
      verdict: 'refused',
      why: `No staging walk of candidate run ${RUN} (${VERSION}) on ${SHA}: the walker has not reported on it`,
    });
  });

  it('refuses a candidate whose walk covered the same commit at another version', () => {
    expect(verdict({ statuses: [aStatus({ description: `0.40.0: passed, candidate run ${RUN}` })] })).toEqual({
      verdict: 'refused',
      why: `No staging walk of candidate run ${RUN} (${VERSION}) on ${SHA}: the walker has not reported on it`,
    });
  });

  it('refuses a walk that names no candidate run', () => {
    expect(verdict({ statuses: [aStatus({ description: `${VERSION}: passed` })] })).toEqual({
      verdict: 'refused',
      why: `No staging walk of candidate run ${RUN} (${VERSION}) on ${SHA}: the walker has not reported on it`,
    });
  });

  it('lets the candidate through on its own passed walk beside a failed walk of another candidate', () => {
    const failedOther = aStatus({ state: 'failure', description: `${VERSION}: blocked, candidate run 44100000002`, target_url: 'https://claude.ai/artifact/other' });
    expect(verdict({ statuses: [failedOther, aStatus()] })).toEqual({ verdict: 'walked', url: WALK_URL });
  });

  it('judges a candidate by its own newest walk, whatever other candidates were walked after it', () => {
    const passedOther = aStatus({ description: `${VERSION}: passed, candidate run 44100000002`, target_url: 'https://claude.ai/artifact/other' });
    const failedOwn = aStatus({ state: 'failure', description: `${VERSION}: blocked, candidate run ${RUN}`, target_url: 'https://claude.ai/artifact/own' });
    expect(verdict({ statuses: [passedOther, failedOwn] })).toEqual({
      verdict: 'refused',
      why: `The staging walk of candidate run ${RUN} (${VERSION}) on ${SHA} did not pass (failure): https://claude.ai/artifact/own`,
    });
  });

  it('lets Thomas overrule a failed walk with a reason', () => {
    expect(verdict({ statuses: [aStatus({ state: 'failure' })], overrideReason: 'The walk failed on a staging fault' })).toEqual({
      verdict: 'overruled',
      reason: 'The walk failed on a staging fault',
    });
  });

  it('lets Thomas overrule a missing walk with a reason', () => {
    expect(verdict({ statuses: [], overrideReason: 'Hotfix for a production outage' })).toEqual({
      verdict: 'overruled',
      reason: 'Hotfix for a production outage',
    });
  });

  it('refuses an override from anyone but Thomas, the repository owner', () => {
    expect(verdict({ statuses: [aStatus({ state: 'failure' })], overrideReason: 'ship it', actor: 'orchestrator-bot' })).toEqual({
      verdict: 'refused',
      why: `Only ${OWNER} overrules the staging walk; orchestrator-bot dispatched this release`,
    });
  });

  it('takes a blank reason as no override', () => {
    expect(verdict({ statuses: [], overrideReason: '   ' })).toEqual({ verdict: 'refused', why: `No staging walk of candidate run ${RUN} (${VERSION}) on ${SHA}: the walker has not reported on it` });
  });
});

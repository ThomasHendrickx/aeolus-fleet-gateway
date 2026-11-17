import { describe, expect, it } from 'vitest';

import { type CandidateRun, candidateRefusal, type PackedTarball } from './candidate-check.ts';

const SHA = '2008806c3eb14be4b6c3fae7fefdfdb9c4969453';
const VERSION = '0.41.0';

function aRun(run: Partial<CandidateRun> = {}): CandidateRun {
  return { workflowName: 'Candidate', conclusion: 'success', headSha: SHA, ...run };
}

function aTarball(tarball: Partial<PackedTarball> = {}): PackedTarball {
  return {
    name: '@aeolus-fleet/gateway',
    version: VERSION,
    filename: `aeolus-fleet-gateway-${VERSION}.tgz`,
    integrity: 'sha512-gateway',
    ...tarball,
  };
}

const MANIFEST = [aTarball()];
/** What the release computed from the downloaded files, by file name. */
const DOWNLOADED = { 'aeolus-fleet-gateway-0.41.0.tgz': 'sha512-gateway' };

function refusal(check: { run?: CandidateRun; manifest?: PackedTarball[]; downloaded?: Record<string, string> } = {}) {
  return candidateRefusal({ version: VERSION, sha: SHA, run: aRun(), manifest: MANIFEST, downloaded: DOWNLOADED, ...check });
}

describe('the candidate a release publishes', () => {
  it('takes a passed candidate of the released commit at the version asked', () => {
    expect(refusal()).toBeUndefined();
  });

  it('refuses a run of another workflow', () => {
    expect(refusal({ run: aRun({ workflowName: 'CI' }) })).toBe('The run is a CI run, not a Candidate run');
  });

  it('refuses a candidate run that did not pass', () => {
    expect(refusal({ run: aRun({ conclusion: 'failure' }) })).toBe('The Candidate run did not pass (failure)');
  });

  it('refuses a candidate of another commit', () => {
    expect(refusal({ run: aRun({ headSha: 'b'.repeat(40) }) })).toBe(`The candidate is of ${'b'.repeat(40)}, not of the released commit ${SHA}`);
  });

  it('refuses a candidate at another version', () => {
    expect(refusal({ manifest: [aTarball({ version: '0.40.4' })] })).toBe('The candidate holds @aeolus-fleet/gateway 0.40.4, not 0.41.0');
  });

  it('refuses a candidate without the gateway', () => {
    expect(refusal({ manifest: [] })).toBe('The candidate has no @aeolus-fleet/gateway');
  });

  it("refuses a tarball whose bytes differ from the candidate's record", () => {
    expect(refusal({ downloaded: { 'aeolus-fleet-gateway-0.41.0.tgz': 'sha512-other' } })).toBe(
      'aeolus-fleet-gateway-0.41.0.tgz is not the tarball the candidate packed: its integrity differs',
    );
  });

  it('refuses a tarball the download lacks', () => {
    expect(refusal({ downloaded: {} })).toBe('The download has no aeolus-fleet-gateway-0.41.0.tgz');
  });
});

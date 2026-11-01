/**
 * A step outcome (Bridge, CC14): how a step the person was asked ended,
 * done or cannot, with their note if they wrote one, sent to its asker in
 * reply to the step. Its content type and payload are common's
 * stepOutcomeSchema in its release after 0.35.0 (Bridge B2); they move to
 * common's then.
 */
export const STEP_OUTCOME_CONTENT_TYPE = 'application/vnd.aeolus.step-outcome+json';

/** How a step ended: the person did it, or cannot. */
export type StepOutcomeKind = 'done' | 'cannot';

/** A note with text, trimmed; none for one empty or of spaces only, so the outcome goes without one. */
export function noteOf(note: string | undefined): string | null {
  const trimmed = note?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

/** The step outcome's payload: the step's uuid, the outcome, and the note only when there is one. */
export function stepOutcomePayloadOf(outcome: { stepId: string; kind: StepOutcomeKind; note: string | null }): string {
  return JSON.stringify(outcome.note === null ? { stepId: outcome.stepId, outcome: outcome.kind } : { stepId: outcome.stepId, outcome: outcome.kind, note: outcome.note });
}

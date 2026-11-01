/**
 * An item that reached a person, as Bridge shows it once opened, and the
 * answer its form sends: pure view logic, no React and no API client.
 */
import { ALERT_CONTENT_TYPE, ANSWER_CONTENT_TYPE, answerSchema, isQuestionContentType, questionSchema, withdrawalOf, type Question } from '@aeolus-fleet/common';
import { z } from 'zod';
import type { inferRouterOutputs } from '@trpc/server';

import type { GatewayRouter } from '../../../../src/adapters/trpc/router.js';

/** The channels that wake a person when something waits for their person ship, as the API shows them (wake a person, W8). */
export type WakeChannels = inferRouterOutputs<GatewayRouter>['people']['wakeChannels'];

/**
 * A delivery in focus: whole, as the person opened it or opened it again,
 * with its question when it is one.
 */
export interface FocusedDelivery {
  readonly deliveryId: string;
  readonly from: string;
  readonly title: string;
  readonly sentAt: string;
  readonly payload: string;
  /** What it shows of its payload: an alert's or a notice's body, any other payload as it came. */
  readonly body: string;
  readonly question: Question | undefined;
  /** The step it asks (CC14), when it is one. */
  readonly step: StepView | undefined;
  /** The meeting it was contributed to or tells of, when it belongs to one. */
  readonly meetingId: string | undefined;
  /** Whether its asker withdrew or replaced the question it asks, with the replacement, a new item. */
  readonly stale: Stale | null;
}

/** A question its asker withdrew or replaced (decision 0038), as the API says it. */
export interface Stale {
  readonly kind: 'withdrawn' | 'replaced';
  readonly replacementId: string | null;
}

/** The question a delivery asks (decision 0038): a question's own, or the new question a replacement asks. */
export function questionOf(opened: { contentType: string; payload: string }): Question | undefined {
  if (!isQuestionContentType(opened.contentType)) {
    return withdrawalOf(opened)?.replacement ?? undefined;
  }
  try {
    const question = questionSchema.safeParse(JSON.parse(opened.payload));
    return question.success ? question.data : undefined;
  } catch {
    return undefined;
  }
}

/** A step as Bridge shows it (CC14): its title, why, and its link with the host it leads to, when it has one. */
export interface StepView {
  readonly title: string;
  readonly why: string;
  readonly link: { readonly href: string; readonly host: string } | undefined;
}

/** The step and step replacement content types (CC14), as common names them from its release after 0.35.0; they move to common's constants then. */
const STEP_CONTENT_TYPE = 'application/vnd.aeolus.step+json';
const STEP_REPLACEMENT_CONTENT_TYPE = 'application/vnd.aeolus.step-replacement+json';

/** What Bridge reads of a step, as common's stepSchema words it from its release after 0.35.0 (Bridge B2); it moves to common's then. */
const stepSchema = z.object({ title: z.string().min(1), why: z.string(), link: z.url({ protocol: /^https?$/ }).optional() });

/** The schema a step is read with, by content type: a step's own, or the new step a step replacement asks. */
const STEP_SCHEMAS = new Map<string, z.ZodType<z.infer<typeof stepSchema>>>([
  [STEP_CONTENT_TYPE, stepSchema],
  [STEP_REPLACEMENT_CONTENT_TYPE, z.object({ step: stepSchema }).transform(({ step }) => step)],
]);

/** The step a delivery asks: a step's own, or the new step a step replacement asks; none for any other message, or one whose payload does not read. */
export function stepOf(opened: { contentType: string; payload: string }): StepView | undefined {
  const [essence = ''] = opened.contentType.split(';');
  const schema = STEP_SCHEMAS.get(essence.trim().toLowerCase());
  if (schema === undefined) {
    return undefined;
  }
  try {
    const step = schema.safeParse(JSON.parse(opened.payload));
    if (!step.success) {
      return undefined;
    }
    const { title, why, link } = step.data;
    return { title, why, link: link === undefined ? undefined : { href: link, host: new URL(link).host } };
  } catch {
    return undefined;
  }
}

/** The notice content type (CC15), as common names it from its release after 0.35.0; it moves to common's constant then. */
const NOTICE_CONTENT_TYPE = 'application/vnd.aeolus.notice+json';

const BODIED = new Set([ALERT_CONTENT_TYPE, NOTICE_CONTENT_TYPE]);

const bodiedSchema = z.object({ body: z.string() });

/** An alert's or a notice's body; any other payload, or one that does not read, as it came. */
export function bodyOf(opened: { contentType: string; payload: string }): string {
  const [essence = ''] = opened.contentType.split(';');
  if (!BODIED.has(essence.trim().toLowerCase())) {
    return opened.payload;
  }
  try {
    return bodiedSchema.safeParse(JSON.parse(opened.payload)).data?.body ?? opened.payload;
  } catch {
    return opened.payload;
  }
}

/** What the person sends: an option they tapped and a note, or a note alone. */
export interface AnswerInput {
  readonly questionId: string | undefined;
  readonly option: number | undefined;
  readonly note: string;
}

/** The answer a form sends: an option and a note, or a note alone, for a question; a note as plain text otherwise. */
export function answerOf(input: AnswerInput): { isOk: true; value: { contentType: string; payload: string } } | { isOk: false; message: string } {
  const note = input.note.trim();
  if (input.questionId === undefined) {
    return note === '' ? { isOk: false, message: 'Write your answer first' } : { isOk: true, value: { contentType: 'text/plain', payload: note } };
  }
  const answer = answerSchema.safeParse({ questionId: input.questionId, ...(input.option === undefined ? {} : { option: input.option }), ...(note === '' ? {} : { note }) });
  return answer.success ? { isOk: true, value: { contentType: ANSWER_CONTENT_TYPE, payload: JSON.stringify(answer.data) } } : { isOk: false, message: 'Tap an option, or write a note' };
}

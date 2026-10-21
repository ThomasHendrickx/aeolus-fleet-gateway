/**
 * What a page's form (a server action) answers the browser: nothing yet,
 * done with what changed, or refused with why, as the API said it. The
 * open network's warning asks for a confirm (interop I-3).
 */
export type FormState =
  | { kind: 'idle' }
  | { kind: 'done'; message: string }
  | { kind: 'refused'; message: string }
  | { kind: 'openNetwork'; message: string };

export const IDLE: FormState = { kind: 'idle' };

/** A form's text field, empty when it was not sent. */
export function fieldOf(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

/** The form's fields as text, files left out. */
export function fieldsOf(form: FormData): Record<string, string> {
  return Object.fromEntries([...form.entries()].flatMap(([name, value]) => (typeof value === 'string' ? [[name, value]] : [])));
}

/** The fleet a page's form names: the page's own, sent in a hidden field. */
export const FLEET_FIELD = 'fleet';

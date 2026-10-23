/**
 * The tools an approver switched when adding a server (aeolus-fleet#1151):
 * each tool the check answered is sent as shown, and the ticked ones as on.
 */

/** The field naming each tool whose switch the form showed. */
export const TOOL_SHOWN_FIELD = 'toolShown';

/** The field naming each tool ticked on. */
export const TOOL_ON_FIELD = 'toolOn';

function namesIn(form: FormData, field: string): string[] {
  return form.getAll(field).filter((value) => typeof value === 'string');
}

/** Each tool shown, on or off; none when the form showed no switch, so the server keeps every tool on. */
export function toolChoiceOf(form: FormData): { name: string; isOn: boolean }[] | undefined {
  const shown = namesIn(form, TOOL_SHOWN_FIELD);
  if (shown.length === 0) {
    return undefined;
  }
  const on = new Set(namesIn(form, TOOL_ON_FIELD));
  return shown.map((name) => ({ name, isOn: on.has(name) }));
}

/** A description's first line with words, as a tool's row shows it before it is opened. */
export function firstLineOf(description: string): string {
  return description.split('\n').map((line) => line.trim()).find((line) => line !== '') ?? '';
}

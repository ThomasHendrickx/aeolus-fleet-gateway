import { SCOPE_FIELD_PREFIX } from '../outside-party/scope-changes';

/** The scopes a form ticks, one `scope:<scope>` field each. */
export function tickedScopes(fields: Readonly<Record<string, string>>): string[] {
  return Object.keys(fields).flatMap((field) => (field.startsWith(SCOPE_FIELD_PREFIX) ? [field.slice(SCOPE_FIELD_PREFIX.length)] : []));
}

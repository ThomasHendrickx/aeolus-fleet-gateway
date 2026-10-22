import { CORE_SCOPE_DESCRIPTIONS, scopeSchema } from '@aeolus-fleet/common';

/** A scope in plain words: what a core scope allows, as the fleet words it (decision 0046); a plugin's scope by its name. */
export function scopeWords(scope: string): string {
  const core = scopeSchema.safeParse(scope);
  return core.success ? CORE_SCOPE_DESCRIPTIONS[core.data] : scope;
}

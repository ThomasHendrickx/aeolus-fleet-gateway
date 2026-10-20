/**
 * The scope rows a decision or a change shows (design B): each scope with
 * its plain label and the scope itself in mono, messages:send and
 * messages:receive locked on, as every app ship gets them (0046).
 */
import { escaped } from './html.js';
import { icon } from './signal.js';

/** The scopes every app ship gets (0046): shown locked on, and always sent. */
export const EVERY_APP_SHIP_SCOPES: readonly string[] = ['messages:send', 'messages:receive'];

/** A scope's plain label, as the scope rows show it beside the scope itself. */
const SCOPE_LABELS: Record<string, string> = {
  'messages:send': 'Send',
  'messages:receive': 'Receive',
  'fleet:read': 'Read the fleet',
};

/** A form field that ticks a scope: `scope:<scope>`, one field per scope, as a form posts each name once. */
export const SCOPE_FIELD_PREFIX = 'scope:';

/** One scope row: a locked row shows the scope ticked or not and sends nothing. */
export function scopeRow(row: { scope: string; isLocked?: boolean; isChecked?: boolean }): string {
  const { scope } = row;
  const isLocked = row.isLocked === true;
  const isChecked = isLocked ? row.isChecked !== false : row.isChecked === true;
  const label = escaped(SCOPE_LABELS[scope] ?? scope);
  const checked = isChecked ? ' checked' : '';
  const box = isLocked
    ? `<input type="checkbox"${checked} disabled aria-label="${label}">`
    : `<input type="checkbox" name="${SCOPE_FIELD_PREFIX}${escaped(scope)}"${checked} aria-label="${label}">`;
  return `<label class="scope">${box}<span class="label">${label}</span><span class="mono">${escaped(scope)}</span>${isLocked ? `<span class="muted">${icon('lock', 12)}</span>` : ''}</label>`;
}

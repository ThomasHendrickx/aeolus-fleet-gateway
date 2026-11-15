import { CircleAlert, CircleArrowRight, CircleCheck, CircleMinus, Hourglass } from 'lucide-react';
import { describe, expect, it } from 'vitest';

import { toneIcon } from './tone-icons';

/** The console's badges: waiting is an hourglass, active an arrow on, ok a check, attention an alert and ended a minus (ui's StatusBadge catalogue). */
describe('the icon a status badge shows for its tone', () => {
  it.each([
    ['waiting', Hourglass],
    ['active', CircleArrowRight],
    ['ok', CircleCheck],
    ['attention', CircleAlert],
    ['ended', CircleMinus],
  ] as const)('shows the %s tone with the console icon', (tone, icon) => {
    expect(toneIcon(tone)).toBe(icon);
  });
});

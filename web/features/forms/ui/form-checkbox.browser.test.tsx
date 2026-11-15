import { Checkbox } from '@aeolus-fleet/ui';
import { useActionState } from 'react';
import { describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../../app/globals.css';
import { fieldOf, fieldsOf, type FormState } from '../form-state';
import { ActionForm } from './action-form';

// React 19 resets a form once its action ends, refused or not. A tick box
// must then show what the form sends: what is shown is what goes.

const TICK = 'isRepeatable';

/** A form's action that refuses the first send and takes the next, keeping each send's tick. */
function refusingTheFirstSend(): { sent: string[]; action: (previous: FormState, form: FormData) => Promise<FormState> } {
  const sent: string[] = [];
  return {
    sent,
    action: (_previous, form) => {
      sent.push(fieldOf(form, TICK) === '' ? 'unticked' : 'ticked');
      return Promise.resolve(sent.length === 1 ? { kind: 'refused', message: 'The tool is not listed.' } : { kind: 'done', message: 'Marked.' });
    },
  };
}

type Refill = { kind: 'idle' } | { kind: 'refused'; fields: Record<string, string> } | { kind: 'done' };

/** A form that, refused, fills its tick again from what was sent, as Add an A2A agent does. */
function RefillingForm({ sent }: { sent: string[] }) {
  const [state, action] = useActionState((_previous: Refill, form: FormData): Promise<Refill> => {
    sent.push(fieldOf(form, TICK) === '' ? 'unticked' : 'ticked');
    return Promise.resolve(sent.length === 1 ? { kind: 'refused', fields: fieldsOf(form) } : { kind: 'done' });
  }, { kind: 'idle' });
  const fields = state.kind === 'refused' ? state.fields : {};
  return (
    <form action={action}>
      <Checkbox name={TICK} aria-label="Repeatable" defaultChecked={fields[TICK] !== undefined} data-testid="forms-tick" />
      <button type="submit">Add</button>
      {state.kind === 'idle' ? null : <p>{state.kind}</p>}
    </form>
  );
}

/** Whether the tick box shows ticked, as a person sees it. */
function shownTick(): string {
  return page.getByTestId('forms-tick').element().getAttribute('aria-checked') === 'true' ? 'ticked' : 'unticked';
}

describe('a tick box in a form', () => {
  it('sends again what it shows once a refused form was reset', async () => {
    const { sent, action } = refusingTheFirstSend();
    await render(
      <ActionForm action={action} fleetId="flt_01" submit={{ label: 'Mark', pending: 'Marking…' }}>
        <Checkbox name={TICK} aria-label="Repeatable" data-testid="forms-tick" />
      </ActionForm>,
    );

    await page.getByTestId('forms-tick').click();
    await page.getByRole('button', { name: 'Mark' }).click();
    await expect.element(page.getByText('The tool is not listed.')).toBeVisible();
    const shown = shownTick();
    await page.getByRole('button', { name: 'Mark' }).click();
    await expect.element(page.getByText('Marked.')).toBeVisible();

    expect({ shown, sent }).toEqual({ shown: 'unticked', sent: ['ticked', 'unticked'] });
  });

  it('shows and sends again the tick a refused form fills back in', async () => {
    const sent: string[] = [];
    await render(<RefillingForm sent={sent} />);

    await page.getByTestId('forms-tick').click();
    await page.getByRole('button', { name: 'Add' }).click();
    await expect.element(page.getByText('refused')).toBeVisible();
    const shown = shownTick();
    await page.getByRole('button', { name: 'Add' }).click();
    await expect.element(page.getByText('done')).toBeVisible();

    expect({ shown, sent }).toEqual({ shown: 'ticked', sent: ['ticked', 'ticked'] });
  });
});

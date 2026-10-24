'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { ActionButton } from '../../overview/ui/action-button';
import { Notice } from '../../overview/ui/notice';
import type { ActionOutcome } from '../../overview/hooks/overview-actions';
import { changeMic, contribute, type OwnMicChange } from '../hooks/meeting-actions';
import type { MeetingControl } from '../services/meeting';

/** Each mic control's words, and what it says while it works. */
const MIC_CONTROLS: Record<OwnMicChange, { label: string; pending: string }> = {
  request: { label: 'Request the mic', pending: 'Requesting...' },
  withdraw: { label: 'Withdraw my request', pending: 'Withdrawing...' },
  release: { label: 'Release the mic', pending: 'Releasing...' },
};

/**
 * What the person may do in the meeting now: write a contribution while they
 * hold the mic or moderate, and their own mic calls. A draft keeps one key
 * until it is taken, so a contribution tried again goes once. The page reads
 * itself again after each call.
 */
export function MeetingControls({ fleetId, meetingId, controls }: { fleetId: string; meetingId: string; controls: readonly MeetingControl[] }) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [draftKey, setDraftKey] = useState(() => crypto.randomUUID());
  const [working, setWorking] = useState<MeetingControl | undefined>();
  const [failure, setFailure] = useState<string | undefined>();
  const [, startTransition] = useTransition();

  const run = ({ control, action, onDone }: { control: MeetingControl; action: () => Promise<ActionOutcome<undefined>>; onDone?: () => void }) => {
    setWorking(control);
    setFailure(undefined);
    startTransition(async () => {
      const outcome = await action();
      setWorking(undefined);
      if (outcome.isOk) {
        onDone?.();
        router.refresh();
      } else {
        setFailure(outcome.message);
      }
    });
  };

  const isWorking = working !== undefined;
  const micControls = controls.filter((control): control is OwnMicChange => control !== 'contribute');
  return (
    <div className="grid gap-3">
      {controls.includes('contribute') ? (
        <div className="grid gap-2">
          <label className="grid gap-1">
            <span>Your contribution</span>
            <textarea
              data-testid="meeting-text"
              rows={4}
              value={text}
              onChange={(event) => { setText(event.target.value); }}
              className="rounded-md border border-input bg-background p-2"
            />
          </label>
          <ActionButton
            data-testid="meeting-contribute"
            variant="primary"
            className="justify-self-start"
            isPending={working === 'contribute'}
            pendingLabel="Sending..."
            disabled={isWorking}
            onClick={() => {
              run({
                control: 'contribute',
                action: () => contribute({ fleet: fleetId, meetingId, text, idempotencyKey: draftKey }),
                onDone: () => {
                  setText('');
                  setDraftKey(crypto.randomUUID());
                },
              });
            }}
          >
            Contribute
          </ActionButton>
        </div>
      ) : null}
      {micControls.length === 0 ? null : (
        <div className="flex flex-wrap gap-2">
          {micControls.map((change) => (
            <ActionButton
              key={change}
              data-testid={`meeting-${change}`}
              variant={change === 'request' ? 'primary' : 'secondary'}
              isPending={working === change}
              pendingLabel={MIC_CONTROLS[change].pending}
              disabled={isWorking}
              onClick={() => { run({ control: change, action: () => changeMic({ fleet: fleetId, meetingId, change }) }); }}
            >
              {MIC_CONTROLS[change].label}
            </ActionButton>
          ))}
        </div>
      )}
      {failure === undefined ? null : <Notice message={failure} isFailure />}
    </div>
  );
}

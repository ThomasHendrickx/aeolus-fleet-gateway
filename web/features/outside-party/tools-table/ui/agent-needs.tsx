'use client';

import { Toast } from '@base-ui/react/toast';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { setPartyScopes } from '../../actions';
import { partyScopesSetMessage, statedMessage } from '../table-messages';
import { NeedsChips, type ListedScope } from './needs-chips';
import { ScopePicker } from './scope-picker';
import { TableDialog, type DialogRefusal } from './table-dialog';
import { TableToasts } from './table-toasts';

/**
 * An outside A2A agent's one Needs line (gateway scopes 4.3): its messages
 * name no skill, so one set of scopes guards the agent as a whole, changed
 * in a dialog on the version the page read.
 */
export function AgentNeeds(props: { fleetId: string; party: string; version: number; scopes: readonly string[]; listed: readonly ListedScope[] | null; canChange: boolean }) {
  return (
    <Toast.Provider>
      <AgentNeedsLine {...props} />
      <TableToasts />
    </Toast.Provider>
  );
}

function AgentNeedsLine({ fleetId, party, version, scopes, listed, canChange }: { fleetId: string; party: string; version: number; scopes: readonly string[]; listed: readonly ListedScope[] | null; canChange: boolean }) {
  const router = useRouter();
  const toasts = Toast.useToastManager();
  const [, startTransition] = useTransition();
  const [isOpen, setIsOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [refusal, setRefusal] = useState<DialogRefusal | null>(null);
  const [keptVersion, setKeptVersion] = useState<number | null>(null);
  const [round, setRound] = useState(0);
  const [kept, setKept] = useState<{ basis: readonly string[]; scopes: readonly string[] } | null>(null);
  // What was kept shows at once; once the page read itself again, its scopes are the truth.
  const shown = kept?.basis === scopes ? kept.scopes : scopes;

  const save = () => {
    setIsSaving(true);
    setRefusal(null);
    startTransition(async () => {
      const outcome = await setPartyScopes({ fleetId, name: party, version: Math.max(version, keptVersion ?? 0), party: picked, tools: [] });
      setIsSaving(false);
      if (!outcome.isOk) {
        setRefusal({ message: outcome.message, isConflict: outcome.isConflict });
        return;
      }
      setKeptVersion(outcome.version);
      setKept({ basis: scopes, scopes: picked });
      setIsOpen(false);
      setRound((previous) => previous + 1);
      toasts.add({ title: statedMessage(partyScopesSetMessage({ party, scopes: picked }), outcome.statementRefusal) });
      router.refresh();
    });
  };

  return (
    <div key={round} className={`flex flex-wrap items-center gap-2 rounded-md ${round > 0 ? 'animate-highlight' : ''}`} data-testid="agent-needs">
      <NeedsChips own={shown} listed={listed === null ? null : new Set(listed.map(({ scope }) => scope))} />
      {canChange && listed !== null ? (
        <>
          <button
            type="button"
            className="text-primary hover:underline"
            onClick={() => {
              setPicked([...shown]);
              setRefusal(null);
              setIsOpen(true);
            }}
            data-testid="agent-needs-change"
          >
            Change…
          </button>
          <TableDialog
            isOpen={isOpen}
            onClose={() => { setIsOpen(false); }}
            title="Every message needs"
            description={`The scopes a calling ship must hold to message ${party}.`}
            appliesTo={`Applies to every message to ${party}`}
            action={{ label: 'Save', pending: 'Saving…', isDisabled: false, onPress: save }}
            isSaving={isSaving}
            refusal={refusal}
            onReload={() => {
              setRefusal(null);
              router.refresh();
            }}
            testId="agent-needs-dialog"
          >
            <ScopePicker label="Scopes" listed={listed} picked={picked} onPick={setPicked} isDisabled={isSaving} testId="agent-needs-picker" />
          </TableDialog>
        </>
      ) : null}
    </div>
  );
}

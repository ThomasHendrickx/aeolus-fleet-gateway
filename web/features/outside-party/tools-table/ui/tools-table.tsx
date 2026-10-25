'use client';

import { Drawer } from '@base-ui/react/drawer';
import { Toast } from '@base-ui/react/toast';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { BUTTONS, INPUT } from '../../../forms/ui/look';
import { Switch } from '../../../forms/ui/switch';
import { ActionButton } from '../../../overview/ui/action-button';
import { StatusBadge, Tag } from '../../../outside-parties/ui/status-badge';
import { setPartyScopes, switchPartyTools, type TableOutcome } from '../../actions';
import { switchedMessageOf } from '../../switched-message';
import { hintSuggestionsOf, suggestedScopesOf } from '../hint-suggestions';
import { changedScopesOf, SCOPE_CHANGES, type ScopeChange } from '../scope-change';
import { partyScopesSetMessage, scopesSetMessage, statedMessage, suggestionsSetMessage, toolsSwitchedMessage } from '../table-messages';
import { shownTools, STATE_FILTERS, type StateFilter, type TableTool } from '../table-tools';
import { NeedsChips, type ListedScope } from './needs-chips';
import { ScopePicker } from './scope-picker';
import { TableDialog, type DialogRefusal } from './table-dialog';
import { TableToasts } from './table-toasts';

/** What the table shows of one outside MCP server, as its page read it. */
export interface ToolsTableProps {
  fleetId: string;
  party: string;
  tools: readonly TableTool[];
  /** The requirements' version the page read, which every change is made on. */
  version: number;
  partyScopes: readonly string[];
  /** The scopes the fleet lists, for an approver; none for anyone else. */
  listed: readonly ListedScope[] | null;
  /** Whether the actor approves the party: gateway:approve within manage reach. Others see the table read-only. */
  canChange: boolean;
  /** Why the server's tools could not be read: the table then shows the requirements kept per tool name. */
  serverRefusal: string | null;
}

type OpenDialog = 'scopes' | 'party' | 'suggest' | null;

const ALL_SELECTED = 'Select all shown';

function firstLineOf(description: string | undefined): string {
  return description?.split('\n').find((line) => line.trim() !== '')?.trim() ?? '';
}

/**
 * An outside MCP server's tools as a table (gateway scopes 4.3, A6): filter
 * by name and state, select many, and set the scopes they need or switch them
 * in one change; set what every tool needs; or suggest scopes from the
 * server's hints. Each change is one transaction on the requirements' version
 * the page read: on success the dialog closes, the changed rows highlight and
 * a Toast says what was kept; a refusal stays inline. Only an approver within
 * manage reach sees the controls; anyone else, the same table read-only.
 */
export function ToolsTable(props: ToolsTableProps) {
  return (
    <Toast.Provider>
      <TableBody {...props} />
      <TableToasts />
    </Toast.Provider>
  );
}

function TableBody({ fleetId, party, tools, version, partyScopes, listed, canChange, serverRefusal }: ToolsTableProps) {
  const router = useRouter();
  const toasts = Toast.useToastManager();
  const [, startTransition] = useTransition();
  const [nameFilter, setNameFilter] = useState('');
  const [stateFilter, setStateFilter] = useState<StateFilter>('all');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [how, setHow] = useState<ScopeChange>('add');
  const [suggestPicks, setSuggestPicks] = useState<{ readOnly: string[]; other: string[] }>({ readOnly: [], other: [] });
  const [isSaving, setIsSaving] = useState(false);
  const [refusal, setRefusal] = useState<DialogRefusal | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);
  const [switchRefusal, setSwitchRefusal] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState<{ names: ReadonlySet<string>; round: number }>({ names: new Set(), round: 0 });
  const [keptVersion, setKeptVersion] = useState<number | null>(null);
  const [isSheetOpen, setIsSheetOpen] = useState(false);

  // A change kept here moves the version on before the page reads itself again.
  const currentVersion = Math.max(version, keptVersion ?? 0);
  const listedNames = listed === null ? null : new Set(listed.map(({ scope }) => scope));
  const shown = shownTools(tools, { name: nameFilter, state: stateFilter, partyScopes });
  const selectedTools = tools.filter(({ name }) => selected.has(name));
  const isServerAnswering = serverRefusal === null;
  const isEveryShownSelected = shown.length > 0 && shown.every(({ name }) => selected.has(name));
  const suggestions = hintSuggestionsOf(tools);
  const suggested = suggestedScopesOf(suggestions, suggestPicks);

  const kept = ({ outcome, changed, message }: { outcome: Extract<TableOutcome, { isOk: true }>; changed: readonly string[]; message: string }) => {
    if (outcome.version !== null) {
      setKeptVersion(outcome.version);
    }
    setHighlighted((previous) => ({ names: new Set(changed), round: previous.round + 1 }));
    toasts.add({ title: statedMessage(message, outcome.statementRefusal) });
    router.refresh();
  };

  const openDialog = (opened: Exclude<OpenDialog, null>) => {
    setRefusal(null);
    setIsSheetOpen(false);
    setPicked(opened === 'party' ? [...partyScopes] : []);
    setHow('add');
    setSuggestPicks({ readOnly: [], other: [] });
    setDialog(opened);
  };

  const closeDialog = () => {
    setDialog(null);
    setRefusal(null);
  };

  const save = ({ change, changed, message }: { change: { party?: string[]; tools: { tool: string; scopes: string[] }[] }; changed: readonly string[]; message: string }) => {
    setIsSaving(true);
    setRefusal(null);
    startTransition(async () => {
      const outcome = await setPartyScopes({ fleetId, name: party, version: currentVersion, ...change });
      setIsSaving(false);
      if (!outcome.isOk) {
        setRefusal({ message: outcome.message, isConflict: outcome.isConflict });
        return;
      }
      setDialog(null);
      setSelected(new Set());
      kept({ outcome, changed, message });
    });
  };

  const switchTools = ({ names, isOn, working }: { names: readonly string[]; isOn: boolean; working: string }) => {
    setSwitching(working);
    setSwitchRefusal(null);
    setIsSheetOpen(false);
    startTransition(async () => {
      const outcome = await switchPartyTools({ fleetId, name: party, tools: [...names], isOn });
      setSwitching(null);
      if (!outcome.isOk) {
        setSwitchRefusal(outcome.message);
        return;
      }
      const [only] = names;
      kept({ outcome, changed: names, message: names.length === 1 && only !== undefined ? switchedMessageOf({ tool: only, isOn, statementRefusal: null }) : toolsSwitchedMessage({ count: names.length, isOn, statementRefusal: null }) });
    });
  };

  const reload = () => {
    setRefusal(null);
    router.refresh();
  };

  const toggle = (name: string) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  };

  const toggleShown = () => {
    setSelected((previous) => {
      const next = new Set(previous);
      for (const { name } of shown) {
        if (isEveryShownSelected) {
          next.delete(name);
        } else {
          next.add(name);
        }
      }
      return next;
    });
  };

  const isBusy = switching !== null || isSaving;
  const toolbar = (
    <div className="grid gap-3 sm:flex sm:flex-wrap sm:items-center" data-testid="tools-table-toolbar">
      <label className="grid gap-1 sm:w-56">
        <span className="sr-only">Filter by name</span>
        <input className={INPUT} type="search" placeholder="Filter by name" value={nameFilter} onChange={(event) => { setNameFilter(event.target.value); }} data-testid="tools-table-name-filter" />
      </label>
      <div role="group" aria-label="Filter by state" className="flex flex-wrap gap-1">
        {STATE_FILTERS.map(({ state, label }) => (
          <button
            key={state}
            type="button"
            aria-pressed={stateFilter === state}
            onClick={() => { setStateFilter(state); }}
            className={`h-8 rounded-md border px-3 ${stateFilter === state ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:bg-accent'}`}
            data-testid={`tools-table-state-${state}`}
          >
            {label}
          </button>
        ))}
      </div>
      {canChange ? (
        <>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={isEveryShownSelected} onChange={toggleShown} disabled={shown.length === 0} data-testid="tools-table-select-shown" />
            {ALL_SELECTED}
          </label>
          <span className="text-muted-foreground" data-testid="tools-table-selected">
            {selected.size} selected
          </span>
          <div className="flex flex-wrap gap-2 sm:ml-auto">
            <button type="button" className={BUTTONS.secondary} disabled={selected.size === 0 || isBusy || listed === null} onClick={() => { openDialog('scopes'); }} data-testid="tools-table-set-scopes">
              Set scopes…
            </button>
            <ActionButton isPending={switching === 'on'} pendingLabel="Switching on…" disabled={selected.size === 0 || isBusy || !isServerAnswering} onClick={() => { switchTools({ names: [...selected], isOn: true, working: 'on' }); }} data-testid="tools-table-switch-on">
              Switch on
            </ActionButton>
            <ActionButton isPending={switching === 'off'} pendingLabel="Switching off…" disabled={selected.size === 0 || isBusy || !isServerAnswering} onClick={() => { switchTools({ names: [...selected], isOn: false, working: 'off' }); }} data-testid="tools-table-switch-off">
              Switch off
            </ActionButton>
            <button type="button" className={BUTTONS.secondary} disabled={isBusy || !isServerAnswering || listed === null} onClick={() => { openDialog('suggest'); }} data-testid="tools-table-suggest">
              Suggest from hints…
            </button>
          </div>
        </>
      ) : null}
    </div>
  );

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2" data-testid="tools-table-party-needs">
        <span className="font-medium">Every tool needs</span>
        <NeedsChips party={partyScopes} own={[]} listed={listedNames} />
        {canChange ? (
          <button type="button" className="text-primary hover:underline disabled:opacity-60" disabled={isBusy || listed === null} onClick={() => { openDialog('party'); }} data-testid="tools-table-party-change">
            Change…
          </button>
        ) : null}
      </div>
      {serverRefusal === null ? null : (
        <p role="status" className="rounded-md border border-tone-waiting-border bg-tone-waiting-bg px-3 py-2 text-tone-waiting-fg" data-testid="tools-table-server-down">
          The server did not answer, so this shows the scopes kept per tool name; they can still be changed. {serverRefusal}
        </p>
      )}
      <div className="hidden sm:block">{toolbar}</div>
      <div className="sm:hidden">
        <Drawer.Root open={isSheetOpen} onOpenChange={setIsSheetOpen}>
          <Drawer.Trigger className={BUTTONS.secondary} data-testid="tools-table-sheet-open">
            Filters and actions{canChange ? ` (${String(selected.size)} selected)` : ''}
          </Drawer.Trigger>
          <Drawer.Portal>
            <Drawer.Backdrop className="fixed inset-0 z-40 bg-(--overlay)" />
            <Drawer.Viewport className="fixed inset-0 z-50 flex items-end">
              <Drawer.Popup className="w-full rounded-t-lg border border-border bg-popover p-4 text-popover-foreground shadow-lg">
                <Drawer.Content className="grid gap-3">
                  <Drawer.Title className="text-heading font-semibold">Filters and actions</Drawer.Title>
                  {toolbar}
                  <Drawer.Close className={BUTTONS.secondary}>Done</Drawer.Close>
                </Drawer.Content>
              </Drawer.Popup>
            </Drawer.Viewport>
          </Drawer.Portal>
        </Drawer.Root>
      </div>
      {switchRefusal === null ? null : (
        <p role="alert" className="rounded-md border border-tone-attention-border bg-tone-attention-bg px-3 py-2 text-tone-attention-fg" data-testid="tools-table-switch-refusal">
          {switchRefusal}
        </p>
      )}
      <table className="w-full border-collapse max-sm:block" data-testid="tools-table">
        <thead className="max-sm:hidden">
          <tr className="border-b border-border text-left text-muted-foreground">
            {canChange ? <th className="w-8 py-2"><span className="sr-only">Selected</span></th> : null}
            <th className="py-2 font-medium">Tool</th>
            <th className="py-2 font-medium">Hints</th>
            <th className="py-2 font-medium">On</th>
            <th className="py-2 font-medium">Needs</th>
          </tr>
        </thead>
        <tbody className="max-sm:grid max-sm:gap-2">
          {shown.map((tool) => {
            const isHighlighted = highlighted.names.has(tool.name);
            return (
              <tr
                key={isHighlighted ? `${tool.name}-${String(highlighted.round)}` : tool.name}
                className={`border-b border-border align-top last:border-b-0 max-sm:grid max-sm:grid-cols-[auto_1fr] max-sm:gap-x-2 max-sm:rounded-md max-sm:border max-sm:p-2 ${isHighlighted ? 'animate-highlight' : ''}`}
                data-testid="tools-table-row"
                data-tool={tool.name}
              >
                {canChange ? (
                  <td className="py-2 pr-2 max-sm:row-span-4">
                    <input type="checkbox" aria-label={`Select ${tool.name}`} checked={selected.has(tool.name)} onChange={() => { toggle(tool.name); }} data-testid="tools-table-select" />
                  </td>
                ) : null}
                <td className="py-2 pr-3 max-sm:col-start-2">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-mono">{tool.name}</span>
                    {tool.isNew ? <StatusBadge tone="attention" label="New" /> : null}
                  </span>
                  {firstLineOf(tool.description) === '' ? null : <span className="block text-muted-foreground">{firstLineOf(tool.description)}</span>}
                </td>
                <td className="py-2 pr-3 max-sm:col-start-2">
                  <span className="flex flex-wrap gap-1">
                    {tool.isReadOnly === true ? <Tag>Read only</Tag> : null}
                    {tool.isDestructive === true ? <Tag>Destructive</Tag> : null}
                  </span>
                </td>
                <td className="py-2 pr-3 max-sm:col-start-2">
                  {tool.isOn === null ? (
                    <span className="text-muted-foreground">Not known</span>
                  ) : canChange ? (
                    <Switch isOn={tool.isOn} label={tool.name} isPending={switching === tool.name} onClick={() => { switchTools({ names: [tool.name], isOn: tool.isOn !== true, working: tool.name }); }} testId="tools-table-switch" />
                  ) : (
                    <Tag>{tool.isOn ? 'On' : 'Off'}</Tag>
                  )}
                </td>
                <td className="py-2 max-sm:col-start-2">
                  <NeedsChips party={partyScopes} own={tool.scopes} listed={listedNames} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {shown.length === 0 ? (
        <p className="text-muted-foreground" data-testid="tools-table-empty">
          {tools.length === 0 ? (isServerAnswering ? `${party} lists no tools.` : 'No tool needs a scope of its own yet.') : 'No tool matches the filters.'}
        </p>
      ) : null}
      {listed === null ? null : (
        <>
          <TableDialog
            isOpen={dialog === 'scopes'}
            onClose={closeDialog}
            title="Set scopes"
            description="The scopes a calling ship must hold for each selected tool, beside what every tool needs."
            appliesTo={`Applies to ${String(selectedTools.length)} ${selectedTools.length === 1 ? 'tool' : 'tools'}`}
            action={{
              label: 'Set scopes',
              pending: 'Setting…',
              isDisabled: picked.length === 0 && how !== 'replace',
              onPress: () => {
                save({ change: { tools: changedScopesOf(selectedTools, { scopes: picked, how }) }, changed: selectedTools.map(({ name }) => name), message: scopesSetMessage({ scopes: picked, how, count: selectedTools.length }) });
              },
            }}
            isSaving={isSaving}
            refusal={refusal}
            onReload={reload}
            testId="tools-table-scopes-dialog"
          >
            <ScopePicker label="Scopes" listed={listed} picked={picked} onPick={setPicked} isDisabled={isSaving} testId="tools-table-scopes-picker" />
            <fieldset className="grid gap-1">
              <legend className="font-medium">On each selected tool</legend>
              {SCOPE_CHANGES.map((change) => (
                <label key={change.how} className="flex items-center gap-2">
                  <input type="radio" name="how" value={change.how} checked={how === change.how} onChange={() => { setHow(change.how); }} data-testid={`tools-table-how-${change.how}`} />
                  {change.label}
                </label>
              ))}
            </fieldset>
          </TableDialog>
          <TableDialog
            isOpen={dialog === 'party'}
            onClose={closeDialog}
            title="Every tool needs"
            description={`The scopes a calling ship must hold for every tool of ${party}, beside each tool's own.`}
            appliesTo={`Applies to every tool of ${party}`}
            action={{
              label: 'Save',
              pending: 'Saving…',
              isDisabled: false,
              onPress: () => {
                save({ change: { party: picked, tools: [] }, changed: tools.map(({ name }) => name), message: partyScopesSetMessage({ party, scopes: picked }) });
              },
            }}
            isSaving={isSaving}
            refusal={refusal}
            onReload={reload}
            testId="tools-table-party-dialog"
          >
            <ScopePicker label="Scopes" listed={listed} picked={picked} onPick={setPicked} isDisabled={isSaving} testId="tools-table-party-picker" />
          </TableDialog>
          <TableDialog
            isOpen={dialog === 'suggest'}
            onClose={closeDialog}
            title="Suggest from hints"
            description="Scopes for each tool with no scope of its own, by what the server says of it. Hints are the server's claim: nothing applies until you confirm."
            appliesTo={`Applies to ${String(suggested.length)} ${suggested.length === 1 ? 'tool' : 'tools'}`}
            action={{
              label: 'Apply',
              pending: 'Applying…',
              isDisabled: suggested.length === 0,
              onPress: () => {
                const groups = [
                  { scopes: suggestPicks.readOnly, count: suggestPicks.readOnly.length === 0 ? 0 : suggestions.readOnly.length },
                  { scopes: suggestPicks.other, count: suggestPicks.other.length === 0 ? 0 : suggestions.other.length },
                ].filter(({ count }) => count > 0);
                save({ change: { tools: suggested }, changed: suggested.map(({ tool }) => tool), message: suggestionsSetMessage(groups) });
              },
            }}
            isSaving={isSaving}
            refusal={refusal}
            onReload={reload}
            testId="tools-table-suggest-dialog"
          >
            <ScopePicker label="Scopes for read-only tools" listed={listed} picked={suggestPicks.readOnly} onPick={(readOnly) => { setSuggestPicks((previous) => ({ ...previous, readOnly })); }} isDisabled={isSaving} testId="tools-table-suggest-read-only" />
            <ScopePicker label="Scopes for the other tools" listed={listed} picked={suggestPicks.other} onPick={(other) => { setSuggestPicks((previous) => ({ ...previous, other })); }} isDisabled={isSaving} testId="tools-table-suggest-other" />
            <SuggestedList title="Read-only tools" names={suggestions.readOnly} testId="tools-table-suggest-read-only-tools" />
            <SuggestedList title="Other tools" names={suggestions.other} testId="tools-table-suggest-other-tools" />
            <SuggestedList title="Without hints, left as they are" names={suggestions.withoutHints} testId="tools-table-suggest-without-hints" />
          </TableDialog>
        </>
      )}
    </div>
  );
}

/** One group of the tools a suggestion would change, by name. */
function SuggestedList({ title, names, testId }: { title: string; names: readonly string[]; testId: string }) {
  return (
    <details className="rounded-md border border-border px-3 py-2" data-testid={testId}>
      <summary className="cursor-pointer">
        {title} ({names.length})
      </summary>
      {names.length === 0 ? <p className="text-muted-foreground">None</p> : <p className="font-mono text-code break-words">{names.join(', ')}</p>}
    </details>
  );
}

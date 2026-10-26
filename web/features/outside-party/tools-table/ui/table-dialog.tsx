'use client';

import { Dialog } from '@base-ui/react/dialog';
import type { ReactNode } from 'react';

import { BUTTONS } from '../../../forms/ui/look';
import { ActionButton } from '../../../overview/ui/action-button';

/** Why the API refused a change in a dialog: said inline, CONFLICT with Reload, at the requirements' version the change was made on. */
export interface DialogRefusal {
  message: string;
  isConflict: boolean;
  version: number;
}

/** The refusal still to say: a CONFLICT is answered once the page read newer requirements. */
export function standingRefusal(refusal: DialogRefusal | null, version: number): DialogRefusal | null {
  return refusal?.isConflict === true && version > refusal.version ? null : refusal;
}

/**
 * A dialog of the tools table (gateway scopes 4.3): its fields, a footer
 * saying what it applies to, and its action. While the action is on its
 * way the action shows its spinner and the dialog takes no input and does
 * not close; a refusal stays inline, with Reload when the requirements
 * changed since the page was read, which shows its spinner until the page
 * read them again.
 */
export function TableDialog({
  isOpen,
  onClose,
  title,
  description,
  children,
  appliesTo,
  action,
  isSaving,
  refusal,
  onReload,
  isReloading,
  testId,
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description: string;
  children: ReactNode;
  appliesTo: string;
  action: { label: string; pending: string; isDisabled: boolean; onPress: () => void };
  isSaving: boolean;
  refusal: DialogRefusal | null;
  onReload: () => void;
  isReloading: boolean;
  testId: string;
}) {
  return (
    <Dialog.Root
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && !isSaving) {
          onClose();
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-(--overlay)" />
        <Dialog.Popup className="fixed top-1/2 left-1/2 z-50 grid max-h-[90vh] w-[min(36rem,calc(100vw-2rem))] -translate-1/2 gap-4 overflow-auto rounded-lg border border-border bg-popover p-6 text-popover-foreground shadow-lg" data-testid={testId}>
          <div className="grid gap-1">
            <Dialog.Title className="text-heading font-semibold">{title}</Dialog.Title>
            <Dialog.Description className="text-muted-foreground">{description}</Dialog.Description>
          </div>
          <fieldset disabled={isSaving} className="grid gap-4">
            {children}
          </fieldset>
          {refusal === null ? null : (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-tone-attention-border bg-tone-attention-bg px-3 py-2 text-tone-attention-fg" data-testid="tools-table-dialog-refusal">
              <span>{refusal.message}</span>
              {refusal.isConflict ? (
                <ActionButton isPending={isReloading} pendingLabel="Reloading…" onClick={onReload} data-testid="tools-table-reload">
                  Reload
                </ActionButton>
              ) : null}
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-muted-foreground" data-testid="tools-table-applies-to">
              {appliesTo}
            </span>
            <div className="flex gap-2">
              <button type="button" className={BUTTONS.secondary} disabled={isSaving} onClick={onClose}>
                Cancel
              </button>
              <ActionButton variant="primary" isPending={isSaving} pendingLabel={action.pending} disabled={action.isDisabled || isReloading} onClick={action.onPress} data-testid="tools-table-dialog-action">
                {action.label}
              </ActionButton>
            </div>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

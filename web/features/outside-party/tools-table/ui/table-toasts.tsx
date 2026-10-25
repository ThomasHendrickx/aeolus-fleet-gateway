'use client';

import { Toast } from '@base-ui/react/toast';

/** The toasts a party's page raised, each saying what was kept (gateway scopes 4.3). */
export function TableToasts() {
  const { toasts } = Toast.useToastManager();
  return (
    <Toast.Portal>
      <Toast.Viewport className="fixed right-4 bottom-4 z-50 grid w-[min(24rem,calc(100vw-2rem))] gap-2">
        {toasts.map((toast) => (
          <Toast.Root key={toast.id} toast={toast} className="rounded-md border border-tone-ok-border bg-tone-ok-bg px-4 py-3 text-tone-ok-fg shadow-md" data-testid="tools-table-toast">
            <Toast.Content className="flex items-start justify-between gap-3">
              <Toast.Title />
              <Toast.Close aria-label="Dismiss">×</Toast.Close>
            </Toast.Content>
          </Toast.Root>
        ))}
      </Toast.Viewport>
    </Toast.Portal>
  );
}

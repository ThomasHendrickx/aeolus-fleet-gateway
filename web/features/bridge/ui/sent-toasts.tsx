'use client';

import { Toast } from '@base-ui/react/toast';
import { CircleCheck, X } from 'lucide-react';

/** The toasts the form raised, each saying a message was sent and stored. */
export function SentToasts() {
  const { toasts } = Toast.useToastManager();
  return (
    <Toast.Portal>
      <Toast.Viewport className="fixed right-4 bottom-4 z-50 grid w-[min(24rem,calc(100vw-2rem))] gap-2">
        {toasts.map((toast) => (
          <Toast.Root key={toast.id} toast={toast} data-testid="bridge-send-toast" className="rounded-lg border border-border bg-popover px-4 py-3 text-popover-foreground shadow-lg">
            <Toast.Content className="flex items-start gap-3">
              <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-tone-ok-fg" />
              <div className="grid flex-1 gap-1">
                <Toast.Title className="font-semibold" />
                <Toast.Description className="text-muted-foreground" />
              </div>
              <Toast.Close aria-label="Close" className="inline-flex size-7 items-center justify-center rounded-md hover:bg-accent">
                <X aria-hidden="true" className="size-4" />
              </Toast.Close>
            </Toast.Content>
          </Toast.Root>
        ))}
      </Toast.Viewport>
    </Toast.Portal>
  );
}

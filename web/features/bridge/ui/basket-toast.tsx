'use client';

import { Toast } from '@base-ui/react/toast';
import { ShoppingBasket } from 'lucide-react';

/** What a toast says: what happened, then what it means. */
export interface ToastWords {
  readonly title: string;
  readonly description: string;
}

/** What the toast says once an answer is in the basket (basket.html): what went in, not sent, still waiting. */
export function putToastOf(option: number | null): ToastWords {
  return { title: option === null ? 'Your note alone in the basket' : `Option ${String(option)} in the basket`, description: 'Not sent. Still waiting on you until you send it.' };
}

/** The toasts Bridge raised for the basket, each behind the basket icon, on the popover. */
export function BasketToasts() {
  const { toasts } = Toast.useToastManager();
  return (
    <Toast.Portal>
      <Toast.Viewport className="fixed right-4 bottom-4 z-50 grid w-[min(24rem,calc(100vw-2rem))] gap-2">
        {toasts.map((toast) => (
          <Toast.Root key={toast.id} toast={toast} data-testid="bridge-basket-toast" className="flex items-start gap-3 rounded-lg border border-border bg-popover p-4 text-popover-foreground shadow-lg">
            <ShoppingBasket aria-hidden className="mt-0.5 size-4 shrink-0" />
            <Toast.Content className="grid flex-1 gap-1">
              <Toast.Title className="font-medium" />
              <Toast.Description className="text-caption text-muted-foreground" />
            </Toast.Content>
            <Toast.Close aria-label="Dismiss" className="text-muted-foreground">
              ×
            </Toast.Close>
          </Toast.Root>
        ))}
      </Toast.Viewport>
    </Toast.Portal>
  );
}

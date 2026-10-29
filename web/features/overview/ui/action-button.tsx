import type { ButtonHTMLAttributes, ReactNode } from 'react';

const VARIANTS = {
  primary: 'bg-primary text-primary-foreground hover:bg-primary-hover',
  secondary: 'border border-border bg-card text-card-foreground hover:bg-accent',
} as const;

/**
 * A button for an action: the moment it is pressed and until the answer
 * comes, it shows a spinner and its working label, and cannot run twice.
 */
export function ActionButton({
  isPending,
  pendingLabel,
  variant = 'secondary',
  children,
  className = '',
  disabled,
  ...button
}: ButtonHTMLAttributes<HTMLButtonElement> & { isPending: boolean; pendingLabel: string; variant?: keyof typeof VARIANTS; children: ReactNode }) {
  return (
    <button
      {...button}
      disabled={disabled === true || isPending}
      aria-busy={isPending}
      className={`inline-flex h-9 items-center gap-2 rounded-md px-4 disabled:cursor-not-allowed disabled:opacity-70 ${VARIANTS[variant]} ${className}`}
    >
      {isPending ? (
        <>
          <span aria-hidden="true" className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
          {pendingLabel}
        </>
      ) : (
        children
      )}
    </button>
  );
}

import type { ButtonHTMLAttributes, ReactNode } from 'react';

const VARIANTS = {
  primary: 'bg-primary text-primary-foreground hover:bg-primary-hover',
  secondary: 'border border-border bg-card text-card-foreground hover:bg-accent',
} as const;

/** A row's buttons are small on a desktop, and a thumb's size on a phone (Bridge mockups, home). */
export const SIZES = {
  regular: 'h-9 gap-2 px-4',
  row: 'h-9 gap-2 px-4 text-body sm:h-6 sm:gap-1.5 sm:px-2.5 sm:text-meta',
} as const;

/**
 * A button for an action: the moment it is pressed and until the answer
 * comes, it shows a spinner and its working label, and cannot run twice.
 */
export function ActionButton({
  isPending,
  pendingLabel,
  variant = 'secondary',
  size = 'regular',
  children,
  className = '',
  disabled,
  ...button
}: ButtonHTMLAttributes<HTMLButtonElement> & { isPending: boolean; pendingLabel: string; variant?: keyof typeof VARIANTS; size?: keyof typeof SIZES; children: ReactNode }) {
  return (
    <button
      {...button}
      disabled={disabled === true || isPending}
      aria-busy={isPending}
      className={`inline-flex items-center rounded-md disabled:cursor-not-allowed disabled:opacity-70 ${SIZES[size]} ${VARIANTS[variant]} ${className}`}
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

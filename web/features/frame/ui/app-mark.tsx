import { classNames } from '@aeolus-fleet/ui';
import { Ship } from 'lucide-react';

const SIZES = {
  28: 'size-7 text-micro [&_svg]:size-(--size-icon-sm)',
  36: 'size-9 text-caption [&_svg]:size-(--size-icon)',
} as const;

/**
 * The tile with the ship glyph that stands for the app, as @aeolus-fleet/ui
 * drew it up to 0.38.0. The gateway keeps it here until a new mark is approved.
 */
export function AppMark({ size = 28, className = '' }: { size?: keyof typeof SIZES; className?: string }) {
  return (
    <span
      aria-hidden
      data-slot="avatar"
      className={classNames(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-sm bg-primary font-semibold text-primary-foreground uppercase select-none',
        SIZES[size],
        className,
      )}
    >
      <span>
        <Ship aria-hidden />
      </span>
    </span>
  );
}

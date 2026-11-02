/** The classes the pages share, on the design tokens: a card and the button kinds. */
export const CARD = 'rounded-lg border border-border bg-card p-6 text-card-foreground shadow-sm';

/** A card in the Compact look, as Bridge's pages draw it (design/bridge-navigation): tighter, flat. */
export const COMPACT_CARD = 'rounded-lg border border-border bg-card p-3 text-card-foreground';

const BUTTON = 'inline-flex h-9 items-center justify-center gap-2 rounded-md px-4 font-medium disabled:opacity-60';

export const BUTTONS = {
  primary: `${BUTTON} bg-primary text-primary-foreground hover:bg-primary-hover`,
  secondary: `${BUTTON} border border-border bg-card hover:bg-accent`,
  destructive: `${BUTTON} bg-destructive text-destructive-foreground`,
} as const;

/** A small button in the Compact look, beside a page's title. */
export const SMALL_BUTTON = 'h-7 px-3 text-meta';

export type ButtonKind = keyof typeof BUTTONS;

export const INPUT = 'h-9 w-full rounded-md border border-input bg-background px-3 font-mono text-code';

export const LABEL = 'grid gap-1';

/** A select in the body font, its browser chevron replaced by the design system's (design/bridge-navigation). */
export const SELECT = 'h-9 w-full appearance-none rounded-md border border-input bg-background pr-8 pl-3';

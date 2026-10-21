/** The classes the pages share, on the design tokens: a card and the button kinds. */
export const CARD = 'rounded-lg border border-border bg-card p-6 text-card-foreground shadow-sm';

const BUTTON = 'inline-flex h-9 items-center justify-center gap-2 rounded-md px-4 font-medium disabled:opacity-60';

export const BUTTONS = {
  primary: `${BUTTON} bg-primary text-primary-foreground hover:bg-primary-hover`,
  secondary: `${BUTTON} border border-border bg-card hover:bg-accent`,
  destructive: `${BUTTON} bg-destructive text-destructive-foreground`,
} as const;

export type ButtonKind = keyof typeof BUTTONS;

export const INPUT = 'h-9 w-full rounded-md border border-input bg-background px-3 font-mono text-code';

export const LABEL = 'grid gap-1';

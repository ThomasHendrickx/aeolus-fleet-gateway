/**
 * A switch for one place of one job (the routing mockup): on or off, small;
 * Bridge's is on and cannot be turned, said beside it as Always; Slack's for
 * everything else, while off, says Bots only beside it.
 */
export function RoutingSwitch({
  isOn,
  label,
  isDisabled,
  isBusy = false,
  aside,
  testId,
  onTurn,
}: {
  isOn: boolean;
  label: string;
  isDisabled: boolean;
  isBusy?: boolean;
  aside?: string;
  testId: string;
  onTurn?: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <button
        type="button"
        role="switch"
        aria-checked={isOn}
        aria-label={label}
        aria-busy={isBusy}
        disabled={isDisabled}
        data-testid={testId}
        onClick={onTurn}
        className="group inline-flex h-4 w-7 shrink-0 items-center rounded-full bg-input p-0.5 aria-checked:bg-primary disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span aria-hidden className="size-3 rounded-full bg-card shadow-sm transition-transform group-aria-checked:translate-x-3" />
      </button>
      {aside === undefined ? null : <span className="text-caption text-muted-foreground">{aside}</span>}
    </span>
  );
}

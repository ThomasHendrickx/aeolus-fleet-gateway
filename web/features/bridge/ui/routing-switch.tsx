import { Switch } from '@aeolus-fleet/ui';

/**
 * A switch for one place of one job (the routing mockup): the fleet's shared
 * switch, on or off; Bridge's is on and cannot be turned, said beside it as
 * Always; Slack's for everything else, while off, says Bots only beside it.
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
      <Switch checked={isOn} aria-label={label} aria-busy={isBusy} disabled={isDisabled} data-testid={testId} {...(onTurn === undefined ? {} : { onCheckedChange: onTurn })} />
      {aside === undefined ? null : <span className="text-caption text-muted-foreground">{aside}</span>}
    </span>
  );
}

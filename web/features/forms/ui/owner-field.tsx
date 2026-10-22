import { INPUT, LABEL } from './look';

/** A ship a party's owner may be picked from, by its name. */
export interface OwnerChoice {
  shipId: string;
  name: string;
}

/**
 * The owner of a party, picked by name from the ships the fleet takes as an
 * owner. The owner it has now stays a choice, though the fleet no longer
 * lists it, so saving leaves it as it is.
 */
export function OwnerField({ choices, current, help }: { choices: readonly OwnerChoice[]; current: OwnerChoice | null; help: string }) {
  const shown = current === null || choices.some((choice) => choice.shipId === current.shipId) ? choices : [current, ...choices];
  return (
    <label className={LABEL}>
      <span>Owner</span>
      <select className={INPUT} name="ownerShipId" defaultValue={current?.shipId ?? ''} required data-testid="owner-field">
        {current === null ? (
          <option value="" disabled>
            Pick its owner
          </option>
        ) : null}
        {shown.map((choice) => (
          <option key={choice.shipId} value={choice.shipId}>
            {choice.name}
          </option>
        ))}
      </select>
      <span className="text-muted-foreground">{help}</span>
    </label>
  );
}

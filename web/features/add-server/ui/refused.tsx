import { Outcome } from '../../forms/ui/outcome';

/** Why the API refused a step, said on that step; nothing while it was not refused. */
export function Refused({ refusal }: { refusal: string | undefined }) {
  return refusal === undefined ? null : <Outcome state={{ kind: 'refused', message: refusal }} />;
}

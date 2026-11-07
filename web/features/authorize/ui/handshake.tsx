import { Avatar } from '@aeolus-fleet/ui';
import { ArrowLeftRight } from 'lucide-react';
import { AppMark } from '../../frame/ui/app-mark';

/** Who meets whom: the outside party's mark and name, and the fleet's mark, side by side. */
export function Handshake({ partyName }: { partyName: string }) {
  return (
    <div data-testid="authorize-handshake" className="flex items-center justify-center gap-3 text-caption">
      <figure className="grid justify-items-center gap-1">
        <Avatar kind="ship" size={36} name={partyName} className="size-10 border border-border" />
        <figcaption>{partyName}</figcaption>
      </figure>
      <ArrowLeftRight aria-hidden className="size-4 text-muted-foreground" />
      <figure className="grid justify-items-center gap-1">
        <AppMark size={36} className="size-10 rounded-md [&_svg]:size-6" />
        <figcaption>Aeolus</figcaption>
      </figure>
    </div>
  );
}

import { UserRound } from 'lucide-react';

/** argo's mark (argo-inbox mockups): argo's figure on the highlight, beside what is argo's and not the person's own. */
export function ArgoMark({ className = '' }: { className?: string }) {
  return (
    <span aria-hidden="true" className={`inline-flex size-5 shrink-0 items-center justify-center rounded-sm bg-highlight text-primary ${className}`}>
      <UserRound className="size-3" />
    </span>
  );
}

import type { ArgoInboxNoticeWords } from '../services/argo-inbox-notice';

/** Bridge home's notice that argo has not let the gateway read argo's inbox, with the guide to the read rule argo adds. */
export function ArgoInboxNotice({ notice }: { notice: ArgoInboxNoticeWords }) {
  return (
    <section role="status" data-testid="bridge-argo-inbox-notice" className="flex flex-col gap-1 rounded-md border border-tone-attention-border bg-tone-attention-bg px-3 py-2 text-tone-attention-fg">
      <span className="font-semibold">{notice.title}</span>
      <span className="text-caption">{notice.body}</span>
      <a data-testid="bridge-argo-inbox-guide" href={notice.guide.href} target="_blank" rel="noreferrer" className="text-caption font-medium underline underline-offset-2">
        {notice.guide.label}
      </a>
    </section>
  );
}

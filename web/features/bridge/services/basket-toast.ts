/** What a toast says: what happened, then what it means. */
export interface ToastWords {
  readonly title: string;
  readonly description: string;
}

/** What the toast says once an answer is in the basket (basket.html): what went in, not sent, still waiting. */
export function putToastOf(option: number | null): ToastWords {
  return { title: option === null ? 'Your note alone in the basket' : `Option ${String(option)} in the basket`, description: 'Not sent. Still waiting on you until you send it.' };
}


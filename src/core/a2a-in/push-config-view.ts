import type { PushConfig } from './ports.js';

/** A push config as its client reads it back: never its token or authentication, which stay in the vault. */
export interface PushConfigView {
  taskId: string;
  id: string;
  url: string;
}

export const pushConfigViewOf = (config: PushConfig): PushConfigView => ({ taskId: config.taskId, id: config.id, url: config.url });

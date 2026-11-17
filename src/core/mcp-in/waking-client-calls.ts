/** A reply may wake the lease before its outbound call was kept. Look again after that durable save. */
import type { ClientCall } from './client-call.js';
import type { ClientCalls } from './ports.js';

export function createWakingClientCalls(calls: ClientCalls, saved: (call: Omit<ClientCall, 'replies'>) => Promise<void>): ClientCalls {
  return {
    ...calls,
    save: async (call) => {
      await calls.save(call);
      await saved(call);
    },
  };
}

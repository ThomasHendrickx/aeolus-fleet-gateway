/** The gateway's connection status is read without attempting to connect it. */
interface ConnectionReader {
  readonly connection: { readonly status: { readonly query: () => Promise<{ state: 'connected' | 'not-connected' }> } };
}

export async function readConnection(api: ConnectionReader): Promise<'connected' | 'disconnected' | 'unreadable'> {
  try {
    return (await api.connection.status.query()).state === 'not-connected' ? 'disconnected' : 'connected';
  } catch {
    return 'unreadable';
  }
}

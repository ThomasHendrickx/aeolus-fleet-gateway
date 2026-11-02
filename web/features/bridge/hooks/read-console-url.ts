import { readHeader } from '../../frame/hooks/read-header';

/** The fleet's console as the account's apps name it, where a ship's page and its Health show; undefined while it is not known. */
export async function readConsoleUrl(fleetId: string): Promise<string | undefined> {
  return (await readHeader())?.fleets.find(({ id }) => id === fleetId)?.apps.find(({ app }) => app === 'console')?.url;
}

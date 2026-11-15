import { idSchema, paletteListSchema, PALETTE_LIST_PATH, type PaletteList } from '@aeolus-fleet/common';
import { otherAppsPaletteOf, paletteOriginsOf, type AppPaletteGroup, type ReadPaletteList } from '@aeolus-fleet/common/rules';

import type { AccountApps } from '../../../web/features/frame/services/header-switchers';
import { appsListOf } from '../../../web/features/frame/services/header-switchers';

/**
 * The other apps' palette entries for Bridge (aeolus-fleet,
 * docs/design/header-across-apps.md, A2): the web app's server reads the
 * palette list of each app the signed-in account may open from the fleet in
 * view, and outside any fleet (the apps list the header's read took), and
 * keeps it a while by its origin (header design H4), never another fleet's
 * apps. Common's rule keeps only the entries the account may open. An app
 * that does not answer shows by its name alone.
 */

/** How long a list read is kept: an app's pages and actions change with its releases. */
const LIST_KEPT_MS = 5 * 60 * 1000;
/** How long Bridge waits for an app's list before showing the app by name. */
const LIST_TIMEOUT_MS = 1500;

const kept = new Map<string, { list: PaletteList | undefined; readAt: number }>();

const fleetIdSchema = idSchema('fleet');

async function paletteListAt(origin: string, now: number): Promise<PaletteList | undefined> {
  const held = kept.get(origin);
  if (held !== undefined && now - held.readAt < LIST_KEPT_MS) {
    return held.list;
  }
  let list: PaletteList | undefined;
  try {
    const response = await fetch(new URL(PALETTE_LIST_PATH, origin), { cache: 'no-store', signal: AbortSignal.timeout(LIST_TIMEOUT_MS) });
    const parsed = response.ok ? paletteListSchema.safeParse(await response.json()) : undefined;
    list = parsed?.success === true ? parsed.data : undefined;
  } catch {
    list = undefined;
  }
  kept.set(origin, { list, readAt: now });
  return list;
}

export async function readPaletteAcrossApps({ answer, fleetId }: { answer: AccountApps; fleetId: string }): Promise<AppPaletteGroup[]> {
  const list = appsListOf(answer);
  const inView = fleetIdSchema.safeParse(fleetId);
  if (list === undefined || !inView.success) {
    return [];
  }
  const now = Date.now();
  const origins = paletteOriginsOf({ list, fleetId: inView.data, openApp: 'gateway' });
  const paletteLists = (
    await Promise.all(
      origins.map(async (origin): Promise<ReadPaletteList | undefined> => {
        const read = await paletteListAt(origin, now);
        return read === undefined ? undefined : { origin, list: read };
      }),
    )
  ).filter((read) => read !== undefined);
  return otherAppsPaletteOf({ list, fleetId: inView.data, openApp: 'gateway', paletteLists });
}

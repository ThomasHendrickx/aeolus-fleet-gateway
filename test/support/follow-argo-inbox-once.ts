/**
 * Follows argo's inbox once through the gateway's own door, as its argo's
 * inbox round does, and writes what it answered as JSON: run in a process of
 * its own, so it runs on the common its environment names.
 */
import { idSchema } from '@aeolus-fleet/common';
import { z } from 'zod';

import { createArgoInboxDoor } from '../../src/adapters/fleet/argo-inbox-door.js';

/** Longer than a follow that waits for nothing to change: that one answers too late. */
const FOLLOW_TIMEOUT_MS = 30_000;

const [fleetUrl = '', crewToken = '', argo = '', afterSeq = ''] = process.argv.slice(2);
const changes = await createArgoInboxDoor({ fleetUrl }).changes(crewToken, { argo: idSchema('ship').parse(argo), afterSeq: z.coerce.number().int().parse(afterSeq), signal: AbortSignal.timeout(FOLLOW_TIMEOUT_MS) });
process.stdout.write(JSON.stringify(changes));

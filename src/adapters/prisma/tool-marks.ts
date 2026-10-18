import type { ToolMarks } from '../../core/mcp-out/state-party.js';
import type { Db } from './client.js';

/** argo's repeatable marks, one row per marked tool: taking a mark off removes its row. */
export function createPrismaToolMarks(db: Db): ToolMarks {
  return {
    repeatable: async (fleetId, party) => new Set((await db.toolMark.findMany({ where: { fleetId, party }, select: { tool: true } })).map(({ tool }) => tool)),
    mark: async (fleetId, { party, tool, isRepeatable }) => {
      if (isRepeatable) {
        await db.toolMark.upsert({ where: { fleetId_party_tool: { fleetId, party, tool } }, create: { fleetId, party, tool }, update: {} });
      } else {
        await db.toolMark.deleteMany({ where: { fleetId, party, tool } });
      }
    },
  };
}

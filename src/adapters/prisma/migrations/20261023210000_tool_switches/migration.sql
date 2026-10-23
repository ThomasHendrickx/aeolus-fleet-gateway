-- AlterTable: a server added before this has none kept, so every tool it lists stays on.
ALTER TABLE "parties" ADD COLUMN "tool_switches" JSONB;

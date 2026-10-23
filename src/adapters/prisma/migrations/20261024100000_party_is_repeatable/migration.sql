-- An A2A agent's mark (A9): whether a message that died unconfirmed may be handed again.
ALTER TABLE "parties" ADD COLUMN "is_repeatable" BOOLEAN;

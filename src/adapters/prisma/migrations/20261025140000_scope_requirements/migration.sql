-- Gateway scopes (4.2): the scopes a calling ship needs, for the party as a whole and per tool, kept with the party, and the version they were last changed to.
ALTER TABLE "parties" ADD COLUMN "scope_requirements" JSONB;
ALTER TABLE "parties" ADD COLUMN "scope_requirements_version" INTEGER NOT NULL DEFAULT 0;

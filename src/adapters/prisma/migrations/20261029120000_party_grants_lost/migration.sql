-- Decision 0067, Q5: a grant a refresh answered invalid_grant is lost, kept with when and why until the person signs in again.
ALTER TABLE "party_grants" ADD COLUMN "lost_at" TIMESTAMPTZ(3),
ADD COLUMN "lost_why" TEXT;

-- A call fails at the deadline its capability states, and never by time when it states none (interop 3.4).
ALTER TABLE "client_calls" ALTER COLUMN "deadline_at" DROP NOT NULL;

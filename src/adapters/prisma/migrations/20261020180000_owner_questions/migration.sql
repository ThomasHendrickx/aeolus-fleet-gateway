-- CreateTable
CREATE TABLE "owner_questions" (
    "fleet_id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "question_id" TEXT NOT NULL,
    "asked_ship_id" TEXT,
    "asked_at" TIMESTAMPTZ(3),
    "withdrawn_at" TIMESTAMPTZ(3),

    CONSTRAINT "owner_questions_pkey" PRIMARY KEY ("fleet_id","request_id")
);

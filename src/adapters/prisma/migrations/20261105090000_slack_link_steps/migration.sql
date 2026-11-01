-- CreateTable
CREATE TABLE "slack_link_steps" (
    "fleet_id" TEXT NOT NULL,
    "person_ship_id" TEXT NOT NULL,
    "step_id" TEXT NOT NULL,
    "is_told" BOOLEAN NOT NULL DEFAULT false,
    "step_message_id" TEXT,

    CONSTRAINT "slack_link_steps_pkey" PRIMARY KEY ("fleet_id","person_ship_id")
);

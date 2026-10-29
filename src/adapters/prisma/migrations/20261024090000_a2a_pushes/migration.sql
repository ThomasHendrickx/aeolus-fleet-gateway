-- A2A in, push to the client's webhook (slice 4): each task's push configs, and the pushes still to make.
CREATE TABLE "a2a_push_configs" (
    "fleet_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "party" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "token" TEXT,
    "authentication" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL,
    "noticed_mark" TEXT NOT NULL,
    "is_following" BOOLEAN NOT NULL,

    CONSTRAINT "a2a_push_configs_pkey" PRIMARY KEY ("fleet_id","task_id","id")
);

CREATE INDEX "a2a_push_configs_fleet_id_party_is_following_idx" ON "a2a_push_configs"("fleet_id", "party", "is_following");

CREATE TABLE "a2a_pushes" (
    "push_id" SERIAL NOT NULL,
    "fleet_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "config_id" TEXT NOT NULL,
    "party" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL,
    "next_at" TIMESTAMP(3) NOT NULL,
    "state" TEXT NOT NULL,
    "reason" TEXT,
    "settled_at" TIMESTAMP(3),

    CONSTRAINT "a2a_pushes_pkey" PRIMARY KEY ("push_id")
);

CREATE INDEX "a2a_pushes_fleet_id_party_state_task_id_config_id_push_id_idx" ON "a2a_pushes"("fleet_id", "party", "state", "task_id", "config_id", "push_id");

ALTER TABLE "a2a_pushes" ADD CONSTRAINT "a2a_pushes_fleet_id_task_id_config_id_fkey" FOREIGN KEY ("fleet_id", "task_id", "config_id") REFERENCES "a2a_push_configs"("fleet_id", "task_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A2A in (decision 0060): a call may match no capability, its delivery is read from the fleet, and an A2A call belongs to a task.
ALTER TABLE "client_calls" ALTER COLUMN "capability" DROP NOT NULL;
ALTER TABLE "client_calls" ADD COLUMN "delivery_state" TEXT;
ALTER TABLE "client_calls" ADD COLUMN "delivery_since" TIMESTAMP(3);
ALTER TABLE "client_calls" ADD COLUMN "task_id" TEXT;
ALTER TABLE "client_calls" ADD COLUMN "task_message" TEXT;

CREATE INDEX "client_calls_fleet_id_task_id_idx" ON "client_calls"("fleet_id", "task_id");

CREATE TABLE "a2a_tasks" (
    "fleet_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "party" TEXT NOT NULL,
    "context_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "a2a_tasks_pkey" PRIMARY KEY ("fleet_id","task_id")
);

CREATE INDEX "a2a_tasks_fleet_id_party_created_at_task_id_idx" ON "a2a_tasks"("fleet_id", "party", "created_at" DESC, "task_id" DESC);

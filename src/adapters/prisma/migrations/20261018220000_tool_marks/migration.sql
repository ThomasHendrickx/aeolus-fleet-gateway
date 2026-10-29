-- CreateTable
CREATE TABLE "tool_marks" (
    "fleet_id" TEXT NOT NULL,
    "party" TEXT NOT NULL,
    "tool" TEXT NOT NULL,

    CONSTRAINT "tool_marks_pkey" PRIMARY KEY ("fleet_id","party","tool")
);

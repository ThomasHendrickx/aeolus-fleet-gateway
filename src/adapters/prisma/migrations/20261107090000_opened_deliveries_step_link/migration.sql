-- The link where a step is done, kept once the step is opened, so its row in Bridge leads there (aeolus-fleet#1535).
ALTER TABLE "opened_deliveries" ADD COLUMN "step_link" TEXT;

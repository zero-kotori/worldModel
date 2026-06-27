ALTER TABLE "AutomationWorkerConfig" ADD COLUMN "beliefIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "AutomationWorkerConfig" ADD COLUMN "sourceIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

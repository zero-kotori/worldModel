CREATE TABLE "AutomationWorkerConfig" (
  "id" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "intervalMs" INTEGER NOT NULL,
  "failureBackoffMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 2,
  "maxIntervalMs" INTEGER NOT NULL,
  "reviewOnly" BOOLEAN NOT NULL DEFAULT true,
  "maxObservations" INTEGER,
  "candidateThreshold" DOUBLE PRECISION,
  "autoConfirmThreshold" DOUBLE PRECISION,
  "bootstrapDefaultSources" BOOLEAN NOT NULL DEFAULT true,
  "forceAutoApply" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AutomationWorkerConfig_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AutomationWorkerConfig_enabled_updatedAt_idx" ON "AutomationWorkerConfig"("enabled", "updatedAt");

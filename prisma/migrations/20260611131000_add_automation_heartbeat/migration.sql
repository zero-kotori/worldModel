CREATE TYPE "AutomationHeartbeatStatus" AS ENUM ('RUNNING', 'IDLE', 'ERROR');

CREATE TABLE "AutomationHeartbeat" (
  "id" TEXT NOT NULL,
  "status" "AutomationHeartbeatStatus" NOT NULL,
  "heartbeatAt" TIMESTAMP(3) NOT NULL,
  "nextRunAt" TIMESTAMP(3),
  "intervalMs" INTEGER NOT NULL,
  "consecutiveFailureCount" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AutomationHeartbeat_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AutomationHeartbeat_status_heartbeatAt_idx" ON "AutomationHeartbeat"("status", "heartbeatAt");

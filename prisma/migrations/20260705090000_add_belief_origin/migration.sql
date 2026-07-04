CREATE TYPE "BeliefOrigin" AS ENUM ('INTERNAL', 'EXTERNAL');

ALTER TABLE "Belief" ADD COLUMN "origin" "BeliefOrigin" NOT NULL DEFAULT 'INTERNAL';

CREATE INDEX "Belief_origin_status_idx" ON "Belief"("origin", "status");

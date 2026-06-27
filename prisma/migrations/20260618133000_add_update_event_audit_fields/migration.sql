ALTER TABLE "BayesianUpdateEvent" ADD COLUMN "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "BayesianUpdateEvent" ADD COLUMN "explanations" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "BayesianUpdateEvent" ADD COLUMN "likelihoodRunIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "BeliefCategory" AS ENUM ('AI_TREND', 'INVESTMENT', 'TECH_TREND', 'CAREER', 'SOURCE_RELIABILITY');

-- CreateEnum
CREATE TYPE "ProbabilityMode" AS ENUM ('MUTUALLY_EXCLUSIVE', 'INDEPENDENT');

-- CreateEnum
CREATE TYPE "BeliefStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "HypothesisStatus" AS ENUM ('ACTIVE', 'PAUSED', 'RESOLVED_TRUE', 'RESOLVED_FALSE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ObservationSourceKind" AS ENUM ('MANUAL', 'RSS', 'WEB_PAGE', 'SEARCH', 'GITHUB', 'HUGGING_FACE', 'GDELT', 'PREDICTION_MARKET', 'SOCIAL');

-- CreateEnum
CREATE TYPE "ObservationStatus" AS ENUM ('PENDING', 'DUPLICATE', 'UNKNOWN', 'CONFIRMED', 'REJECTED');

-- CreateEnum
CREATE TYPE "EvidenceConfirmationMode" AS ENUM ('MANUAL', 'AUTO');

-- CreateEnum
CREATE TYPE "EvidenceStatus" AS ENUM ('ACTIVE', 'SUPERSEDED', 'REJECTED');

-- CreateEnum
CREATE TYPE "EvidenceDirection" AS ENUM ('SUPPORTS', 'OPPOSES', 'MIXED', 'NEUTRAL');

-- CreateEnum
CREATE TYPE "UpdateMode" AS ENUM ('PREVIEW', 'APPLIED', 'ROLLBACK');

-- CreateEnum
CREATE TYPE "UpdateStatus" AS ENUM ('APPLIED', 'ROLLED_BACK');

-- CreateEnum
CREATE TYPE "ObservationRunStatus" AS ENUM ('SUCCESS', 'FAILED', 'DRY_RUN');

-- CreateEnum
CREATE TYPE "ModelArtifactKind" AS ENUM ('LIGHTWEIGHT', 'LLM', 'DEEP_ADAPTER');

-- CreateTable
CREATE TABLE "Belief" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" "BeliefCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "probabilityMode" "ProbabilityMode" NOT NULL,
    "status" "BeliefStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Belief_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Hypothesis" (
    "id" TEXT NOT NULL,
    "beliefId" TEXT NOT NULL,
    "proposition" TEXT NOT NULL,
    "notes" TEXT NOT NULL,
    "priorProbability" DOUBLE PRECISION NOT NULL,
    "currentProbability" DOUBLE PRECISION NOT NULL,
    "strength" DOUBLE PRECISION NOT NULL,
    "status" "HypothesisStatus" NOT NULL DEFAULT 'ACTIVE',
    "startsAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "expiryCondition" TEXT,
    "resolvedOutcome" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Hypothesis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ObservationSource" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "ObservationSourceKind" NOT NULL,
    "url" TEXT,
    "adapter" TEXT NOT NULL,
    "credentialRef" TEXT,
    "credibility" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "autoConfirm" BOOLEAN NOT NULL DEFAULT false,
    "autoConfirmThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.85,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ObservationSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Observation" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "url" TEXT,
    "author" TEXT,
    "publishedAt" TIMESTAMP(3),
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "normalizedHash" TEXT,
    "semanticKey" TEXT,
    "status" "ObservationStatus" NOT NULL DEFAULT 'PENDING',
    "duplicateOfId" TEXT,
    "credibility" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "metadata" JSONB NOT NULL,

    CONSTRAINT "Observation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evidence" (
    "id" TEXT NOT NULL,
    "observationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "url" TEXT,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmationMode" "EvidenceConfirmationMode" NOT NULL,
    "credibility" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "status" "EvidenceStatus" NOT NULL DEFAULT 'ACTIVE',
    "metadata" JSONB NOT NULL,

    CONSTRAINT "Evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceHypothesisLink" (
    "id" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "hypothesisId" TEXT NOT NULL,
    "direction" "EvidenceDirection" NOT NULL,
    "relevance" DOUBLE PRECISION NOT NULL,
    "likelihoodRatio" DOUBLE PRECISION NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "rationale" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceHypothesisLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LikelihoodRun" (
    "id" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "hypothesisId" TEXT NOT NULL,
    "ensembleLikelihoodRatio" DOUBLE PRECISION NOT NULL,
    "ensembleConfidence" DOUBLE PRECISION NOT NULL,
    "estimatorOutputs" JSONB NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LikelihoodRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BayesianUpdateEvent" (
    "id" TEXT NOT NULL,
    "beliefId" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "likelihoodRunId" TEXT,
    "priorSnapshot" JSONB NOT NULL,
    "posteriorSnapshot" JSONB NOT NULL,
    "mode" "UpdateMode" NOT NULL,
    "status" "UpdateStatus" NOT NULL DEFAULT 'APPLIED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rolledBackAt" TIMESTAMP(3),

    CONSTRAINT "BayesianUpdateEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ObservationRun" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT,
    "status" "ObservationRunStatus" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "deduplicatedCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,

    CONSTRAINT "ObservationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelArtifact" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "ModelArtifactKind" NOT NULL,
    "version" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "metrics" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Belief_category_status_idx" ON "Belief"("category", "status");

-- CreateIndex
CREATE INDEX "Hypothesis_beliefId_status_idx" ON "Hypothesis"("beliefId", "status");

-- CreateIndex
CREATE INDEX "ObservationSource_kind_enabled_idx" ON "ObservationSource"("kind", "enabled");

-- CreateIndex
CREATE INDEX "Observation_status_observedAt_idx" ON "Observation"("status", "observedAt");

-- CreateIndex
CREATE INDEX "Observation_url_idx" ON "Observation"("url");

-- CreateIndex
CREATE INDEX "Observation_normalizedHash_idx" ON "Observation"("normalizedHash");

-- CreateIndex
CREATE INDEX "Observation_semanticKey_idx" ON "Observation"("semanticKey");

-- CreateIndex
CREATE UNIQUE INDEX "Evidence_observationId_key" ON "Evidence"("observationId");

-- CreateIndex
CREATE INDEX "Evidence_status_confirmedAt_idx" ON "Evidence"("status", "confirmedAt");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceHypothesisLink_evidenceId_hypothesisId_key" ON "EvidenceHypothesisLink"("evidenceId", "hypothesisId");

-- CreateIndex
CREATE INDEX "LikelihoodRun_evidenceId_hypothesisId_idx" ON "LikelihoodRun"("evidenceId", "hypothesisId");

-- CreateIndex
CREATE INDEX "ModelArtifact_kind_enabled_idx" ON "ModelArtifact"("kind", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "ModelArtifact_name_version_key" ON "ModelArtifact"("name", "version");

-- AddForeignKey
ALTER TABLE "Hypothesis" ADD CONSTRAINT "Hypothesis_beliefId_fkey" FOREIGN KEY ("beliefId") REFERENCES "Belief"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Observation" ADD CONSTRAINT "Observation_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "ObservationSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Observation" ADD CONSTRAINT "Observation_duplicateOfId_fkey" FOREIGN KEY ("duplicateOfId") REFERENCES "Observation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "Observation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceHypothesisLink" ADD CONSTRAINT "EvidenceHypothesisLink_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "Evidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceHypothesisLink" ADD CONSTRAINT "EvidenceHypothesisLink_hypothesisId_fkey" FOREIGN KEY ("hypothesisId") REFERENCES "Hypothesis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LikelihoodRun" ADD CONSTRAINT "LikelihoodRun_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "Evidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LikelihoodRun" ADD CONSTRAINT "LikelihoodRun_hypothesisId_fkey" FOREIGN KEY ("hypothesisId") REFERENCES "Hypothesis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BayesianUpdateEvent" ADD CONSTRAINT "BayesianUpdateEvent_beliefId_fkey" FOREIGN KEY ("beliefId") REFERENCES "Belief"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BayesianUpdateEvent" ADD CONSTRAINT "BayesianUpdateEvent_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "Evidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BayesianUpdateEvent" ADD CONSTRAINT "BayesianUpdateEvent_likelihoodRunId_fkey" FOREIGN KEY ("likelihoodRunId") REFERENCES "LikelihoodRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObservationRun" ADD CONSTRAINT "ObservationRun_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "ObservationSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;


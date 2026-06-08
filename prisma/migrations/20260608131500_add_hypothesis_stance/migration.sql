-- CreateEnum
CREATE TYPE "HypothesisStance" AS ENUM ('SUPPORTS', 'OPPOSES');

-- AlterTable
ALTER TABLE "Hypothesis" ADD COLUMN "stance" "HypothesisStance" NOT NULL DEFAULT 'SUPPORTS';

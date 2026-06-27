import path from "node:path";
import { runTrainPrepareCommand } from "../../../scripts/train_prepare";
import { readModelArtifactImportInput } from "@/server/training/model-artifact-import";
import { runLightweightTrainingCommand, type LightweightTrainingResult } from "@/server/training/lightweight-training";
import type { ModelArtifactRecord, WorldModelServices } from "@/server/services/types";

export type LocalLightweightTrainingPipelineResult = {
  preparedSampleCount: number;
  sourceCounts: Record<string, number>;
  trained: boolean;
  artifactPath: string;
  training: LightweightTrainingResult;
  artifact: ModelArtifactRecord;
};

type LocalTrainingDependencies = {
  outputDir?: string;
  prepare?: typeof runTrainPrepareCommand;
  train?: typeof runLightweightTrainingCommand;
  readInput?: typeof readModelArtifactImportInput;
};

export async function runLocalLightweightTrainingPipeline(
  services: Pick<WorldModelServices, "models">,
  dependencies: LocalTrainingDependencies = {}
): Promise<LocalLightweightTrainingPipelineResult> {
  const prepare = dependencies.prepare ?? runTrainPrepareCommand;
  const train = dependencies.train ?? runLightweightTrainingCommand;
  const readInput = dependencies.readInput ?? readModelArtifactImportInput;
  const outputDir = dependencies.outputDir?.trim()
    ? path.resolve(process.cwd(), dependencies.outputDir)
    : path.join(process.cwd(), "model-artifacts");
  const prepared = await prepare({ mode: "prisma", outputDir });
  const training = await train({ cwd: process.cwd(), outputDir });
  const input = await readInput(training.artifactPath, {
    name: "lightweight-local",
    kind: "LIGHTWEIGHT",
    version: "0.1.0",
    enabled: true,
    fallbackMetrics: {
      importedBy: "admin-train-lightweight",
      sampleCount: prepared.sampleCount,
      sourceCounts: prepared.sourceCounts
    }
  });
  const artifact = await services.models.importArtifact(input);

  return {
    preparedSampleCount: prepared.sampleCount,
    sourceCounts: prepared.sourceCounts,
    trained: training.trained,
    artifactPath: training.artifactPath,
    training,
    artifact
  };
}

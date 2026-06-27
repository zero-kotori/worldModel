import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ImportArtifactInput, ModelArtifactKind } from "@/server/services/types";

export type ModelArtifactFile = {
  name?: string;
  kind?: ModelArtifactKind;
  version?: string;
  trained?: boolean;
  metrics?: Record<string, unknown>;
};

export type ModelArtifactImportOverrides = {
  name?: string;
  kind?: ModelArtifactKind;
  version?: string;
  enabled?: boolean;
  fallbackMetrics?: Record<string, unknown>;
};

export function resolveModelArtifactPath(artifactPath: string) {
  const trimmed = artifactPath.trim();
  if (!trimmed) throw new Error("Model artifact path is required.");
  return path.isAbsolute(trimmed) ? path.normalize(trimmed) : path.resolve(process.cwd(), trimmed);
}

function relativeArtifactPath(artifactPath: string) {
  return path.relative(process.cwd(), resolveModelArtifactPath(artifactPath)).replaceAll("\\", "/");
}

function artifactMetrics(artifact: ModelArtifactFile, fallbackMetrics: Record<string, unknown> = {}) {
  const metrics = { ...fallbackMetrics, ...(artifact.metrics ?? {}) };
  if (typeof artifact.trained === "boolean") metrics.trained = artifact.trained;
  return metrics;
}

export function modelArtifactImportInput(
  artifactPath: string,
  artifact: ModelArtifactFile,
  overrides: ModelArtifactImportOverrides = {}
): ImportArtifactInput {
  return {
    name: overrides.name?.trim() || artifact.name || path.basename(artifactPath, path.extname(artifactPath)),
    kind: overrides.kind ?? artifact.kind ?? "LIGHTWEIGHT",
    version: overrides.version?.trim() || artifact.version || "0.1.0",
    path: relativeArtifactPath(artifactPath),
    metrics: artifactMetrics(artifact, overrides.fallbackMetrics),
    enabled: overrides.enabled ?? true
  };
}

export async function readModelArtifactImportInput(
  artifactPath: string,
  overrides: ModelArtifactImportOverrides = {}
): Promise<ImportArtifactInput> {
  const resolvedPath = resolveModelArtifactPath(artifactPath);
  try {
    const artifact = JSON.parse(await readFile(resolvedPath, "utf8")) as ModelArtifactFile;
    return modelArtifactImportInput(resolvedPath, artifact, overrides);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Model artifact path does not exist: ${artifactPath}`);
    }
    throw error;
  }
}

import type { ImportArtifactInput } from "@/server/services/types";

// Guards that keep demo/untrained artifacts out of the real likelihood model
// registry (AGENTS.md §5). Extracted from the service factory.

function hasDemoArtifactMarker(value: unknown) {
  return typeof value === "string" && /(^|[^a-z0-9])demo([^a-z0-9]|$)/i.test(value);
}

function modelArtifactSampleCount(metrics: Record<string, unknown>) {
  const value = metrics.sampleCount;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function modelArtifactExplicitlyUntrained(metrics: Record<string, unknown>) {
  return metrics.trained === false;
}

export function assertImportableModelArtifact(input: ImportArtifactInput) {
  if (hasDemoArtifactMarker(input.name) || hasDemoArtifactMarker(input.path)) {
    throw new Error("Demo model artifacts cannot be imported as real likelihood models.");
  }

  if (input.kind !== "LIGHTWEIGHT") return;
  if (modelArtifactExplicitlyUntrained(input.metrics)) {
    throw new Error("Untrained lightweight model artifacts cannot be imported.");
  }
  const sampleCount = modelArtifactSampleCount(input.metrics);
  if (sampleCount === null || sampleCount <= 0) {
    throw new Error("Lightweight model artifacts must report real training samples with metrics.sampleCount greater than 0.");
  }
}

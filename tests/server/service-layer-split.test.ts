import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function readProjectFile(relativePath: string) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

describe("service layer split", () => {
  it("keeps each service aggregate in its own module", () => {
    const serviceModules = [
      "src/server/services/belief-service.ts",
      "src/server/services/observation-service.ts",
      "src/server/services/evidence-service.ts",
      "src/server/services/likelihood-service.ts",
      "src/server/services/update-service.ts",
      "src/server/services/source-service.ts",
      "src/server/services/automation-service.ts",
      "src/server/services/model-service.ts"
    ];

    expect(serviceModules.filter((file) => !existsSync(path.join(root, file)))).toEqual([]);
  });

  it("keeps world-model-services as a small composition root", () => {
    const source = readProjectFile("src/server/services/world-model-services.ts");
    const lines = source.split(/\r?\n/).filter((line) => line.trim()).length;

    expect(lines).toBeLessThanOrEqual(180);
    expect(source).toContain("createBeliefService");
    expect(source).toContain("createObservationService");
    expect(source).toContain("createEvidenceService");
    expect(source).toContain("createLikelihoodService");
    expect(source).toContain("createUpdateService");
    expect(source).toContain("createSourceService");
    expect(source).toContain("createAutomationService");
    expect(source).toContain("createModelService");
    expect(source).not.toContain("async function runSource(");
    expect(source).not.toContain("async function confirmObservation(");
    expect(source).not.toContain("async function createPreview(");
    expect(source).not.toContain("async function runEvidenceLoop(");
  });
});

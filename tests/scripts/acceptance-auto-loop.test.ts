import { createInMemoryWorldModelStore } from "@/server/services/in-memory-store";
import { createWorldModelServices } from "@/server/services/world-model-services";
import { parseAcceptanceAutoLoopArgs, runAcceptanceAutoLoop, runAcceptanceAutoLoopCommand } from "../../scripts/acceptance_auto_loop";

describe("acceptance auto loop script", () => {
  it("runs the automated evidence loop end to end", async () => {
    const requestedUrls: string[] = [];
    const services = createWorldModelServices(createInMemoryWorldModelStore(), {
      sourceAdapterDependencies: {
        async fetchText(url) {
          requestedUrls.push(url);
          return [
            "<html>",
            "<head><title>AI agents accelerate engineering teams acceptance evidence</title></head>",
            "<body>AI agents accelerate engineering teams acceptance evidence.</body>",
            "</html>"
          ].join("");
        }
      }
    });

    const result = await runAcceptanceAutoLoop(services, { runId: "unit-test" });

    expect(requestedUrls).toHaveLength(1);
    expect(decodeURIComponent(requestedUrls[0])).toContain("AI agents accelerate engineering teams");
    expect(result.loop).toMatchObject({
      queryCount: 1,
      sourceRunCount: 1,
      itemCount: 1,
      candidateCount: 1,
      autoAppliedCount: 1,
      reviewCount: 0,
      lowImpactCount: 0,
      unmatchedCount: 0,
      failureCount: 0
    });
    expect(result.beforeProbability).toBe(0.35);
    expect(result.afterProbability).toBeGreaterThan(result.beforeProbability);
    expect(result.evidenceCount).toBe(1);
    expect(result.updateCount).toBe(1);
    expect(result).toMatchObject({
      beliefCode: expect.stringMatching(/^B-\d{3}$/),
      hypothesisCode: expect.stringMatching(/^H-\d{3}$/),
      sourceCode: expect.stringMatching(/^S-\d{3}$/),
      evidenceCodes: [expect.stringMatching(/^E-\d{3}$/)],
      observationCodes: [expect.stringMatching(/^O-\d{3}$/)],
      updateCodes: [expect.stringMatching(/^U-\d{3}$/)]
    });
    expect(result.beliefCode).not.toBe(result.beliefId);
    expect(result.hypothesisCode).not.toBe(result.hypothesisId);
  });

  it("parses an explicit in-memory store mode for local acceptance runs", () => {
    expect(parseAcceptanceAutoLoopArgs(["node", "acceptance_auto_loop.ts", "--store", "memory"], {})).toMatchObject({
      storeMode: "memory"
    });
    expect(parseAcceptanceAutoLoopArgs(["node", "acceptance_auto_loop.ts"], { WORLDMODEL_ACCEPTANCE_STORE: "memory" })).toMatchObject({
      storeMode: "memory"
    });
  });

  it("runs the acceptance command with an in-memory store without requiring Postgres", async () => {
    const result = await runAcceptanceAutoLoopCommand({
      storeMode: "memory",
      runId: "unit-test-memory-command"
    });

    expect(result.storeMode).toBe("memory");
    expect(result.loop).toMatchObject({
      queryCount: 1,
      sourceRunCount: 1,
      itemCount: 1,
      candidateCount: 1,
      autoAppliedCount: 1,
      failureCount: 0
    });
    expect(result.afterProbability).toBeGreaterThan(result.beforeProbability);
  });
});

import { createInMemoryWorldModelStore } from "@/server/services/in-memory-store";
import { createWorldModelServices } from "@/server/services/world-model-services";
import { runAcceptanceAutoLoop } from "../../scripts/acceptance_auto_loop";

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
      failureCount: 0
    });
    expect(result.beforeProbability).toBe(0.35);
    expect(result.afterProbability).toBeGreaterThan(result.beforeProbability);
    expect(result.evidenceCount).toBe(1);
    expect(result.updateCount).toBe(1);
  });
});

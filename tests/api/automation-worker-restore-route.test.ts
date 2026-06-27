import { vi } from "vitest";

const getWorldModelServices = vi.fn();
const getEvidenceLoopWorkerController = vi.fn();

vi.mock("@/server/services", () => ({
  getWorldModelServices
}));

vi.mock("@/server/automation/local-worker", () => ({
  getEvidenceLoopWorkerController
}));

describe("automation worker restore route", () => {
  beforeEach(() => {
    getWorldModelServices.mockReset();
    getEvidenceLoopWorkerController.mockReset();
    process.env.WORLDMODEL_ACCESS_MODE = "standalone";
  });

  it("restores all enabled persisted workers into the local runtime", async () => {
    const automation = {
      listWorkerConfigs: vi.fn(),
      recordHeartbeat: vi.fn(),
      runEvidenceLoop: vi.fn()
    };
    const runtime = [
      {
        workerId: "default",
        running: true,
        nextRunAt: new Date("2026-06-12T01:15:00.000Z"),
        consecutiveFailureCount: 0
      }
    ];
    const restoreEnabled = vi.fn().mockResolvedValue(runtime);
    getWorldModelServices.mockReturnValue({ automation });
    getEvidenceLoopWorkerController.mockReturnValue({ restoreEnabled });
    const { POST } = await import("@/app/api/automation/worker/restore/route");

    const response = await POST(new Request("http://localhost/api/automation/worker/restore", { method: "POST" }));

    await expect(response.json()).resolves.toEqual({ runtime: JSON.parse(JSON.stringify(runtime)) });
    expect(response.status).toBe(200);
    expect(restoreEnabled).toHaveBeenCalledWith({ automation });
  });
});

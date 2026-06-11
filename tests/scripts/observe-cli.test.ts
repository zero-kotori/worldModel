import { parseObserveArgs, runRepeatedTask } from "../../scripts/observe";

describe("observe CLI options", () => {
  it("bootstraps default sources for plain loop runs without an explicit source", () => {
    const options = parseObserveArgs(["node", "observe.ts", "--loop"]);

    expect(options.loop).toBe(true);
    expect(options.sourceId).toBeUndefined();
    expect(options.loopOptions.bootstrapDefaultSources).toBe(true);
  });

  it("does not bootstrap defaults when a loop targets an explicit source", () => {
    const options = parseObserveArgs(["node", "observe.ts", "--loop", "--source", "source_1"]);

    expect(options.sourceId).toBe("source_1");
    expect(options.loopOptions.bootstrapDefaultSources).toBe(false);
  });

  it("allows default source bootstrapping to be disabled explicitly", () => {
    const options = parseObserveArgs(["node", "observe.ts", "--loop", "--no-bootstrap-default-sources"]);

    expect(options.loopOptions.bootstrapDefaultSources).toBe(false);
  });

  it("parses forced auto-apply loop options", () => {
    const options = parseObserveArgs([
      "node",
      "observe.ts",
      "--loop",
      "--review-only",
      "--force-auto-apply",
      "--max-observations",
      "3",
      "--candidate-threshold",
      "0.25",
      "--threshold",
      "0.75"
    ]);

    expect(options.loopOptions).toMatchObject({
      reviewOnly: true,
      forceAutoApply: true,
      maxObservations: 3,
      candidateThreshold: 0.25,
      autoConfirmThreshold: 0.75
    });
  });

  it("parses repeat automation options for unattended evidence loops", () => {
    const options = parseObserveArgs([
      "node",
      "observe.ts",
      "--loop",
      "--repeat",
      "--interval-seconds",
      "120",
      "--iterations",
      "3"
    ]);

    expect(options.repeat).toBe(true);
    expect(options.intervalMs).toBe(120_000);
    expect(options.iterations).toBe(3);
  });

  it("repeats a task with waits only between iterations", async () => {
    const calls: number[] = [];
    const waits: number[] = [];

    const results = await runRepeatedTask(
      async (iteration) => {
        calls.push(iteration);
        return { iteration };
      },
      {
        repeat: true,
        iterations: 3,
        intervalMs: 5000,
        wait: async (ms) => {
          waits.push(ms);
        }
      }
    );

    expect(calls).toEqual([1, 2, 3]);
    expect(waits).toEqual([5000, 5000]);
    expect(results).toEqual([{ iteration: 1 }, { iteration: 2 }, { iteration: 3 }]);
  });

  it("can repeat without accumulating task results for long-running workers", async () => {
    const calls: number[] = [];

    const results = await runRepeatedTask(
      async (iteration) => {
        calls.push(iteration);
        return { iteration };
      },
      {
        repeat: true,
        iterations: 2,
        intervalMs: 0,
        collectResults: false,
        wait: async () => {}
      }
    );

    expect(calls).toEqual([1, 2]);
    expect(results).toEqual([]);
  });
});

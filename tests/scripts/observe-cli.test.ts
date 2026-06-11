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
      "--worker-id",
      "daily-loop",
      "--interval-seconds",
      "120",
      "--failure-backoff-multiplier",
      "3",
      "--max-interval-seconds",
      "600",
      "--iterations",
      "3"
    ]);

    expect(options.repeat).toBe(true);
    expect(options.workerId).toBe("daily-loop");
    expect(options.intervalMs).toBe(120_000);
    expect(options.failureBackoffMultiplier).toBe(3);
    expect(options.maxIntervalMs).toBe(600_000);
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

  it("backs off after failed task results and resets after success", async () => {
    const waits: number[] = [];
    const outcomes = [{ failureCount: 1 }, { failureCount: 0 }, { failureCount: 1 }];

    await runRepeatedTask(
      async (iteration) => outcomes[iteration - 1],
      {
        repeat: true,
        iterations: 3,
        intervalMs: 1000,
        failureBackoffMultiplier: 2,
        maxIntervalMs: 5000,
        isFailure: (result) => result.failureCount > 0,
        wait: async (ms) => {
          waits.push(ms);
        }
      }
    );

    expect(waits).toEqual([2000, 1000]);
  });

  it("continues after task errors when configured and backs off before retrying", async () => {
    const waits: number[] = [];
    const errors: string[] = [];
    const calls: number[] = [];

    const results = await runRepeatedTask(
      async (iteration) => {
        calls.push(iteration);
        if (iteration === 1) throw new Error("temporary failure");
        return { ok: true };
      },
      {
        repeat: true,
        iterations: 2,
        intervalMs: 1000,
        failureBackoffMultiplier: 2,
        continueOnError: true,
        onError: async (error) => {
          errors.push(error instanceof Error ? error.message : String(error));
        },
        wait: async (ms) => {
          waits.push(ms);
        }
      }
    );

    expect(calls).toEqual([1, 2]);
    expect(errors).toEqual(["temporary failure"]);
    expect(waits).toEqual([2000]);
    expect(results).toEqual([{ ok: true }]);
  });

  it("reports repeat state with the next delay before waiting", async () => {
    const waits: number[] = [];
    const states: Array<{
      iteration: number;
      failed: boolean;
      consecutiveFailures: number;
      nextDelayMs?: number;
    }> = [];

    await runRepeatedTask(
      async (iteration) => ({ failureCount: iteration === 1 ? 1 : 0 }),
      {
        repeat: true,
        iterations: 2,
        intervalMs: 1000,
        failureBackoffMultiplier: 2,
        isFailure: (result) => result.failureCount > 0,
        onIterationComplete: async (state) => {
          states.push({
            iteration: state.iteration,
            failed: state.failed,
            consecutiveFailures: state.consecutiveFailures,
            nextDelayMs: state.nextDelayMs
          });
        },
        wait: async (ms) => {
          waits.push(ms);
        }
      }
    );

    expect(states).toEqual([
      { iteration: 1, failed: true, consecutiveFailures: 1, nextDelayMs: 2000 },
      { iteration: 2, failed: false, consecutiveFailures: 0, nextDelayMs: undefined }
    ]);
    expect(waits).toEqual([2000]);
  });
});

import { parseObserveArgs } from "../../scripts/observe";

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
});

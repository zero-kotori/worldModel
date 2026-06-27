import { createDatasetFetchError, fetchJsonWithFallback, fetchTextWithFallback } from "@/server/training/training-fetch";

describe("training dataset fetch helpers", () => {
  it("wraps remote fetch failures with dataset source and split context", () => {
    const cause = new Error("TLS connection closed");

    const error = createDatasetFetchError(
      {
        source: "scifact",
        dataset: "allenai/scifact_entailment",
        config: "default",
        split: "train"
      },
      cause
    );

    expect(error.message).toContain("scifact");
    expect(error.message).toContain("allenai/scifact_entailment");
    expect(error.message).toContain("train");
    expect(error.message).toContain("TLS connection closed");
    expect(error.cause).toBe(cause);
  });

  it("uses curl before PowerShell fallback on Windows", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async () => {
      throw new Error("fetch failed");
    });
    const execFileImpl = vi.fn(async (file: string) => {
      calls.push(file);
      if (file === "curl.exe") {
        return { stdout: "{\"ok\":true}" };
      }
      throw new Error("PowerShell should not be needed when curl works");
    });

    const result = await fetchJsonWithFallback(new URL("https://example.test/data.json"), {
      attempts: 1,
      platform: "win32",
      fetchImpl,
      execFileImpl
    });

    expect(result).toEqual({ ok: true });
    expect(calls).toEqual(["curl.exe"]);
  });

  it("uses curl before PowerShell fallback for raw text on Windows", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async () => {
      throw new Error("fetch failed");
    });
    const execFileImpl = vi.fn(async (file: string) => {
      calls.push(file);
      if (file === "curl.exe") {
        return { stdout: "line one\nline two\n" };
      }
      throw new Error("PowerShell should not be needed when curl works");
    });

    const result = await fetchTextWithFallback(new URL("https://example.test/wiki.jsonl"), {
      attempts: 1,
      platform: "win32",
      fetchImpl,
      execFileImpl
    });

    expect(result).toBe("line one\nline two\n");
    expect(calls).toEqual(["curl.exe"]);
  });

  it("falls back to curl after a configured short HTTP timeout", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn(
        (_url: URL, init?: { signal?: AbortSignal }) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
          })
      );
      const execFileImpl = vi.fn(async (file: string) => {
        if (file === "curl.exe") return { stdout: "{\"ok\":true}" };
        throw new Error("PowerShell should not be needed when curl works");
      });

      const resultPromise = fetchJsonWithFallback(new URL("https://example.test/slow.json"), {
        attempts: 1,
        platform: "win32",
        fetchImpl,
        execFileImpl,
        httpTimeoutMs: 5
      });

      await vi.advanceTimersByTimeAsync(5);
      await Promise.resolve();

      await expect(Promise.race([resultPromise, Promise.resolve("pending")])).resolves.toEqual({ ok: true });
      expect(execFileImpl).toHaveBeenCalledWith("curl.exe", expect.any(Array), expect.any(Object));
    } finally {
      vi.useRealTimers();
    }
  });
});

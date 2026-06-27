import { vi } from "vitest";
import { createBodyHash, pathWithSearch, verifyProxySignature } from "@/server/proxy-auth";

describe("Next instrumentation startup hooks", () => {
  const originalEnv = {
    NEXT_RUNTIME: process.env.NEXT_RUNTIME,
    WORLDMODEL_DATABASE_URL: process.env.WORLDMODEL_DATABASE_URL,
    WORLDMODEL_ACCESS_MODE: process.env.WORLDMODEL_ACCESS_MODE,
    WORLDMODEL_STARTUP_RESTORE: process.env.WORLDMODEL_STARTUP_RESTORE,
    WORLDMODEL_STARTUP_RESTORE_URL: process.env.WORLDMODEL_STARTUP_RESTORE_URL,
    WORLDMODEL_STARTUP_RESTORE_DELAY_MS: process.env.WORLDMODEL_STARTUP_RESTORE_DELAY_MS,
    WORLDMODEL_STARTUP_RESTORE_RETRY_DELAY_MS: process.env.WORLDMODEL_STARTUP_RESTORE_RETRY_DELAY_MS,
    WORLDMODEL_STARTUP_RESTORE_ATTEMPTS: process.env.WORLDMODEL_STARTUP_RESTORE_ATTEMPTS,
    WORLDMODEL_PROXY_SECRET: process.env.WORLDMODEL_PROXY_SECRET,
    PORT: process.env.PORT
  };

  function restoreEnv() {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
    process.env.NEXT_RUNTIME = "nodejs";
    process.env.WORLDMODEL_DATABASE_URL = "postgresql://world-model";
    process.env.WORLDMODEL_ACCESS_MODE = "standalone";
    process.env.WORLDMODEL_PROXY_SECRET = "test-proxy-secret-value";
    delete process.env.WORLDMODEL_STARTUP_RESTORE;
    delete process.env.WORLDMODEL_STARTUP_RESTORE_URL;
    delete process.env.WORLDMODEL_STARTUP_RESTORE_DELAY_MS;
    delete process.env.WORLDMODEL_STARTUP_RESTORE_RETRY_DELAY_MS;
    delete process.env.WORLDMODEL_STARTUP_RESTORE_ATTEMPTS;
    delete process.env.PORT;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    restoreEnv();
  });

  it("posts to the worker restore API shortly after the standalone Node server starts", async () => {
    const { register } = await import("@/instrumentation");

    register();
    expect(fetch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);

    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:3100/api/automation/worker/restore", { method: "POST" });
  });

  it("does not wait for worker restore to finish before letting server startup continue", async () => {
    vi.mocked(fetch).mockReturnValue(
      new Promise<Response>(() => {
        // Intentionally unresolved: startup must not wait for the restore HTTP call.
      })
    );
    const { register } = await import("@/instrumentation");

    const registerPromise = Promise.resolve(register());
    const startupResult = await Promise.race([
      registerPromise.then(() => "returned"),
      new Promise((resolve) => {
        setTimeout(() => resolve("blocked"), 25);
      })
    ]);

    expect(startupResult).toBe("returned");
    await registerPromise;
  });

  it("signs the startup restore call when running behind the proxy guard", async () => {
    process.env.WORLDMODEL_ACCESS_MODE = "proxy";
    process.env.WORLDMODEL_STARTUP_RESTORE_URL = "http://127.0.0.1:4310/api/automation/worker/restore?startup=1";
    const { register, shouldScheduleStartupRestore } = await import("@/instrumentation");

    expect(shouldScheduleStartupRestore()).toBe(true);
    register();
    await vi.advanceTimersByTimeAsync(500);

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("http://127.0.0.1:4310/api/automation/worker/restore?startup=1");
    const headers = new Headers(init?.headers);
    expect(headers.get("x-worldmodel-body-sha256")).toBe(createBodyHash(""));
    expect(
      verifyProxySignature({
        secret: "test-proxy-secret-value",
        method: "POST",
        path: pathWithSearch(String(url)),
        bodyHash: createBodyHash(""),
        headers
      })
    ).toEqual({ ok: true });
  });

  it("does not call the restore API outside the Node runtime or without database credentials", async () => {
    const { register, shouldScheduleStartupRestore } = await import("@/instrumentation");

    process.env.NEXT_RUNTIME = "edge";
    expect(shouldScheduleStartupRestore()).toBe(false);
    register();
    await vi.advanceTimersByTimeAsync(500);
    expect(fetch).not.toHaveBeenCalled();

    process.env.NEXT_RUNTIME = "nodejs";
    process.env.WORLDMODEL_DATABASE_URL = "";
    expect(shouldScheduleStartupRestore()).toBe(false);
    register();
    await vi.advanceTimersByTimeAsync(500);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not call the restore API in proxy mode without a usable proxy secret", async () => {
    process.env.WORLDMODEL_ACCESS_MODE = "proxy";
    process.env.WORLDMODEL_PROXY_SECRET = "too-short";
    const { register, shouldScheduleStartupRestore } = await import("@/instrumentation");

    expect(shouldScheduleStartupRestore()).toBe(false);
    register();
    await vi.advanceTimersByTimeAsync(500);

    expect(fetch).not.toHaveBeenCalled();
  });

  it("retries the restore API while the local server is still warming up", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("connection refused")).mockResolvedValueOnce(new Response("{}", { status: 200 }));
    const { register } = await import("@/instrumentation");

    register();
    await vi.advanceTimersByTimeAsync(500);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("uses the configured restore URL and startup delay when provided", async () => {
    process.env.WORLDMODEL_STARTUP_RESTORE_URL = "http://127.0.0.1:4310/api/automation/worker/restore";
    process.env.WORLDMODEL_STARTUP_RESTORE_DELAY_MS = "250";
    const { register, startupRestoreUrl } = await import("@/instrumentation");

    expect(startupRestoreUrl()).toBe("http://127.0.0.1:4310/api/automation/worker/restore");
    register();
    await vi.advanceTimersByTimeAsync(249);
    expect(fetch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:4310/api/automation/worker/restore", { method: "POST" });
  });
});

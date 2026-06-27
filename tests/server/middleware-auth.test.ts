import { NextRequest } from "next/server";
import { createBodyHash, createProxySignature, proxyHeaderNames } from "@/server/proxy-auth";

describe("world model middleware authentication", () => {
  const originalAccessMode = process.env.WORLDMODEL_ACCESS_MODE;
  const originalProxySecret = process.env.WORLDMODEL_PROXY_SECRET;

  afterEach(() => {
    process.env.WORLDMODEL_ACCESS_MODE = originalAccessMode;
    process.env.WORLDMODEL_PROXY_SECRET = originalProxySecret;
  });

  it("rejects unsigned API requests in proxy mode", async () => {
    process.env.WORLDMODEL_ACCESS_MODE = "proxy";
    process.env.WORLDMODEL_PROXY_SECRET = "a".repeat(32);
    const { middleware } = await import("@/middleware");

    const response = await middleware(new NextRequest("http://localhost/api/beliefs"));

    expect(response.status).toBe(401);
  });

  it("allows unsigned API requests in standalone mode for local debugging", async () => {
    process.env.WORLDMODEL_ACCESS_MODE = "standalone";
    delete process.env.WORLDMODEL_PROXY_SECRET;
    const { middleware } = await import("@/middleware");

    const response = await middleware(new NextRequest("http://localhost/api/beliefs"));

    expect(response.status).not.toBe(401);
  });

  it("allows signed API requests in proxy mode", async () => {
    process.env.WORLDMODEL_ACCESS_MODE = "proxy";
    const secret = "a".repeat(32);
    process.env.WORLDMODEL_PROXY_SECRET = secret;
    const timestamp = String(Math.floor(Date.now() / 1000));
    const bodyHash = createBodyHash("");
    const signature = createProxySignature({
      secret,
      method: "GET",
      path: "/api/beliefs",
      timestamp,
      bodyHash
    });
    const { middleware } = await import("@/middleware");

    const response = await middleware(
      new NextRequest("http://localhost/api/beliefs", {
        headers: {
          [proxyHeaderNames.timestamp]: timestamp,
          [proxyHeaderNames.bodyHash]: bodyHash,
          [proxyHeaderNames.signature]: signature
        }
      })
    );

    expect(response.status).not.toBe(401);
  });
});

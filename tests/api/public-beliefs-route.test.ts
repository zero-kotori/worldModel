import { vi } from "vitest";
import { createBodyHash, createProxySignature, proxyHeaderNames } from "@/server/proxy-auth";

const getWorldModelServices = vi.fn();

vi.mock("@/server/services", () => ({
  getWorldModelServices
}));

function signedRequest(body: Record<string, unknown>) {
  const text = JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const bodyHash = createBodyHash(text);
  const signature = createProxySignature({
    secret: "public-belief-test-secret",
    method: "POST",
    path: "/api/public-beliefs",
    timestamp,
    bodyHash
  });
  return new Request("http://localhost/api/public-beliefs", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [proxyHeaderNames.timestamp]: timestamp,
      [proxyHeaderNames.bodyHash]: bodyHash,
      [proxyHeaderNames.signature]: signature
    },
    body: text
  });
}

describe("public beliefs route", () => {
  const previousAccessMode = process.env.WORLDMODEL_ACCESS_MODE;
  const previousProxySecret = process.env.WORLDMODEL_PROXY_SECRET;

  beforeEach(() => {
    getWorldModelServices.mockReset();
    process.env.WORLDMODEL_ACCESS_MODE = "proxy";
    process.env.WORLDMODEL_PROXY_SECRET = "public-belief-test-secret";
  });

  afterAll(() => {
    if (previousAccessMode === undefined) {
      delete process.env.WORLDMODEL_ACCESS_MODE;
    } else {
      process.env.WORLDMODEL_ACCESS_MODE = previousAccessMode;
    }
    if (previousProxySecret === undefined) {
      delete process.env.WORLDMODEL_PROXY_SECRET;
    } else {
      process.env.WORLDMODEL_PROXY_SECRET = previousProxySecret;
    }
  });

  it("rejects unsigned public belief creation in proxy mode", async () => {
    const { POST } = await import("@/app/api/public-beliefs/route");

    const response = await POST(
      new Request("http://localhost/api/public-beliefs", {
        method: "POST",
        body: JSON.stringify({ title: "Unsigned belief" })
      })
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("creates external beliefs through signed requests", async () => {
    const createBelief = vi.fn().mockResolvedValue({ id: "belief_external", origin: "EXTERNAL" });
    getWorldModelServices.mockReturnValue({
      beliefs: {
        createBelief
      }
    });
    const { POST } = await import("@/app/api/public-beliefs/route");
    const body = {
      title: "Public belief",
      category: "TECH_TREND",
      description: "Submitted from the public site.",
      probabilityMode: "INDEPENDENT",
      origin: "INTERNAL",
      hypotheses: [{ proposition: "Public hypothesis", priorProbability: 0.45, stance: "SUPPORTS" }]
    };

    const response = await POST(signedRequest(body));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ id: "belief_external" });
    expect(createBelief).toHaveBeenCalledWith({
      ...body,
      origin: "EXTERNAL"
    });
  });
});

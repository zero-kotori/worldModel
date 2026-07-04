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

function signedGetRequest() {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const bodyHash = createBodyHash("");
  const signature = createProxySignature({
    secret: "public-belief-test-secret",
    method: "GET",
    path: "/api/public-beliefs",
    timestamp,
    bodyHash
  });
  return new Request("http://localhost/api/public-beliefs", {
    method: "GET",
    headers: {
      [proxyHeaderNames.timestamp]: timestamp,
      [proxyHeaderNames.bodyHash]: bodyHash,
      [proxyHeaderNames.signature]: signature
    }
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

  it("rejects unsigned public belief reads in proxy mode", async () => {
    const { GET } = await import("@/app/api/public-beliefs/route");

    const response = await GET(new Request("http://localhost/api/public-beliefs", { method: "GET" }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("returns only active external public beliefs through signed reads", async () => {
    const createdAt = new Date("2026-07-05T08:00:00.000Z");
    const listBeliefs = vi.fn().mockResolvedValue([
      {
        id: "belief_internal",
        title: "Internal belief",
        category: "AI_TREND",
        description: "Private belief.",
        probabilityMode: "INDEPENDENT",
        origin: "INTERNAL",
        status: "ACTIVE",
        createdAt,
        updatedAt: createdAt,
        hypotheses: [
          {
            id: "hypothesis_internal",
            beliefId: "belief_internal",
            proposition: "Private hypothesis",
            notes: "private notes",
            stance: "SUPPORTS",
            priorProbability: 0.5,
            currentProbability: 0.6,
            strength: 0.6,
            status: "ACTIVE",
            createdAt,
            updatedAt: createdAt
          }
        ]
      },
      {
        id: "belief_external",
        title: "External belief",
        category: "TECH_TREND",
        description: "Public belief.",
        probabilityMode: "INDEPENDENT",
        origin: "EXTERNAL",
        status: "ACTIVE",
        createdAt,
        updatedAt: createdAt,
        hypotheses: [
          {
            id: "hypothesis_external",
            beliefId: "belief_external",
            proposition: "Public hypothesis",
            notes: "hidden notes",
            evidenceSearchQuery: "hidden query",
            stance: "SUPPORTS",
            priorProbability: 0.4,
            currentProbability: 0.55,
            strength: 0.55,
            status: "ACTIVE",
            createdAt,
            updatedAt: createdAt
          },
          {
            id: "hypothesis_paused",
            beliefId: "belief_external",
            proposition: "Paused public hypothesis",
            notes: "",
            stance: "OPPOSES",
            priorProbability: 0.2,
            currentProbability: 0.2,
            strength: 0.2,
            status: "PAUSED",
            createdAt,
            updatedAt: createdAt
          }
        ]
      },
      {
        id: "belief_archived_external",
        title: "Archived external belief",
        category: "CAREER",
        description: "Archived public belief.",
        probabilityMode: "INDEPENDENT",
        origin: "EXTERNAL",
        status: "ARCHIVED",
        createdAt,
        updatedAt: createdAt,
        hypotheses: []
      }
    ]);
    getWorldModelServices.mockReturnValue({
      beliefs: {
        listBeliefs
      }
    });
    const { GET } = await import("@/app/api/public-beliefs/route");

    const response = await GET(signedGetRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      beliefs: [
        {
          id: "belief_external",
          title: "External belief",
          category: "TECH_TREND",
          description: "Public belief.",
          probabilityMode: "INDEPENDENT",
          origin: "EXTERNAL",
          status: "ACTIVE",
          createdAt: createdAt.toISOString(),
          updatedAt: createdAt.toISOString(),
          hypotheses: [
            {
              id: "hypothesis_external",
              proposition: "Public hypothesis",
              stance: "SUPPORTS",
              priorProbability: 0.4,
              currentProbability: 0.55,
              status: "ACTIVE",
              createdAt: createdAt.toISOString(),
              updatedAt: createdAt.toISOString()
            }
          ]
        }
      ]
    });
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

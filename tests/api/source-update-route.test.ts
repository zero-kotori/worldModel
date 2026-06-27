import { vi } from "vitest";

const getWorldModelServices = vi.fn();

vi.mock("@/server/services", () => ({
  getWorldModelServices
}));

describe("source update route", () => {
  beforeEach(() => {
    getWorldModelServices.mockReset();
    process.env.WORLDMODEL_ACCESS_MODE = "standalone";
  });

  it("updates a source from API input", async () => {
    const source = {
      id: "source_news",
      name: "Reviewed news source",
      enabled: false,
      credibility: 0.72,
      autoConfirm: true,
      autoConfirmThreshold: 0.62
    };
    const updateSource = vi.fn().mockResolvedValue(source);
    getWorldModelServices.mockReturnValue({
      sources: {
        updateSource
      }
    });
    const { PATCH } = await import("@/app/api/sources/[id]/route");
    const body = {
      name: "Reviewed news source",
      enabled: false,
      credibility: 0.72,
      autoConfirm: true,
      autoConfirmThreshold: 0.62
    };

    const response = await PATCH(
      new Request("http://localhost/api/sources/source_news", {
        method: "PATCH",
        body: JSON.stringify(body)
      }),
      { params: Promise.resolve({ id: "source_news" }) }
    );

    await expect(response.json()).resolves.toEqual(source);
    expect(response.status).toBe(200);
    expect(updateSource).toHaveBeenCalledWith("source_news", body);
  });
});

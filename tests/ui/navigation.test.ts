import { worldModelSections } from "@/lib/world-model-navigation";

describe("world model admin navigation", () => {
  it("exposes every first-version workspace page", () => {
    expect(worldModelSections.map((section) => section.href)).toEqual([
      "/admin/world-model",
      "/admin/world-model/beliefs",
      "/admin/world-model/observations",
      "/admin/world-model/evidence",
      "/admin/world-model/sources",
      "/admin/world-model/models"
    ]);
  });
});

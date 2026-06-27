import { worldModelActionReturnPath } from "@/lib/world-model-action-routing";

function formWithReturnPath(value?: string) {
  const formData = new FormData();
  if (value !== undefined) formData.set("returnPath", value);
  return formData;
}

describe("world model action routing", () => {
  it("keeps graph workspace form submissions on the graph page", () => {
    expect(worldModelActionReturnPath(formWithReturnPath("/admin/world-model/graph"), "/admin/world-model/evidence")).toBe(
      "/admin/world-model/graph"
    );
  });

  it("allows known world model pages with query parameters", () => {
    expect(worldModelActionReturnPath(formWithReturnPath("/admin/world-model/beliefs?view=review-due"), "/admin/world-model/beliefs")).toBe(
      "/admin/world-model/beliefs?view=review-due"
    );
  });

  it("allows known world model pages with query parameters and hash anchors", () => {
    expect(
      worldModelActionReturnPath(formWithReturnPath("/admin/world-model/sources?belief=B-001#evidence-loop"), "/admin/world-model/sources")
    ).toBe("/admin/world-model/sources?belief=B-001#evidence-loop");
  });

  it("falls back when the return path is missing or outside the world model admin pages", () => {
    expect(worldModelActionReturnPath(formWithReturnPath(), "/admin/world-model/evidence")).toBe("/admin/world-model/evidence");
    expect(worldModelActionReturnPath(formWithReturnPath("https://evil.example/admin/world-model"), "/admin/world-model/evidence")).toBe(
      "/admin/world-model/evidence"
    );
    expect(worldModelActionReturnPath(formWithReturnPath("//evil.example/admin/world-model"), "/admin/world-model/evidence")).toBe(
      "/admin/world-model/evidence"
    );
    expect(worldModelActionReturnPath(formWithReturnPath("/admin/world-model-evil"), "/admin/world-model/evidence")).toBe(
      "/admin/world-model/evidence"
    );
    expect(worldModelActionReturnPath(formWithReturnPath("/api/evidence"), "/admin/world-model/evidence")).toBe("/admin/world-model/evidence");
  });
});

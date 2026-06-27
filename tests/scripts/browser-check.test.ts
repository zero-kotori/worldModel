import { assertGraphCanvasState, assertWorldModelPageBody } from "../../scripts/browser-check";

describe("browser check assertions", () => {
  it("fails when a world model page renders a data loading error", () => {
    expect(() =>
      assertWorldModelPageBody("/admin/world-model/graph", "desktop", "世界模型\n数据加载失败，请检查 worldModel 服务日志。\n证据影响图谱")
    ).toThrow("rendered a data loading error");
  });

  it("accepts a page with the expected route text and no data loading error", () => {
    expect(() =>
      assertWorldModelPageBody("/admin/world-model/graph", "desktop", "世界模型\n证据影响图谱\n图谱工作区", [
        "证据影响图谱",
        "图谱工作区"
      ])
    ).not.toThrow();
  });

  it("fails when a non-empty graph route renders without ReactFlow nodes", () => {
    expect(() =>
      assertGraphCanvasState("/admin/world-model/graph", "desktop", {
        emptyGraph: false,
        nodeCount: 0,
        canvasBox: { width: 900, height: 640 }
      })
    ).toThrow("rendered without graph nodes");
  });
});

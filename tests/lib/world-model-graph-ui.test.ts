import { graphInteractionOptions } from "@/lib/world-model-graph-ui";

describe("world model graph interaction", () => {
  it("uses wheel input for vertical movement and keeps zoom on explicit controls", () => {
    expect(graphInteractionOptions).toMatchObject({
      zoomOnScroll: false,
      zoomOnDoubleClick: false,
      zoomOnPinch: false,
      panOnScroll: true,
      panOnScrollMode: "vertical"
    });
  });
});

import { createGraphInteractionOptions, graphInteractionOptions } from "@/lib/world-model-graph-ui";

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

  it("does not capture wheel input in embedded graphs until the canvas is activated", () => {
    expect(createGraphInteractionOptions({ mode: "embedded", panActivated: false })).toMatchObject({
      zoomOnScroll: false,
      preventScrolling: false,
      panOnScroll: false,
      panOnScrollMode: "vertical"
    });
    expect(createGraphInteractionOptions({ mode: "embedded", panActivated: true })).toMatchObject({
      zoomOnScroll: false,
      preventScrolling: true,
      panOnScroll: true,
      panOnScrollMode: "vertical"
    });
  });

  it("keeps workspace graphs ready for wheel panning without a separate activation click", () => {
    expect(createGraphInteractionOptions({ mode: "workspace", panActivated: false })).toMatchObject({
      zoomOnScroll: false,
      preventScrolling: true,
      panOnScroll: true,
      panOnScrollMode: "vertical"
    });
  });
});

import { PanOnScrollMode } from "@xyflow/react";

export const graphInteractionOptions = {
  zoomOnScroll: false,
  zoomOnDoubleClick: false,
  zoomOnPinch: false,
  panOnScroll: true,
  panOnScrollMode: PanOnScrollMode.Vertical
} as const;

import { PanOnScrollMode } from "@xyflow/react";

const baseGraphInteractionOptions = {
  zoomOnScroll: false,
  zoomOnDoubleClick: false,
  zoomOnPinch: false,
  panOnScrollMode: PanOnScrollMode.Vertical
} as const;

export function createGraphInteractionOptions({
  mode,
  panActivated
}: {
  mode: "embedded" | "workspace";
  panActivated: boolean;
}) {
  return {
    ...baseGraphInteractionOptions,
    preventScrolling: mode === "workspace" || panActivated,
    panOnScroll: mode === "workspace" || panActivated
  } as const;
}

export const graphInteractionOptions = createGraphInteractionOptions({
  mode: "workspace",
  panActivated: true
});

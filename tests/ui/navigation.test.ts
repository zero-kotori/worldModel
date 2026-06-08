import React, { isValidElement, type ReactNode } from "react";
import { worldModelSections } from "@/lib/world-model-navigation";

function collectWorldModelLinks(node: ReactNode): Array<{ href?: unknown; prefetch?: unknown; children?: ReactNode }> {
  if (Array.isArray(node)) return node.flatMap(collectWorldModelLinks);
  if (!isValidElement(node)) return [];

  const props = node.props as { href?: unknown; prefetch?: unknown; children?: ReactNode };
  const ownLink = typeof props.href === "string" && props.href.startsWith("/admin/world-model") ? [props] : [];
  return [...ownLink, ...collectWorldModelLinks(props.children)];
}

describe("world model admin navigation", () => {
  it("exposes every first-version workspace page", () => {
    expect(worldModelSections.map((section) => section.href)).toEqual([
      "/admin/world-model",
      "/admin/world-model/graph",
      "/admin/world-model/beliefs",
      "/admin/world-model/observations",
      "/admin/world-model/evidence",
      "/admin/world-model/sources",
      "/admin/world-model/models"
    ]);
  });

  it("does not prefetch protected workspace routes in proxy mode", async () => {
    (globalThis as typeof globalThis & { React: typeof React }).React = React;
    const { default: WorldModelLayout } = await import("@/app/admin/world-model/layout");
    const links = collectWorldModelLinks(WorldModelLayout({ children: null }));

    expect(links.map((link) => link.href)).toEqual(worldModelSections.map((section) => section.href));
    expect(links.every((link) => link.prefetch === false)).toBe(true);
  });
});

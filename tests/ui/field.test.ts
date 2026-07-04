import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

describe("world model form fields", () => {
  it("allows controls to shrink inside responsive grids", async () => {
    (globalThis as typeof globalThis & { React: typeof React }).React = React;
    const { Field, SelectField, TextAreaField } = await import("@/components/world-model/Field");

    const html = renderToStaticMarkup(
      React.createElement(
        "div",
        null,
        React.createElement(Field, { label: "标题", name: "title" }),
        React.createElement(SelectField, { label: "类型", name: "kind", options: [{ label: "RSS", value: "RSS" }] }),
        React.createElement(TextAreaField, { label: "正文", name: "content" })
      )
    );

    expect(html).toMatch(/<label class="[^"]*min-w-0/);
    expect(html).toMatch(/<input[^>]*class="[^"]*w-full[^"]*min-w-0/);
    expect(html).toMatch(/<select[^>]*class="[^"]*w-full[^"]*min-w-0/);
    expect(html).toMatch(/<textarea[^>]*class="[^"]*w-full[^"]*min-w-0/);
  });
});

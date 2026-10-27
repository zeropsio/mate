import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { Row } from "./row";

const slots = (html: string) =>
  [...html.matchAll(/data-slot="(row-[a-z]+)"/gu)].map((match) => match[1]);

describe("Row", () => {
  it("draws its parts in reading order: the mark, the title, its badges, the meta, the line, the control", () => {
    const html = renderToStaticMarkup(
      <Row
        badges={<span>Release</span>}
        control={<button type="button">More</button>}
        lead={<span>face</span>}
        line="Reading the release notes"
        meta="2m"
        title="Fen"
      />,
    );
    expect(slots(html)).toEqual([
      "row-lead",
      "row-body",
      "row-title",
      "row-badges",
      "row-meta",
      "row-line",
      "row-control",
    ]);
  });

  it("draws only the parts it is given", () => {
    expect(slots(renderToStaticMarkup(<Row title="Reduce motion" />))).toEqual([
      "row-body",
      "row-title",
    ]);
  });

  it("is a button when the whole row opens something", () => {
    const html = renderToStaticMarkup(
      <Row pressable render={<button type="button" />} title="Fen" />,
    );
    expect(html.startsWith("<button")).toBe(true);
    expect(html).toContain('data-slot="row"');
  });
});

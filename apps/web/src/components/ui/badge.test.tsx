import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { Badge } from "./badge";

describe("Badge", () => {
  it.each(["neutral", "info", "success", "warning", "danger"] as const)(
    "a %s label says its words and carries its tone",
    (tone) => {
      const html = renderToStaticMarkup(<Badge tone={tone}>Running</Badge>);
      expect(html).toContain(`data-tone="${tone}"`);
      expect(html).toMatch(/>Running<\/span>$/u);
      expect(html).not.toContain("data-dot");
    },
  );

  it("a status dot stands before its words, hidden from assistive technology", () => {
    const html = renderToStaticMarkup(
      <Badge dot tone="success">
        Running
      </Badge>,
    );
    expect(html).toContain('data-dot=""');
    expect(html).toMatch(/<span aria-hidden="true"[^>]*><\/span><span[^>]*>Running<\/span>/u);
    expect(html).not.toContain('role="img"');
  });

  it("a status dot without words is an image named by its accessible name", () => {
    const html = renderToStaticMarkup(<Badge aria-label="Running" dot tone="success" />);
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Running"');
  });

  it("a dot breathes while its work runs, and holds still otherwise", () => {
    const busy = renderToStaticMarkup(
      <Badge dot tone="info">
        Deploying
      </Badge>,
    );
    const done = renderToStaticMarkup(
      <Badge dot tone="success">
        Running
      </Badge>,
    );
    const held = renderToStaticMarkup(
      <Badge dot pulse={false} tone="info">
        Queued
      </Badge>,
    );
    expect(busy).toContain("data-pulse");
    expect(done).not.toContain("data-pulse");
    expect(held).not.toContain("data-pulse");
  });
});

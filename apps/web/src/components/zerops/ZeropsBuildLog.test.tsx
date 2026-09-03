import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { ZeropsBuildLog, type ZeropsBuildLogLine } from "./ZeropsBuildLog";

const LINES: ReadonlyArray<ZeropsBuildLogLine> = [
  { id: "l1", at: "2026-09-01T00:00:00.000Z", text: "Pulling base image", severity: 6 },
  { id: "l2", at: "2026-09-01T00:00:01.000Z", text: "npm ERR! build failed", severity: 3 },
];

describe("ZeropsBuildLog", () => {
  it("renders every line's text when open", () => {
    const html = renderToStaticMarkup(
      <ZeropsBuildLog lines={LINES} onToggle={vi.fn()} open={true} status="live" />,
    );

    expect(html).toContain("Pulling base image");
    expect(html).toContain("npm ERR! build failed");
  });

  it("puts a severity ≤ 3 line in the failed tone, and leaves a higher-severity line alone", () => {
    const html = renderToStaticMarkup(
      <ZeropsBuildLog lines={LINES} onToggle={vi.fn()} open={true} status="live" />,
    );

    expect(html).toContain('data-zerops-build-log-severity="3"');
    const failedLineMatch = html.match(
      /<div[^>]*data-zerops-build-log-severity="3"[^>]*>npm ERR! build failed<\/div>/,
    );
    expect(failedLineMatch).toBeDefined();
    expect(failedLineMatch![0]).toContain("var(--zerops-status-failed)");

    const okLineMatch = html.match(
      /<div[^>]*data-zerops-build-log-severity="6"[^>]*>Pulling base image<\/div>/,
    );
    expect(okLineMatch).toBeDefined();
    expect(okLineMatch![0]).not.toContain("var(--zerops-status-failed)");
  });

  it("holds the lines while closed — they are not dropped, only not rendered", () => {
    const closedHtml = renderToStaticMarkup(
      <ZeropsBuildLog lines={LINES} onToggle={vi.fn()} open={false} status="ended" />,
    );
    expect(closedHtml).not.toContain("Pulling base image");
    expect(closedHtml).not.toContain("data-zerops-build-log-body");

    // The same `lines` prop, reopened — nothing was lost by having been closed.
    const reopenedHtml = renderToStaticMarkup(
      <ZeropsBuildLog lines={LINES} onToggle={vi.fn()} open={true} status="ended" />,
    );
    expect(reopenedHtml).toContain("Pulling base image");
    expect(reopenedHtml).toContain("npm ERR! build failed");
  });

  it("shows a header with the 'Build log' label and the line count", () => {
    const html = renderToStaticMarkup(
      <ZeropsBuildLog lines={LINES} onToggle={vi.fn()} open={false} status="ended" />,
    );
    expect(html).toContain("Build log");
    expect(html).toContain('data-zerops-build-log-count="true"');
    expect(html).toMatch(/data-zerops-build-log-count="true"[^>]*>2</);
  });
});

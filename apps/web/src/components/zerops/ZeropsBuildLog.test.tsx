import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { BuildLogLines, ZeropsBuildLog, type ZeropsBuildLogLine } from "./ZeropsBuildLog";

const lineOf = (index: number, text: string, severity = 6): ZeropsBuildLogLine => ({
  id: `l${index}`,
  at: `2026-09-01T00:00:${String(index).padStart(2, "0")}.000Z`,
  text,
  severity,
});

const LINES: ReadonlyArray<ZeropsBuildLogLine> = [
  lineOf(1, "Pulling base image"),
  lineOf(2, "npm ERR! build failed", 3),
];

const render = (lines: ReadonlyArray<ZeropsBuildLogLine>, status: "live" | "ended" = "live") =>
  renderToStaticMarkup(
    <ZeropsBuildLog lines={lines} onToggle={vi.fn()} open={false} status={status} />,
  );

const rowsOf = (html: string) =>
  [...html.matchAll(/<li[^>]*data-zerops-build-log-line[^>]*>([\s\S]*?)<\/li>/g)].map(
    ([row]) => row,
  );

describe("ZeropsBuildLog", () => {
  // Under the build step, only a glance while it runs; the whole log opens
  // in a dialog (the owner, 2026-09-26: "it should be opened in like a live
  // dialog or something instead of inline").
  it("glances at the build's newest two lines while it runs", () => {
    const lines = Array.from({ length: 12 }, (_, index) =>
      lineOf(index + 1, `step ${index + 1} ok`),
    );
    const rows = rowsOf(render(lines));

    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("step 11 ok");
    expect(rows[1]).toContain("step 12 ok");
  });

  it("glances at nothing once the build ended, and draws no log inline", () => {
    const html = render(LINES, "ended");
    expect(rowsOf(html)).toHaveLength(0);
    expect(html).not.toContain("data-zerops-build-log-body");
  });

  it("folds lines alike but for one package into their newest line, counted", () => {
    const html = render([
      lineOf(1, "➤ YN0000: ┌ Fetch step"),
      lineOf(2, "➤ YN0013: │ cssesc@npm:3.0.0 can't be found in the cache"),
      lineOf(3, "➤ YN0013: │ csstype@npm:3.1.3 can't be found in the cache"),
      lineOf(4, "➤ YN0013: │ lodash@npm:4.17.21 can't be found in the cache"),
    ]);
    const rows = rowsOf(html);

    expect(rows).toHaveLength(2);
    expect(rows[1]).toContain("lodash@npm:4.17.21");
    expect(rows[1]).toMatch(/data-zerops-build-log-repeat[^>]*>×3</);
    expect(rows[0]).not.toContain("data-zerops-build-log-repeat");
  });

  it("puts an error line in the failure tone, and leaves a higher-severity line alone", () => {
    const [plain, error] = rowsOf(render(LINES));

    expect(error).toContain('data-zerops-build-log-severity="3"');
    expect(error).toContain("text-destructive-foreground");
    expect(plain).toContain('data-zerops-build-log-severity="6"');
    expect(plain).not.toContain("text-destructive-foreground");
  });

  it.each([
    { name: "none yet", lines: 0, count: undefined },
    { name: "one", lines: 1, count: "1 line" },
    { name: "a build's worth", lines: 1_229, count: "1,229 lines" },
  ])(
    "labels its link Build log in sentence case, with its line count: $name",
    ({ lines, count }) => {
      const html = render(
        Array.from({ length: lines }, (_, index) => lineOf(index, `line ${index}`)),
        "ended",
      );
      const toggle =
        html.match(/<button[^>]*data-zerops-build-log-toggle[\s\S]*?<\/button>/)?.[0] ?? "";

      expect(toggle).toContain('aria-haspopup="dialog"');
      expect(toggle).toContain(">Build log<");
      expect(toggle).not.toContain("uppercase");
      expect(toggle.match(/data-zerops-build-log-count[^>]*>([^<]*)</)?.[1]).toBe(count);
    },
  );
});

describe("BuildLogLines", () => {
  it("draws every line in full, wrapped, the error lines in the failure tone", () => {
    const long = "x".repeat(400);
    const html = renderToStaticMarkup(<BuildLogLines lines={[...LINES, lineOf(3, long)]} live />);
    const rows = rowsOf(html);

    expect(rows).toHaveLength(3);
    expect(rows[2]).toContain(long);
    expect(rows[2]).toContain("whitespace-pre-wrap");
    expect(rows[1]).toContain("text-destructive-foreground");
    expect(html).toContain('aria-live="polite"');
  });
});

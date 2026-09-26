import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("~/components/ui/tooltip", async () => {
  const React = await import("react");
  return {
    Tooltip: ({ children }: { readonly children: React.ReactNode }) => children,
    TooltipTrigger: ({
      children,
      render,
    }: {
      readonly children: React.ReactNode;
      readonly render: React.ReactElement;
    }) => React.cloneElement(render, undefined, children),
    TooltipPopup: ({ children }: { readonly children: React.ReactNode }) => (
      <span data-testid="tooltip">{children}</span>
    ),
  };
});

import { ZeropsBuildLog, type ZeropsBuildLogLine } from "./ZeropsBuildLog";

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

const render = (lines: ReadonlyArray<ZeropsBuildLogLine>, open = true) =>
  renderToStaticMarkup(
    <ZeropsBuildLog lines={lines} onToggle={vi.fn()} open={open} status="live" />,
  );

const rowsOf = (html: string) =>
  [...html.matchAll(/<li[^>]*data-zerops-build-log-line[^>]*>([\s\S]*?)<\/li>/g)].map(
    ([row]) => row,
  );

describe("ZeropsBuildLog", () => {
  it("shows the tail: the last eight rows, the oldest dropped", () => {
    const lines = Array.from({ length: 12 }, (_, index) =>
      lineOf(index + 1, `step ${index + 1} ok`),
    );
    const rows = rowsOf(render(lines));

    expect(rows).toHaveLength(8);
    expect(rows[0]).toContain("step 5 ok");
    expect(rows[7]).toContain("step 12 ok");
  });

  it("holds the eight rows' height from its first frame, however few lines have arrived", () => {
    const empty = render([]);
    const full = render(
      Array.from({ length: 12 }, (_, index) => lineOf(index + 1, `line ${index}`)),
    );
    const bodyOf = (html: string) =>
      html.match(/<ol[^>]*data-zerops-build-log-body[^>]*>/)?.[0] ?? "";

    expect(bodyOf(empty)).toContain("h-40");
    expect(bodyOf(empty)).toBe(bodyOf(full));
  });

  it("cuts a long line with an ellipsis, the whole line in its tooltip — never a sideways scroll", () => {
    const long = `➤ YN0013: │ cssesc@npm:3.0.0 can't be found in the cache and will be fetched from the remote registry ${"x".repeat(200)}`;
    const html = render([lineOf(1, long)]);
    const row = rowsOf(html)[0] ?? "";

    expect(row).toMatch(/class="[^"]*truncate[^"]*"[^>]*>➤ YN0013/);
    expect(row).toContain(`data-testid="tooltip">${long.replace("'", "&#x27;")}<`);
    expect(html).not.toContain("overflow-x-auto");
    expect(html).not.toContain("whitespace-pre");
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

  it("holds the lines while closed — they are not dropped, only not rendered", () => {
    const closedHtml = render(LINES, false);
    expect(closedHtml).not.toContain("Pulling base image");
    expect(closedHtml).not.toContain("data-zerops-build-log-body");

    const reopenedHtml = render(LINES, true);
    expect(reopenedHtml).toContain("Pulling base image");
    expect(reopenedHtml).toContain("npm ERR! build failed");
  });

  it.each([
    { name: "none yet", lines: 0, count: undefined },
    { name: "one", lines: 1, count: "1 line" },
    { name: "a build's worth", lines: 1_229, count: "1,229 lines" },
  ])("labels itself Build log in sentence case, with its line count: $name", ({ lines, count }) => {
    const html = render(
      Array.from({ length: lines }, (_, index) => lineOf(index, `line ${index}`)),
      false,
    );
    const toggle =
      html.match(/<button[^>]*data-zerops-build-log-toggle[\s\S]*?<\/button>/)?.[0] ?? "";

    expect(toggle).toContain(">Build log<");
    expect(toggle).not.toContain("uppercase");
    expect(toggle.match(/data-zerops-build-log-count[^>]*>([^<]*)</)?.[1]).toBe(count);
  });
});

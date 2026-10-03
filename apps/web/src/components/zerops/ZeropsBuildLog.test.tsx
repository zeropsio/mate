import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { BuildLogLines, ZeropsBuildLog, type ZeropsBuildLogLine } from "./ZeropsBuildLog";

// The whole log's dialog, drawn in place when open: what it says is there to read.
vi.mock("~/components/ui/dialog", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    Dialog: ({ open, children }: { open: boolean; children?: ReactNode }) =>
      open ? <div data-dialog-open="">{children}</div> : null,
    DialogDescription: Pass,
    DialogHeader: Pass,
    DialogPanel: Pass,
    DialogPopup: Pass,
    DialogTitle: Pass,
  };
});

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

const render = (
  lines: ReadonlyArray<ZeropsBuildLogLine>,
  status: "loading" | "live" | "ended" = "live",
  waiting = false,
) =>
  renderToStaticMarkup(
    <ZeropsBuildLog
      lines={lines}
      onToggle={vi.fn()}
      open={false}
      status={status}
      waiting={waiting}
    />,
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

  // A log the build has not written a line of is nothing to open: the
  // container may not even run yet (the owner, 2026-09-27: "you shouldn't be
  // able to open build log when the container is not even running").
  it("offers nothing to open once the build ended without a line", () => {
    expect(render([], "ended")).toBe("");
  });

  // Its room stands from the first draw while the build runs, so the card's
  // height is final when it opens; the way to the log is there but not open
  // to anyone until the first line (pass 36). The room says it waits for the
  // first line when its caller reads so (`buildLogWaitsForFirstLine`, pass 37),
  // and a line, once there, is what it shows.
  it.each([
    { name: "no line, waiting", lines: [], waiting: true, rows: 0, openable: false, waits: true },
    { name: "no line, silent", lines: [], waiting: false, rows: 0, openable: false, waits: false },
    { name: "its first lines", lines: LINES, waiting: true, rows: 2, openable: true, waits: false },
  ] as const)("while it runs, its newest lines' room stands: $name", (row) => {
    const { lines, waiting, rows, openable, waits } = row;
    const html = render(lines, "live", waiting);
    const glance = html.match(/<ol[^>]*data-zerops-build-log-glance[\s\S]*?<\/ol>/)?.[0] ?? "";
    expect(glance).not.toBe("");
    expect(rowsOf(html)).toHaveLength(rows);
    expect(glance.includes("Waiting for the build&#x27;s first line…")).toBe(waits);
    const toggle = html.match(/<button[^>]*data-zerops-build-log-toggle[^>]*>/)?.[0] ?? "";
    expect(toggle.includes("disabled")).toBe(!openable);
  });

  it.each([
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

// A settled build's way to its log stands before its lines are read: opened
// with none to draw, its dialog says why, in words (pass 36).
describe("ZeropsBuildLog — the dialog of a log with no line", () => {
  it.each([
    { status: "error" as const, words: "Couldn't read this build's log from Zerops." },
    { status: "loading" as const, words: "Reading this build's log…" },
    { status: "ended" as const, words: "Zerops keeps no lines of this build's log." },
  ])("$status: $words", ({ status, words }) => {
    const html = renderToStaticMarkup(
      <ZeropsBuildLog lines={[]} onToggle={vi.fn()} open stands status={status} />,
    );
    expect(html.match(/data-zerops-build-log-empty[^>]*>([^<]*)</)?.[1]).toBe(
      words.replaceAll("'", "&#x27;"),
    );
  });
});

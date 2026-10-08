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
) =>
  renderToStaticMarkup(
    <ZeropsBuildLog lines={lines} onToggle={vi.fn()} open={false} status={status} />,
  );

const rowsOf = (html: string) =>
  [...html.matchAll(/<li[^>]*data-zerops-build-log-line[^>]*>([\s\S]*?)<\/li>/g)].map(
    ([row]) => row,
  );

const toggleOf = (html: string) =>
  html.match(/<button[^>]*data-zerops-build-log-toggle[\s\S]*?<\/button>/)?.[0] ?? "";

describe("ZeropsBuildLog", () => {
  // At the end of the build's line, the way to its log and nothing more: no
  // room under the step held for lines that may come (the owner, 2026-10-05:
  // "a premade space for … logs"); the whole log opens in a dialog (the
  // owner, 2026-09-26: "it should be opened in like a live dialog").
  it("holds no room for lines under the build: only the way to its log", () => {
    const lines = Array.from({ length: 12 }, (_, index) =>
      lineOf(index + 1, `step ${index + 1} ok`),
    );
    const html = render(lines);
    expect(html).not.toContain("data-zerops-build-log-line");
    expect(html).not.toContain("step 12 ok");
    expect(toggleOf(html)).not.toContain("disabled");
  });

  // A log the build has not written a line of is nothing to open: the
  // container may not even run yet (the owner, 2026-09-27: "you shouldn't be
  // able to open build log when the container is not even running").
  it("offers nothing to open once the build ended without a line", () => {
    expect(render([], "ended")).toBe("");
  });

  // While the build runs, its way stands from the first draw, so the line
  // never moves when the first line lands; it opens once there is a line.
  it.each([
    { name: "no line yet", lines: [], openable: false },
    { name: "its first lines", lines: LINES, openable: true },
  ] as const)("while it runs, its way to the log stands: $name", ({ lines, openable }) => {
    const toggle = toggleOf(render(lines, "live"));
    expect(toggle).not.toBe("");
    expect(toggle.includes("disabled")).toBe(!openable);
  });

  it.each([
    { name: "one", lines: 1, count: "1 line" },
    { name: "a build's worth", lines: 1_229, count: "1,229 lines" },
  ])("says Log, and its line count to a reader: $name", ({ lines, count }) => {
    const toggle = toggleOf(
      render(
        Array.from({ length: lines }, (_, index) => lineOf(index, `line ${index}`)),
        "ended",
      ),
    );
    expect(toggle).toContain('aria-haspopup="dialog"');
    expect(toggle).toContain(">Log<");
    expect(toggle).toContain(`aria-label="Open the build&#x27;s log, ${count}"`);
  });
});

describe("BuildLogLines", () => {
  it("draws every line in full, wrapped, the error lines in the failure tone", () => {
    const long = "x".repeat(400);
    const html = renderToStaticMarkup(<BuildLogLines lines={[...LINES, lineOf(3, long)]} live />);
    const rows = rowsOf(html);

    expect(rows).toHaveLength(3);
    expect(rows[2]).toContain(long);

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

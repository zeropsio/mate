import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import type { ZeropsOperationStep, ZeropsReadResult } from "@t3tools/client-runtime/zerops/model";

import { ZeropsReadResultBody } from "./ZeropsToolResultCards";

const render = (readResult: ZeropsReadResult, steps: ReadonlyArray<ZeropsOperationStep> = []) =>
  renderToStaticMarkup(<ZeropsReadResultBody readResult={readResult} steps={steps} />);

const count = (markup: string, needle: string) => markup.split(needle).length - 1;

describe("ZeropsReadResultBody — the running shape is the final shape", () => {
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly pending: ZeropsReadResult;
    readonly settled: ZeropsReadResult;
    readonly frame: string;
  }> = [
    {
      name: "logs",
      pending: {
        kind: "logs",
        pending: true,
        service: "app",
        filter: "errors · since 5m",
        lines: [],
      },
      settled: {
        kind: "logs",
        pending: false,
        service: "app",
        filter: "errors · since 5m",
        lines: [{ id: "0", severity: "error", text: "boom" }],
        counts: "1 error · 0 warnings",
      },
      frame: "data-zerops-read-lines",
    },
    {
      name: "events",
      pending: { kind: "events", pending: true, rows: [] },
      settled: {
        kind: "events",
        pending: false,
        rows: [{ id: "0", service: "app", action: "Build", status: { word: "Done", tone: "ok" } }],
      },
      frame: "data-zerops-read-rows",
    },
    {
      name: "discover",
      pending: { kind: "discover", pending: true, rows: [] },
      settled: {
        kind: "discover",
        pending: false,
        rows: [{ hostname: "app", status: { word: "Active", tone: "ok" } }],
      },
      frame: "data-zerops-read-grid",
    },
    {
      name: "process",
      pending: { kind: "process", pending: true },
      settled: { kind: "process", pending: false },
      frame: 'data-zerops-read-body="process"',
    },
  ];
  for (const { name, pending, settled, frame } of cases) {
    it(`${name}: the same frame running and settled, placeholders only while running`, () => {
      const running = render(pending);
      const done = render(settled, [
        { id: "a", label: "Build", state: "done", stateLabel: "Done" },
      ]);
      expect(running).toContain(frame);
      expect(done).toContain(frame);
      expect(count(running, "data-zerops-read-placeholder")).toBeGreaterThan(0);
      expect(done).not.toContain("data-zerops-read-placeholder");
    });
  }
});

describe("ZeropsReadResultBody — logs", () => {
  it("puts the service and the filter above the lines", () => {
    const markup = render({
      kind: "logs",
      pending: true,
      service: "app",
      filter: "errors · since 5m",
      lines: [],
    });
    expect(markup).toContain(">app<");
    expect(markup).toContain("errors · since 5m");
  });

  it("draws each line in mono with its severity, then the counts and the note", () => {
    const markup = render({
      kind: "logs",
      pending: false,
      service: "app",
      lines: [
        { id: "0", severity: "info", text: "listening" },
        { id: "1", severity: "warning", text: "slow" },
        { id: "2", severity: "error", text: "boom" },
      ],
      counts: "1 error · 1 warning",
      note: "Showing the last 12 of 40 lines.",
    });
    expect(markup).toContain("font-mono");
    expect(markup).toContain('data-zerops-log-severity="info"');
    expect(markup).toContain('data-zerops-log-severity="warning"');
    expect(markup).toContain('data-zerops-log-severity="error"');
    expect(markup).toContain("1 error · 1 warning");
    expect(markup).toContain("Showing the last 12 of 40 lines.");
  });
});

describe("ZeropsReadResultBody — events", () => {
  it("draws each event as service · action · a dot with its word, then the rest counted", () => {
    const markup = render({
      kind: "events",
      pending: false,
      rows: [
        {
          id: "0",
          at: "2026-09-25T10:05:00Z",
          service: "app",
          action: "Build",
          status: { word: "Failed", tone: "failed" },
        },
      ],
      more: "4 more",
    });
    expect(markup).toContain(">app<");
    expect(markup).toContain(">Build<");
    expect(markup).toContain('data-zerops-status-tone="failed"');
    expect(markup).toContain(">Failed<");
    expect(markup).toContain("4 more");
  });
});

describe("ZeropsReadResultBody — process", () => {
  it("draws the processes as steps", () => {
    const markup = render({ kind: "process", pending: false }, [
      {
        id: "a",
        label: "Enable subdomain access",
        state: "failed",
        stateLabel: "Failed",
        note: "port closed",
      },
    ]);
    expect(markup).toContain("Enable subdomain access");
    expect(markup).toContain("port closed");
  });
});

describe("ZeropsReadResultBody — discover", () => {
  it("draws one cell per service: hostname, dot and word, type and note", () => {
    const markup = render({
      kind: "discover",
      pending: false,
      rows: [
        {
          hostname: "app",
          type: "nodejs@22",
          status: { word: "Active", tone: "ok" },
          note: "Can be adopted",
        },
        { hostname: "db", type: "postgresql@16", status: { word: "Stopped", tone: "off" } },
      ],
    });
    expect(count(markup, "data-zerops-read-cell")).toBe(2);
    expect(markup).toContain(">app<");
    expect(markup).toContain("nodejs@22");
    expect(markup).toContain("Can be adopted");
    expect(markup).toContain('data-zerops-status-tone="off"');
    expect(markup).toContain(">Stopped<");
  });
});

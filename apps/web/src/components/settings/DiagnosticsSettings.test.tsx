import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { DiagnosticsSettingsPanel } from "./DiagnosticsSettings";

const reads = vi.hoisted(() => ({
  phase: "connected",
  queries: [] as unknown[],
  error: null as string | null,
  pending: false,
  withData: false,
  responseFailure: false,
}));

vi.mock("../../state/environments", () => ({
  usePrimaryEnvironment: () => ({
    environmentId: "primary",
    connection: { phase: reads.phase },
  }),
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => () => {},
  useLocation: () => "",
}));
vi.mock("../../state/query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../state/query")>()),
  useEnvironmentQuery: (atom: unknown) => {
    reads.queries.push(atom);
    return {
      data:
        reads.withData && (reads.queries.length === 2 || reads.queries.length === 3)
          ? {
              serverPid: 1,
              readAt: DateTime.makeUnsafe(0),
              processCount: 0,
              totalRssBytes: 0,
              totalCpuPercent: 0,
              processes: [],
              buckets: [],
              topProcesses: [],
              retainedSampleCount: 0,
              totalCpuSecondsApprox: 0,
              sampleIntervalMs: 1,
              error: reads.responseFailure
                ? Option.some({ message: "Collector refused." })
                : Option.none(),
            }
          : null,
      error: reads.error,
      isPending: reads.pending,
      refresh: () => {},
    };
  },
}));

describe("DiagnosticsSettingsPanel", () => {
  it.each([
    { phase: "connected", reads: true },
    { phase: "available", reads: false },
  ])("reads diagnostics only from a connected environment ($phase)", ({ phase, reads: asks }) => {
    reads.phase = phase;
    reads.queries = [];

    renderToStaticMarkup(<DiagnosticsSettingsPanel />);

    expect(reads.queries.length).toBeGreaterThan(0);
    expect(reads.queries.every((atom) => (atom !== null) === asks)).toBe(true);
  });
});

it.each([
  {
    name: "failure",
    error: "Diagnostics refused.",
    pending: false,
    expected: "Diagnostics refused.",
    withData: false,
    responseFailure: false,
  },
  {
    name: "retained empty failure",
    error: "Diagnostics refused.",
    pending: false,
    expected: "Diagnostics refused.",
    withData: true,
    responseFailure: false,
  },
  {
    name: "response failure",
    error: null,
    pending: false,
    expected: "Collector refused.",
    withData: true,
    responseFailure: true,
  },
  {
    name: "loading",
    error: null,
    pending: true,
    expected: "Loading",
    withData: false,
    responseFailure: false,
  },
])(
  "diagnostic collections show $name without asserting no processes or samples",
  ({ error, pending, expected, withData, responseFailure }) => {
    reads.phase = "connected";
    reads.queries = [];
    reads.withData = withData;
    reads.responseFailure = responseFailure;
    reads.error = error;
    reads.pending = pending;
    const html = renderToStaticMarkup(<DiagnosticsSettingsPanel />);
    expect(html.split(expected).length - 1).toBeGreaterThanOrEqual(3);
    expect(html).not.toContain("No live descendant processes found.");
    expect(html).not.toContain("No process resource samples found for this window.");
    reads.error = null;
    reads.pending = false;
    reads.withData = false;
    reads.responseFailure = false;
  },
);

it("a successful empty diagnostics read proves no processes or samples", () => {
  reads.phase = "connected";
  reads.queries = [];
  reads.withData = true;
  const html = renderToStaticMarkup(<DiagnosticsSettingsPanel />);
  expect(html).toContain("No live descendant processes found.");
  expect(html).toContain("No process resource samples found for this window.");
  reads.withData = false;
});

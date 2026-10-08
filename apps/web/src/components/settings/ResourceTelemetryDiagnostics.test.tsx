import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vite-plus/test";
import { ResourceTelemetryDiagnostics } from "./ResourceTelemetryDiagnostics";
const reads = vi.hoisted(() => ({ error: null as string | null, pending: false }));
vi.mock("../../state/environments", () => ({ usePrimaryEnvironment: () => null }));
vi.mock("../../lib/resourceTelemetryState", () => ({
  useResourceTelemetry: () => ({
    data: null,
    error: reads.error,
    isPending: reads.pending,
    refresh: () => {},
    retry: async () => {},
  }),
  useResourceTelemetryHistory: () => ({
    data: null,
    error: reads.error,
    isPending: reads.pending,
    refresh: () => {},
  }),
}));
it.each([
  { name: "failed", error: "Telemetry refused.", pending: false, expected: "Telemetry refused." },
  { name: "loading", error: null, pending: true, expected: "Loading" },
])(
  "telemetry collections show $name without claiming empty history or attribution",
  ({ error, pending, expected }) => {
    reads.error = error;
    reads.pending = pending;
    const html = renderToStaticMarkup(<ResourceTelemetryDiagnostics />);
    expect(html.split(expected).length - 1).toBeGreaterThanOrEqual(4);
    expect(html).not.toContain("No instrumented application I/O has been recorded yet.");
    expect(html).not.toContain("No retained process samples in this window.");
  },
);

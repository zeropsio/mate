import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { DiagnosticsSettingsPanel } from "./DiagnosticsSettings";

const reads = vi.hoisted(() => ({ phase: "connected", queries: [] as unknown[] }));

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
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: (atom: unknown) => {
    reads.queries.push(atom);
    return { data: null, error: null, isPending: false, refresh: () => {} };
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

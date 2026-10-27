import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { ArchivedThreadsPanel } from "./SettingsPanels";

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => () => {},
  useLocation: () => "",
}));
vi.mock("../../state/entities", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../state/entities")>()),
  useProjects: () => [],
}));
vi.mock("../../hooks/useThreadActions", () => ({ useThreadActions: () => ({}) }));
vi.mock("../../lib/archivedThreadsState", () => ({
  useArchivedThreadSnapshots: () => ({
    snapshots: [],
    error: null,
    isLoading: false,
    refresh: () => {},
  }),
}));

describe("ArchivedThreadsPanel", () => {
  it("says it lists only the Mates the app is connected to", () => {
    expect(renderToStaticMarkup(<ArchivedThreadsPanel />)).toContain(
      "Only Mates the app is connected to.",
    );
  });
});

import { crewSnapshotFixture } from "@t3tools/client-runtime/zerops/crew/testing/fixtures";
import { deriveCrewView, type CrewView } from "@t3tools/client-runtime/zerops/projections/crew";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({ view: null as CrewView | null }));

vi.mock("@tanstack/react-router", () => ({ useRouter: () => ({ navigate: vi.fn() }) }));
vi.mock("~/zerops/crew/useCrew", () => ({ useCrew: () => ({ view: state.view }) }));
vi.mock("~/zerops/crew/useCrewCommand", () => ({
  crewFailureSentence: () => "",
  useCrewCommand: () => ({
    send: vi.fn(),
    isPending: () => false,
    error: null,
    clearError: vi.fn(),
  }),
}));
vi.mock("~/state/use-atom-command", () => ({ useAtomCommand: () => vi.fn() }));
vi.mock("~/zerops/useZeropsMates", () => ({
  useZeropsMate: () => ({ kind: "mate", mate: { name: "Fen", tint: "amber", connected: true } }),
}));

import { CrewmateHeader } from "./CrewmateHeader";

const FEN = EnvironmentId.make("env-fen");
const BACKEND = { crew: "shop", crewmate: "backend", stint: 2 } as const;

const render = () =>
  renderToStaticMarkup(
    <CrewmateHeader
      environmentId={FEN}
      onEditJob={() => {}}
      origin={BACKEND}
      threadId={ThreadId.make("thread-crew-backend-2")}
    />,
  );

describe("CrewmateHeader", () => {
  beforeEach(() => {
    state.view = deriveCrewView(crewSnapshotFixture(), [], () => {
      throw new Error("no shells in this test");
    });
  });

  it("heads the chat with the crewmate and the version its next turn brings in", () => {
    const html = render();
    expect(html).toContain('data-zerops-surface="header-crewmate"');
    expect(html).toContain(">Backend<");
    expect(html).toContain(">@backend<");
    expect(html).toContain("Owns the API under src/api and its tests.");
    expect(html).toContain('data-zerops-chip-tone="attention"');
    expect(html).toContain("v5 at next turn");
    expect(html).toContain('aria-label="More for @backend"');
  });

  it("names the crewmate by the thread's own origin while the crew is not read yet", () => {
    state.view = null;
    const html = render();
    expect(html).toContain(">@backend<");
    expect(html).not.toContain("data-zerops-chip-tone");
  });
});

import { crewSnapshotFixture } from "@t3tools/client-runtime/zerops/crew/testing/fixtures";
import {
  deriveCrewView,
  type CrewShellInput,
  type CrewThreadRead,
} from "@t3tools/client-runtime/zerops/projections/crew";
import { EnvironmentId, ThreadId, type CrewSnapshot } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { CrewRead } from "~/zerops/crew/useCrew";

import { CrewPanelBody } from "./CrewPanel";

// The editors and dialogs the tab mounts closed read the live feed; the tab
// itself is handed its crew.
vi.mock("~/zerops/crew/useCrew", async (original) => ({
  ...(await original<typeof import("~/zerops/crew/useCrew")>()),
  useCrew: (): CrewRead => ({ status: null, snapshot: null, view: null, current: false }),
}));
vi.mock("~/zerops/crew/useCrewCommand", () => ({
  useCrewCommand: () => ({
    send: async () => null,
    readFiles: async () => null,
    writeFiles: async () => false,
    pending: false,
    isPending: () => false,
    error: null,
    errorAt: () => null,
    lastRefusal: () => null,
    clearError: () => undefined,
  }),
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => async () => undefined,
  useRouter: () => ({ navigate: async () => undefined }),
}));
// Which Mates' setup sheets the left menu asked for (`crewTab.ts`).
const setupAsks = vi.hoisted(() => ({
  open: new Set<string>(),
  setOpen: vi.fn(),
}));
vi.mock("~/zerops/crew/crewTab", () => ({
  useCrewSetupSheet: (environmentId: string) =>
    [
      setupAsks.open.has(environmentId),
      (open: boolean) => setupAsks.setOpen(environmentId, open),
    ] as const,
}));
// The setup sheet as the tab mounts it: whether it is open, and its way to close.
const setupSheet = vi.hoisted(() => ({
  last: undefined as
    | { readonly open: boolean; readonly onOpenChange: (open: boolean) => void }
    | undefined,
}));
vi.mock("./CrewSetupSheet", () => ({
  CrewSetupSheet: (props: {
    readonly open: boolean;
    readonly onOpenChange: (open: boolean) => void;
  }) => {
    setupSheet.last = props;
    return <div data-crew-setup-open={String(props.open)} />;
  },
}));

const ENVIRONMENT = EnvironmentId.make("env-crew");

const IDLE: CrewThreadRead = {
  status: { kind: "idle", toneId: "neutral" },
  word: null,
  working: false,
};

const APPLIED = crewSnapshotFixture();
/** A Mate with crew mode on and no crew yet: nothing applied, nothing on the board. */
const NONE: CrewSnapshot = {
  ...APPLIED,
  status: "none",
  crew: null,
  crewmates: [],
  hosts: [],
  board: { tasks: [] },
  run: null,
  attention: [],
  landedNotDelivered: 0,
};

function readOf(snapshot: CrewSnapshot): CrewRead {
  const shells: ReadonlyArray<CrewShellInput> = snapshot.crewmates.flatMap((crewmate) =>
    crewmate.currentThreadId === null
      ? []
      : [{ id: crewmate.currentThreadId, archivedAt: null, crew: null }],
  );
  const view = deriveCrewView(snapshot, shells, (shell) =>
    shell.id === ThreadId.make("thread-crew-backend-2")
      ? { status: { kind: "working", toneId: "active" }, word: "Working", working: true }
      : IDLE,
  );
  return {
    status: snapshot.status,
    snapshot,
    view: view as CrewRead["view"],
    current: true,
  };
}

const render = (crew: CrewRead) =>
  renderToStaticMarkup(
    <CrewPanelBody
      crew={crew}
      environmentId={ENVIRONMENT}
      mate={{ name: "Fen", tint: "amber" }}
      onAskMate={() => undefined}
      treeCwd="/var/www"
    />,
  );

/** The visible text, tags stripped, whitespace folded. */
const textOf = (html: string) =>
  html
    .replace(/<[^>]*>/gu, " ")
    .replace(/&#x27;/gu, "'")
    .replace(/\s+/gu, " ")
    .trim();

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

describe("CrewPanelBody — the Crew tab, the crew's one home", () => {
  it("draws nothing while the crew feed has not answered", () => {
    expect(render({ status: null, snapshot: null, view: null, current: false })).toBe("");
  });

  it("says crew mode is off in a tab kept open after it went off", () => {
    const text = textOf(render({ status: "off", snapshot: null, view: null, current: false }));
    expect(text).toBe("Crew mode is off in this Mate.");
  });

  it("offers a Mate without a crew its setup, and no board", () => {
    const html = render(readOf(NONE));
    const text = textOf(html);
    expect(html).toContain('data-crew-section="none"');
    expect(text).toContain(
      "Named crewmates, each with its own job and its own copy of the code. You review and land their work into your tree.",
    );
    expect(html).toMatch(/<button[^>]*>Set up a crew<\/button>/u);
    expect(html).not.toContain("data-crew-board");
    // Setup is here now: nothing sends the person to another tab for it.
    expect(text).not.toContain("Zerops tab");
  });

  it("lays a crew out in one column: its section first, then its board", () => {
    const html = render(readOf(APPLIED));
    const section = html.indexOf('data-crew-section="applied"');
    const board = html.indexOf("data-crew-board");
    expect(section).toBeGreaterThanOrEqual(0);
    expect(board).toBeGreaterThan(section);
    // One column: the section and the board are the column's two blocks.
    expect(count(html, "data-crew-panel-block")).toBe(2);
  });

  it("names the crew once, in the section's header; the board heads its tasks", () => {
    const text = textOf(render(readOf(APPLIED)));
    expect(count(text, "Camera and HUD rework")).toBe(1);
    expect(count(text, "Running · 1 h 12 m")).toBe(1);
    expect(text).toContain("Board + New task Waiting on you 4");
  });

  it("drops the section's link to the board, which stands right under it", () => {
    const text = textOf(render(readOf(APPLIED)));
    expect(text).not.toMatch(/Board · \d+ tasks?/u);
  });

  it("keeps Review plan, which brings the board's plan into view", () => {
    expect(render(readOf(APPLIED))).toContain(">Review plan<");
  });
});

describe("CrewPanelBody — Set up a crew asked for from the left menu", () => {
  beforeEach(() => {
    setupAsks.open = new Set();
    setupAsks.setOpen.mockClear();
  });

  it("opens the setup sheet as the tab draws the Mate's crew", () => {
    expect(render(readOf(NONE))).toContain('data-crew-setup-open="false"');
    setupAsks.open = new Set([ENVIRONMENT]);
    expect(render(readOf(NONE))).toContain('data-crew-setup-open="true"');
  });

  it("opens no other Mate's sheet", () => {
    setupAsks.open = new Set([EnvironmentId.make("env-other")]);
    expect(render(readOf(NONE))).toContain('data-crew-setup-open="false"');
  });

  it("puts the ask away as the sheet closes", () => {
    setupAsks.open = new Set([ENVIRONMENT]);
    render(readOf(NONE));
    setupSheet.last?.onOpenChange(false);
    expect(setupAsks.setOpen).toHaveBeenCalledExactlyOnceWith(ENVIRONMENT, false);
  });
});

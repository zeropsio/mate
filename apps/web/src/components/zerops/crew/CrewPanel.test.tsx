import { crewAccess, type CrewLock } from "@t3tools/client-runtime/zerops/crew/crewAccess";
import { crewSnapshotFixture } from "@t3tools/client-runtime/zerops/crew/testing/fixtures";
import { deriveCrewView } from "@t3tools/client-runtime/zerops/projections/crew";
import { EnvironmentId, type CrewSnapshot } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { CrewTabView } from "~/zerops/crew/crewTab";
import type { CrewRead } from "~/zerops/crew/useCrew";

import { CrewPanelBody } from "./CrewPanel";

// The dialogs the tab mounts closed read the live feed; the tab itself is
// handed its crew.
vi.mock("~/zerops/crew/useCrew", async (original) => ({
  ...(await original<typeof import("~/zerops/crew/useCrew")>()),
  useCrew: (): CrewRead => ({ status: null, snapshot: null, view: null, current: false }),
}));
vi.mock("~/zerops/crew/useCrewCommand", () => ({
  useCrewCommand: () => ({
    files: { state: "unread", waitingFor: "mate-session" },
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
// The view the tab holds (`crewTab.ts`, which its own tests cover): the left
// menu's or the conversation line's ask, taken up.
const tab = vi.hoisted(() => ({ view: null as CrewTabView | null }));
vi.mock("~/zerops/crew/crewTab", () => ({
  useCrewView: () => [tab.view, () => undefined] as const,
}));

const ENVIRONMENT = EnvironmentId.make("env-crew");

const APPLIED = crewSnapshotFixture();
/** A Mate with crew mode on and no crew yet: nothing applied, nothing to do. */
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
  const view = deriveCrewView(snapshot, [], () => {
    throw new Error("no shells here");
  });
  return {
    status: snapshot.status,
    snapshot,
    view: view as CrewRead["view"],
    current: true,
  };
}

/** Every login of Fen's closed to the viewer: signed in by another project member. */
const CLOSED = (login: string): CrewLock => ({
  login,
  agentId: "claude-code",
  ownership: "someone-else",
});

const render = (crew: CrewRead, viewer: "runs it" | "may not" = "runs it") =>
  renderToStaticMarkup(
    <CrewPanelBody
      access={crewAccess({
        snapshot: crew.snapshot,
        lockOf: viewer === "runs it" ? () => null : CLOSED,
        defaultLogin: "claudeAgent",
        reading: false,
      })}
      askLock={viewer === "runs it" ? null : CLOSED("claudeAgent")}
      crew={crew}
      environmentId={ENVIRONMENT}
      mate={{ name: "Fen", tint: "amber" }}
      onAskMate={() => undefined}
      onSignIn={() => undefined}
      treeCwd="/var/www"
    />,
  );

/** The visible text, tags stripped, whitespace folded. */
const textOf = (html: string) =>
  html
    .replace(/<[^>]*>/gu, " ")
    .replace(/&#x27;/gu, "'")
    .replace(/\u00a0/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

afterEach(() => {
  tab.view = null;
});

describe("CrewPanelBody — the Crew tab, the crew's one home", () => {
  it("draws nothing while the crew feed has not answered", () => {
    expect(render({ status: null, snapshot: null, view: null, current: false })).toBe("");
  });

  it("says crew mode is off in a tab kept open after it went off", () => {
    const text = textOf(render({ status: "off", snapshot: null, view: null, current: false }));
    expect(text).toBe("Crew mode is off in this Mate.");
  });

  it("offers a Mate without a crew what a crew is and one press, and no column", () => {
    const html = render(readOf(NONE));
    expect(html).toContain('data-crew-section="none"');
    expect(textOf(html)).toContain("Give Fen a crew");
    expect(html).toMatch(/<button[^>]*>Set up a crew<\/button>/u);
    expect(html).not.toContain("data-crew-rows");
    // Setup is here: nothing sends the person to another tab for it.
    expect(textOf(html)).not.toContain("Zerops tab");
  });

  it("lays a crew out in one column: its head, the composer, its rows, then Fen's code", () => {
    const html = render(readOf(APPLIED));
    const order = [
      "data-crew-head",
      "data-crew-composer",
      "data-crew-rows",
      "data-crew-in-code",
    ].map((marker) => html.indexOf(marker));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((left, right) => left - right)).toEqual(order);
    // No board, no second heading of the crew's name.
    expect(html).not.toContain("data-crew-board");
    expect(count(textOf(html), "Camera and HUD rework")).toBe(1);
  });

  it("paints its first screen in place: nothing slides on a first paint", () => {
    const html = render(readOf(APPLIED));
    expect(html).toContain('data-crew-screen="column"');
    expect(html).not.toContain("data-enter");
  });
});

describe("CrewPanelBody — a view in place of the column", () => {
  it("draws the setup in place of the empty state", () => {
    tab.view = { kind: "setup" };
    const html = render(readOf(NONE));
    expect(html).toContain('data-crew-screen="setup"');
    expect(textOf(html)).toContain("Set up Fen's crew");
    expect(html).not.toContain('data-crew-section="none"');
  });

  it.each([
    [{ kind: "goal" } as const, "goal", "The crew's goal"],
    [{ kind: "job", handle: "backend" } as const, "job:backend", "Crew"],
  ])("draws %o in place of the column, with its way back", (view, screen, words) => {
    tab.view = view;
    const html = render(readOf(APPLIED));
    expect(html).toContain(`data-crew-screen="${screen}"`);
    expect(textOf(html)).toContain(words);
    expect(html).not.toContain("data-crew-rows");
  });
});

describe("CrewPanelBody — for a viewer who may not run the crew (D6)", () => {
  it.each([
    [{ kind: "goal" } as const, APPLIED, 'data-crew-section="applied"'],
    [{ kind: "job", handle: "backend" } as const, APPLIED, 'data-crew-section="applied"'],
    [{ kind: "setup" } as const, NONE, 'data-crew-section="none"'],
  ])("draws the tab in place of %o, a view that changes the crew", (view, snapshot, section) => {
    tab.view = view;
    const html = render(readOf(snapshot), "may not");
    expect(html).toContain('data-crew-screen="column"');
    expect(html).toContain(section);
    expect(html).not.toContain("data-crew-view");
  });

  it("says why a crew cannot be set up here, in place of the press", () => {
    const html = render(readOf(NONE), "may not");
    expect(textOf(html)).toContain(
      "Signed in by another project member — only they can run this crew.",
    );
    expect(html).not.toMatch(/<button[^>]*>Set up a crew<\/button>/u);
  });
});

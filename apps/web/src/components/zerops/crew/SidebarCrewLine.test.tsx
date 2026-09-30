import { crewSnapshotFixture } from "@t3tools/client-runtime/zerops/crew/testing/fixtures";
import { deriveCrewView } from "@t3tools/client-runtime/zerops/projections/crew";
import { EnvironmentId } from "@t3tools/contracts";
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { create, type ReactTestInstance } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { closeAccountLifetime, openAccountLifetime } from "../../../zerops/accountLifetime";
import { menuMemory, rememberedCrewOf, rememberMenu, withCrews } from "../../../zerops/menuMemory";
import { ReviewContext } from "../../../zerops/review";
import { SidebarCrewLine } from "./SidebarCrewLine";

const read = vi.hoisted(() => ({ current: null as unknown, closed: false }));
vi.mock("../../../zerops/crew/useCrew", () => ({ useCrew: () => read.current }));
// Whose the crew's logins are: every one somebody else's while `closed` (D6).
vi.mock("../../../zerops/crew/useCrewAccess", async () => {
  const { crewAccess } = await import("@t3tools/client-runtime/zerops/crew/crewAccess");
  return {
    useCrewAccess: (_environmentId: unknown, snapshot: never) =>
      crewAccess({
        snapshot,
        lockOf: (login) =>
          read.closed ? { login, agentId: "claude-code", ownership: "someone-else" } : null,
        defaultLogin: "claudeAgent",
        reading: false,
      }),
  };
});
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => () => undefined }));

const ENVIRONMENT = EnvironmentId.make("env-crew");

/** Everything a node says, as text. */
function text(node: ReactTestInstance): string {
  return node.children.map((child) => (typeof child === "string" ? child : text(child))).join("");
}

/** The fixture's crew with nothing waiting on you, and task 13 ready for your Land. */
function applied(overrides: { readonly ready?: boolean; readonly waiting?: boolean } = {}) {
  const fixture = crewSnapshotFixture();
  const snapshot = {
    ...fixture,
    attention: overrides.waiting === true ? fixture.attention.slice(0, 1) : [],
    board: {
      tasks: fixture.board.tasks.map((task) =>
        overrides.ready === true && task.id === "task-13"
          ? { ...task, state: "ready" as const }
          : task,
      ),
    },
  };
  const view = deriveCrewView(snapshot, [], () => {
    throw new Error("no shells here");
  });
  return { status: "applied", snapshot, view, current: true };
}

describe("SidebarCrewLine", () => {
  it("draws every crewmate's face whole, the lead first, each opening its chat", () => {
    read.current = applied();
    const markup = renderToStaticMarkup(
      <SidebarCrewLine environmentId={ENVIRONMENT} mine projectId="crm-dev" />,
    );
    expect(markup.match(/aria-label="Open [^"]+"/gu)).toEqual([
      'aria-label="Open Lead, the lead"',
      'aria-label="Open Backend"',
      'aria-label="Open Frontend"',
      'aria-label="Open Erik"',
    ]);
    // Whole faces at 20 px, never a "+1" of slivers.
    expect(markup.match(/data-mate-face-size="sm"/gu)).toHaveLength(4);
    expect(markup).not.toContain("+1");
    // Nothing waits on you, so the line says nothing and offers nothing.
    expect(markup).toContain('data-zerops-surface="sidebar-crew-fact"></span>');
    expect(markup).not.toContain("sidebar-crew-review");
  });

  it("says who needs you, in the words' second ink, with no Review", () => {
    read.current = applied({ waiting: true, ready: true });
    const markup = renderToStaticMarkup(
      <SidebarCrewLine environmentId={ENVIRONMENT} mine projectId="crm-dev" />,
    );
    expect(markup).toContain(">Erik needs you</span>");
    expect(markup).not.toContain("sidebar-crew-review");
  });

  it("offers Review where a task waits for your Land, opening that task's review", () => {
    read.current = applied({ ready: true });
    const openReview = vi.fn();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    // Mounted for pressing with no DOM: an event target stands in for the
    // window, and nothing is an element (as the tree's own tests mount it).
    const noDom = Object.fromEntries(
      ["Node", "Element", "HTMLElement", "ShadowRoot"].map((name) => [name, function none() {}]),
    );
    vi.stubGlobal("window", Object.assign(new EventTarget(), noDom));
    for (const [name, type] of Object.entries(noDom)) vi.stubGlobal(name, type);
    let tree: ReturnType<typeof create> | undefined;
    act(() => {
      tree = create(
        <ReviewContext.Provider value={openReview}>
          <SidebarCrewLine environmentId={ENVIRONMENT} mine projectId="crm-dev" />
        </ReviewContext.Provider>,
      );
    });
    if (tree === undefined) throw new Error("not drawn");
    const review = tree.root.find(
      (node) =>
        node.type === "button" && node.props["data-zerops-surface"] === "sidebar-crew-review",
    );
    const fact = tree.root.find(
      (node) => node.props["data-zerops-surface"] === "sidebar-crew-fact",
    );
    expect(text(fact)).toBe("Frontend's work is ready");
    // In a narrow menu the fact gives way to the faces; its Review still names it.
    expect(review.props["aria-label"]).toBe("Review: Frontend's work is ready");
    const pressed = { tagName: "BUTTON" };
    act(() => {
      review.props.onClick({ currentTarget: pressed });
    });
    expect(openReview).toHaveBeenCalledWith(
      { kind: "crew-task", environmentId: ENVIRONMENT, taskId: "task-13" },
      { from: pressed },
    );
    act(() => {
      tree?.unmount();
    });
    vi.unstubAllGlobals();
  });

  it("offers no Review where the task's crewmate is not the viewer's to run (D6)", () => {
    read.current = applied({ ready: true });
    read.closed = true;
    try {
      const markup = renderToStaticMarkup(
        <SidebarCrewLine environmentId={ENVIRONMENT} mine projectId="crm-dev" />,
      );
      expect(markup).toContain('data-zerops-surface="sidebar-crew-fact"');
      expect(markup).not.toContain("sidebar-crew-review");
    } finally {
      read.closed = false;
    }
  });

  it("draws a crew handed in instead of reading the feed", () => {
    read.current = { status: null, snapshot: null, view: null, current: true };
    const { view, snapshot } = applied({ ready: true });
    const markup = renderToStaticMarkup(
      <SidebarCrewLine
        mine
        environmentId={ENVIRONMENT}
        projectId="crm-dev"
        read={{ status: "applied", view, attention: snapshot.attention }}
      />,
    );
    expect(markup).toContain(">Frontend&#x27;s work is ready</span>");
  });

  it("draws nothing without an applied crew", () => {
    read.current = { status: "none", snapshot: null, view: null, current: true };
    expect(
      renderToStaticMarkup(
        <SidebarCrewLine environmentId={ENVIRONMENT} mine projectId="crm-dev" />,
      ),
    ).toBe("");
  });
});

// A reload draws the line where it stood, so no row moves when the crew's
// feed answers: the faces this browser last read, at rest, with nothing that
// is only true now — no fact, no Review — until the feed says them again.
describe("SidebarCrewLine across a reload", () => {
  const stored = new Map<string, string>();
  const withStorage = () => {
    stored.clear();
    const noDom = Object.fromEntries(
      ["Node", "Element", "HTMLElement", "ShadowRoot"].map((name) => [name, function none() {}]),
    );
    vi.stubGlobal(
      "window",
      Object.assign(new EventTarget(), noDom, {
        localStorage: {
          getItem: (key: string) => stored.get(key) ?? null,
          setItem: (key: string, value: string) => stored.set(key, value),
          removeItem: (key: string) => stored.delete(key),
        },
      }),
    );
    for (const [name, type] of Object.entries(noDom)) vi.stubGlobal(name, type);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    openAccountLifetime("user-ada");
  };
  afterEach(() => {
    closeAccountLifetime();
    vi.unstubAllGlobals();
  });
  const unread = { status: null, snapshot: null, view: null, current: false };

  it("keeps the line's place with the faces it last read, until the feed answers", () => {
    withStorage();
    const { view } = applied();
    const crew = rememberedCrewOf(
      view.crewmates.map((row) => ({
        handle: row.crewmate.handle,
        displayName: row.crewmate.displayName,
        tint: row.crewmate.tint,
        lead: row.crewmate.kind === "lead",
      })),
    );
    rememberMenu((memory) => withCrews(memory, { "crm-dev": crew }));
    read.current = unread;
    // Not connected yet: no environment to read a crew from.
    const markup = renderToStaticMarkup(
      <SidebarCrewLine environmentId={undefined} mine projectId="crm-dev" />,
    );
    expect(markup).toContain('data-zerops-surface="sidebar-crew"');
    expect(markup.match(/data-mate-face-state="idle"/gu)).toHaveLength(4);
    // At rest: no chat opened from memory, no fact and no Review.
    expect(markup).not.toContain("<button");
    expect(markup).toContain('data-zerops-surface="sidebar-crew-fact"></span>');
    expect(markup).not.toContain("sidebar-crew-review");
  });

  it("draws nothing where no crew was read or remembered", () => {
    withStorage();
    read.current = unread;
    expect(
      renderToStaticMarkup(<SidebarCrewLine environmentId={undefined} mine projectId="crm-dev" />),
    ).toBe("");
  });

  it("remembers the crew it reads, and forgets one that is gone", () => {
    withStorage();
    read.current = applied();
    let tree: ReturnType<typeof create> | undefined;
    act(() => {
      tree = create(<SidebarCrewLine environmentId={ENVIRONMENT} mine projectId="crm-dev" />);
    });
    expect(menuMemory().crews["crm-dev"]?.faces.map((face) => face.handle)).toEqual([
      "lead",
      "backend",
      "frontend",
      "erik",
    ]);
    read.current = { status: "none", snapshot: null, view: null, current: true };
    act(() => {
      tree?.update(<SidebarCrewLine environmentId={ENVIRONMENT} mine projectId="crm-dev" />);
    });
    expect(menuMemory().crews["crm-dev"]).toBeUndefined();
    act(() => {
      tree?.unmount();
    });
  });
});

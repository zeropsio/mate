import { crewSnapshotFixture } from "@t3tools/client-runtime/zerops/crew/testing/fixtures";
import { EnvironmentId } from "@t3tools/contracts";
import type { CrewDigest, OverviewLogins } from "@t3tools/shared/mateLink";
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { create, type ReactTestInstance } from "react-test-renderer";
import { describe, expect, it, vi } from "vite-plus/test";

import type { MateCrewRead } from "../../../zerops/crew/useCrew";
import { ReviewContext } from "../../../zerops/review";
import { SidebarCrewLine } from "./SidebarCrewLine";

/** What HQ holds of the Mate's crew, as a test sets it. */
const hq = vi.hoisted(() => ({ read: undefined as unknown }));
vi.mock("../../../zerops/crew/useCrew", () => ({ useMateCrew: () => hq.read }));
// Who is looking: Ada.
vi.mock("../../../zerops/ZeropsSessionProvider", () => ({
  useZeropsSessionOptional: () => ({ user: { id: "ada" } }),
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => () => undefined }));

const ENVIRONMENT = EnvironmentId.make("env-crew");

/** Everything a node says, as text. */
function text(node: ReactTestInstance): string {
  return node.children.map((child) => (typeof child === "string" ? child : text(child))).join("");
}

/**
 * The fixture's crew as its Mate's overview carries it: nothing waiting on you unless `waiting`,
 * task 13 ready for your Land when `ready`, every crewmate on Claude Code's login, Ada's.
 */
function hqCrew(
  input: { readonly ready?: boolean; readonly waiting?: boolean } = {},
  read: Partial<MateCrewRead> = {},
): MateCrewRead {
  const fixture = crewSnapshotFixture();
  const crew: CrewDigest & { readonly status: "applied" } = {
    status: "applied",
    crewmates: fixture.crewmates.map((mate) => ({
      handle: mate.handle,
      displayName: mate.displayName,
      tint: mate.tint,
      lead: mate.kind === "lead",
      threadId: mate.currentThreadId,
      threadKind: "idle",
      loginKey: "claude-code",
    })),
    attention:
      input.waiting === true
        ? fixture.attention.slice(0, 1).map(({ id, kind, handle }) => ({ id, kind, handle }))
        : [],
    readyTasks: input.ready === true ? [{ id: "task-13", owner: "frontend" }] : [],
    personLands: true,
  };
  const logins: OverviewLogins = {
    "claude-code": { signedInBy: "ada", present: true, token: false },
  };
  return { status: "applied", crew, logins, current: true, environmentId: ENVIRONMENT, ...read };
}

describe("SidebarCrewLine", () => {
  it("draws the crew of a Mate it holds no socket to, from HQ's overview", () => {
    hq.read = hqCrew();
    const markup = renderToStaticMarkup(<SidebarCrewLine mine projectId="crm-dev" />);
    // Each face opens its crewmate's chat, on the Mate HQ names: the route connects it.
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
    hq.read = hqCrew({ waiting: true, ready: true });
    const markup = renderToStaticMarkup(<SidebarCrewLine mine projectId="crm-dev" />);
    expect(markup).toContain(">Erik needs you</span>");
    expect(markup).not.toContain("sidebar-crew-review");
  });

  it("offers Review where a task waits for your Land, opening that task's review", () => {
    hq.read = hqCrew({ ready: true });
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
          <SidebarCrewLine mine projectId="crm-dev" />
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
    hq.read = hqCrew(
      { ready: true },
      { logins: { "claude-code": { signedInBy: "bo", present: true, token: false } } },
    );
    const markup = renderToStaticMarkup(<SidebarCrewLine mine projectId="crm-dev" />);
    expect(markup).toContain('data-zerops-surface="sidebar-crew-fact"');
    expect(markup).not.toContain("sidebar-crew-review");
  });

  it("draws a crew handed in instead of reading HQ's", () => {
    hq.read = hqCrew({}, { crew: null });
    const { crew, logins } = hqCrew({ ready: true });
    const markup = renderToStaticMarkup(
      <SidebarCrewLine mine projectId="crm-dev" read={{ status: "applied", crew, logins }} />,
    );
    expect(markup).toContain(">Frontend&#x27;s work is ready</span>");
  });

  it("draws nothing without an applied crew", () => {
    hq.read = hqCrew({}, { crew: null });
    expect(renderToStaticMarkup(<SidebarCrewLine mine projectId="crm-dev" />)).toBe("");
  });

  // HQ not answering now, or the Mate asleep: the faces keep the line's place, at rest, with
  // nothing that is only true now — no chat opened from them, no fact and no Review.
  it.each([
    { case: "HQ's answer is not current", read: { current: false } },
    { case: "its Mate sleeps", read: { current: false, environmentId: undefined } },
  ])("draws the crew at rest where what it does is not known now: $case", ({ read }) => {
    hq.read = hqCrew({ waiting: true, ready: true }, read);
    const markup = renderToStaticMarkup(<SidebarCrewLine mine projectId="crm-dev" />);
    expect(markup).toContain('data-zerops-surface="sidebar-crew"');
    expect(markup.match(/data-mate-face-state="idle"/gu)).toHaveLength(4);
    expect(markup).not.toContain("<button");
    expect(markup).toContain('data-zerops-surface="sidebar-crew-fact"></span>');
    expect(markup).not.toContain("sidebar-crew-review");
  });
});

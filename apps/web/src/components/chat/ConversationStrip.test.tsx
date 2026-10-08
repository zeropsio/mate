import { markupDom } from "../../../test/markupDom";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { crewSnapshotFixture } from "@t3tools/client-runtime/zerops/crew/testing/fixtures";
import { deriveCrewView, type CrewView } from "@t3tools/client-runtime/zerops/projections/crew";
import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId, TurnId } from "@t3tools/contracts";
import { resolveThreadStatus } from "@t3tools/shared/threadStatus";
import { act, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const FEN = EnvironmentId.make("env-fen");

const state = vi.hoisted(() => ({
  shells: [] as Array<unknown>,
  mate: true,
  view: null as unknown,
  /** The crew HQ holds of the Mate: its digest, or none. */
  hqCrew: null as unknown,
}));

vi.mock("@tanstack/react-router", () => ({ useRouter: () => ({ navigate: vi.fn() }) }));
vi.mock("~/routes/-environmentTargets", async (original) => ({
  ...(await original<typeof import("~/routes/-environmentTargets")>()),
  useEnvironmentReachability: () => null,
}));
vi.mock("~/state/entities", () => ({ useThreadShells: () => state.shells }));
vi.mock("~/uiStateStore", () => ({
  useUiStateStore: (select: (value: { threadLastVisitedAtById: object }) => unknown) =>
    select({ threadLastVisitedAtById: {} }),
}));
vi.mock("~/zerops/useZeropsMates", () => {
  const fen = { name: "Fen", tint: "amber", project: "shop", projectUrl: "", connected: true };
  return {
    useZeropsMate: () => (state.mate ? { kind: "mate", mate: fen } : { kind: "nobody" }),
    useKnownMate: () => (state.mate ? fen : undefined),
  };
});
vi.mock("~/zerops/crew/useCrew", () => ({
  useCrew: () => ({ view: state.view }),
  useMateCrew: () => ({ crew: state.hqCrew, logins: {}, current: false, environmentId: undefined }),
}));
vi.mock("~/zerops/registrationRecords", () => ({
  useRegistrationRecord: () => ({ projectRef: { projectId: "project-fen" } }),
}));
vi.mock("~/hooks/useThreadActions", async (original) => ({
  ...(await original<typeof import("~/hooks/useThreadActions")>()),
  useThreadActions: () => ({ archiveThread: vi.fn() }),
}));
// A tooltip drawn in place, in a template of its own: what a pointer reads is
// in the markup, and apart from the words standing on the line.
vi.mock("../ui/tooltip", async () => {
  const { cloneElement, isValidElement } = await import("react");
  return {
    Tooltip: ({ children }: { readonly children: ReactNode }) => <>{children}</>,
    TooltipTrigger: ({
      render,
      children,
    }: {
      readonly render: unknown;
      readonly children?: ReactNode;
    }) =>
      isValidElement(render) ? (
        children === undefined ? (
          render
        ) : (
          cloneElement(render, undefined, children)
        )
      ) : (
        <>{children}</>
      ),
    TooltipPopup: ({ children }: { readonly children: ReactNode }) => (
      <template data-tooltip="">{children}</template>
    ),
  };
});
vi.mock("../zerops/crew/CrewmateMenu", () => ({
  CrewmateMenu: ({ handle }: { readonly handle: string }) => (
    <span data-crewmate-menu-for={handle} />
  ),
}));

import type { ComposerBannerStackItem } from "./ComposerBannerStack";
import {
  ConversationStrip,
  ConversationStripView,
  useAlsoWorkingBanner,
} from "./ConversationStrip";
import type { LineCrewmate } from "./ConversationStrip.logic";

function shell(
  id: string,
  overrides: Partial<EnvironmentThreadShell> = {},
): EnvironmentThreadShell {
  return {
    id: ThreadId.make(id),
    environmentId: FEN,
    projectId: ProjectId.make("project-1"),
    title: id,
    modelSelection: {
      instanceId: ProviderInstanceId.make("claudeAgent"),
      model: "claude-opus-5-5",
    },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: "2026-09-05T10:00:00.000Z",
    updatedAt: "2026-09-05T10:00:00.000Z",
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    session: null,
    latestUserMessageAt: "2026-09-05T10:00:00.000Z",
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...overrides,
  };
}

const running = {
  turnId: TurnId.make("turn-1"),
  state: "running",
  requestedAt: "2026-09-05T10:01:00.000Z",
  startedAt: "2026-09-05T10:01:00.000Z",
  completedAt: null,
  assistantMessageId: null,
} as const;

const crewShell = (handle: string, overrides: Partial<EnvironmentThreadShell> = {}) =>
  shell(`thread-crew-${handle}-1`, {
    title: handle,
    crew: { crew: "main", crewmate: handle, stint: 1 },
    ...overrides,
  });

/** The fixture crew — a lead and three writers — its backend at work. */
function crewView(): CrewView<EnvironmentThreadShell> {
  const shells = [
    crewShell("lead"),
    shell("thread-crew-backend-2", {
      crew: { crew: "main", crewmate: "backend", stint: 2 },
      latestTurn: running,
    }),
    crewShell("frontend"),
    crewShell("erik"),
  ];
  return deriveCrewView(crewSnapshotFixture(), shells, (thread) => ({
    status: resolveThreadStatus(thread),
    word: null,
    working: false,
  }));
}

function line(input: {
  readonly current: string | null;
  readonly crewChat?: { readonly handle: string; readonly title: string };
}) {
  return renderToStaticMarkup(
    <ConversationStrip
      crewChat={input.crewChat ?? null}
      currentThreadId={input.current === null ? null : ThreadId.make(input.current)}
      environmentId={FEN}
      onEditBrief={() => {}}
      onEditJob={() => {}}
      onRename={() => {}}
      renameField={null}
      subject="Build the game server"
    />,
  );
}

/** The Mate's pill: its band, and what it holds up to its name's end. */
function matePill(html: string): string {
  const start = html.indexOf("data-conversation-mate");
  return html.slice(html.lastIndexOf("<div", start), html.indexOf(">Fen</span>", start));
}

/** The words standing on the line: the markup without what shows only on hover. */
function onLine(html: string): string {
  return html.replace(/<template data-tooltip="">[\s\S]*?<\/template>/g, "");
}

/** What shows on hover, tooltip by tooltip, as read: a line of it to a line. */
function tooltips(html: string): ReadonlyArray<string> {
  return [...html.matchAll(/<template data-tooltip="">([\s\S]*?)<\/template>/g)].map((match) =>
    match[1]!
      .replaceAll("</span><span", "</span>\n<span")
      .replace(/<[^>]+>/g, "")
      .replaceAll("&#x27;", "'")
      .replaceAll("&amp;", "&"),
  );
}

beforeEach(() => {
  state.shells = [];
  state.mate = true;
  state.view = null;
  state.hqCrew = null;
});

describe("ConversationStrip", () => {
  it.each([false, true])(
    "the header arrival follows the first open and a different Mate once, with reduced motion=%s",
    (reduced) => {
      vi.stubGlobal("window", {
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        matchMedia: () => ({ matches: reduced, addEventListener() {}, removeEventListener() {} }),
      });
      let renderer: ReactTestRenderer | undefined;
      const draw = (environmentId: EnvironmentId) => (
        <ConversationStrip
          environmentId={environmentId}
          currentThreadId={ThreadId.make("main")}
          crewChat={null}
          subject={null}
          onEditBrief={() => {}}
          onEditJob={() => {}}
          onRename={() => {}}
          renameField={null}
        />
      );
      const face = () =>
        renderer!.root.find((node) => node.props["data-zerops-primitive"] === "mate-face");
      const finish = () =>
        act(() => face().props.onAnimationEnd({ animationName: "mate-moment-peek" }));
      try {
        act(() => {
          renderer = create(draw(FEN));
        });
        expect(face().props["data-mate-face-moment"]).toBe(reduced ? undefined : "peek");
        finish();
        act(() => renderer!.update(draw(FEN)));
        expect(face().props["data-mate-face-moment"]).toBeUndefined();
        const other = EnvironmentId.make("env-other");
        act(() => renderer!.update(draw(other)));
        expect(face().props["data-mate-face-moment"]).toBe(reduced ? undefined : "peek");
        finish();
        act(() => renderer!.update(draw(other)));
        expect(face().props["data-mate-face-moment"]).toBeUndefined();
      } finally {
        act(() => renderer?.unmount());
        vi.unstubAllGlobals();
      }
    },
  );

  it("the header's parked Claude face becomes idle when the projected reset expires", () => {
    const startedAt = "2020-01-01T10:00:00.000Z";
    state.shells = [
      shell("main", {
        latestTurn: { ...running, startedAt, completedAt: null },
        session: {
          threadId: ThreadId.make("main"),
          status: "running",
          providerName: "claudeAgent",
          runtimeMode: "full-access",
          activeTurnId: running.turnId,
          lastError: "You've hit your weekly limit",
          updatedAt: startedAt,
          usageLimitResetAt: "2020-01-02T10:00:00.000Z",
        },
      }),
    ];
    const html = matePill(line({ current: "main" }));
    expect(html).toContain('data-mate-face-state="idle"');
    expect(html).not.toContain('data-mate-face-state="needs"');
  });

  it("draws nothing where no Mate lives", () => {
    state.mate = false;
    state.shells = [shell("main")];
    expect(line({ current: "main" })).toBe("");
  });

  it("names a Mate with no crew and what its chat is about", () => {
    state.shells = [shell("main")];
    const html = line({ current: "main" });
    expect(matePill(html)).not.toContain("data-on");

    expect(markupDom(html).body.textContent).toContain("Fen");
    expect(markupDom(html).body.textContent).toContain("Build the game server");

    // Written whole on the line, it has no hover to repeat it.
    expect(tooltips(html)).toEqual([]);
    expect(html).not.toContain("data-conversation-divider");
    expect(html).not.toContain("data-conversation-crew");
    expect(html).not.toContain("New chat");
    expect(html).not.toContain("Close ");
  });

  it("writes nothing after a crewless Mate's name in a chat nobody has spoken into", () => {
    state.shells = [shell("main")];
    const html = renderToStaticMarkup(
      <ConversationStrip
        crewChat={null}
        currentThreadId={ThreadId.make("main")}
        environmentId={FEN}
        onEditBrief={() => {}}
        onEditJob={() => {}}
        onRename={() => {}}
        renameField={null}
        subject={null}
      />,
    );
    expect(html).not.toContain("data-conversation-subject");

    expect(tooltips(html)).toEqual([]);
  });

  it("stands the Mate on the band on its own chat, then a divider and a face per crewmate, their names unwritten", () => {
    state.shells = [shell("main")];
    state.view = crewView();
    const html = line({ current: "main" });
    expect(matePill(html)).toContain("data-on");
    expect(html).toContain("data-conversation-divider");
    expect(html).not.toContain("data-lone-task");
    for (const who of [
      "Lead, Fen&#x27;s lead — plans and reviews the crew&#x27;s work",
      "Backend, one of Fen&#x27;s crew, Working",
      "Frontend, one of Fen&#x27;s crew",
      "Erik, one of Fen&#x27;s crew",
    ]) {
      expect(html).toContain(`aria-label="${who}"`);
    }
    for (const name of ["Lead", "Backend", "Frontend", "Erik"]) {
      expect(onLine(html)).not.toContain(`>${name}</span>`);
    }
    expect(tooltips(html)).toEqual([
      "Build the game server",
      "Lead, Fen's lead — plans and reviews the crew's work",
      "Backend, one of Fen's crew\nOwns the API under src/api and its tests.",
      "Frontend, one of Fen's crew\nOwns the game UI: the camera, the HUD and their tests.",
      "Erik, one of Fen's crew\nWrites the business plan in docs/business-plan.md.",
    ]);
    expect(
      markupDom(html).querySelectorAll(
        `button[aria-label*="Fen's crew"]:not([aria-current]), button[aria-label*="Fen's lead"]:not([aria-current])`,
      ),
    ).toHaveLength(4);
  });

  it("stands the crewmate on screen on the band, with its name and its menu, and takes the Mate off it", () => {
    state.shells = [shell("main")];
    state.view = crewView();
    const html = line({
      current: "thread-crew-backend-2",
      crewChat: { handle: "backend", title: "Backend" },
    });
    expect(matePill(html)).not.toContain("data-on");
    expect(matePill(html)).toContain("data-opens");
    expect(html).toContain('aria-label="Fen&#x27;s own chat"');
    expect(html).toMatch(/aria-current="page"[^>]*data-conversation-crewmate="backend"/);
    expect(html).toContain(">Backend</span>");
    expect(html).toContain('data-crewmate-menu-for="backend"');
    expect(
      markupDom(html).querySelectorAll(
        `button[aria-label*="Fen's crew"]:not([aria-current]), button[aria-label*="Fen's lead"]:not([aria-current])`,
      ),
    ).toHaveLength(3);
  });

  it("offers a Mate's chats from a ⌄ after its name, only while it holds more than one", () => {
    state.shells = [shell("main"), shell("logs", { title: "Logs" })];
    expect(line({ current: "main" })).toContain('aria-label="Fen&#x27;s chats"');
    state.shells = [shell("main")];
    expect(line({ current: "main" })).not.toContain("data-conversation-chats");
  });

  it("paints the crew HQ holds until its feed answers, every face at rest", () => {
    state.shells = [shell("main")];
    const crewmate = (handle: string, displayName: string, tint: string, lead: boolean) => ({
      handle,
      displayName,
      tint,
      lead,
      threadId: null,
      threadKind: "working",
      loginKey: null,
    });
    state.hqCrew = {
      crewmates: [
        crewmate("lead", "Lead", "violet", true),
        crewmate("backend", "Backend", "sky", false),
      ],
      attention: [],
      readyTasks: [],
      personLands: true,
    };
    const html = line({ current: "main" });
    expect(matePill(html)).toContain("data-on");
    expect(html).toContain('aria-label="Backend, one of Fen&#x27;s crew"');
    expect(html).not.toContain('data-mate-face-state="working"');
    expect(
      markupDom(html).querySelectorAll(
        `button[aria-label*="Fen's crew"]:not([aria-current]), button[aria-label*="Fen's lead"]:not([aria-current])`,
      ),
    ).toHaveLength(2);
  });

  it("draws every face in the line before it is measured", () => {
    state.shells = [shell("main")];
    state.view = crewView();
    const html = line({ current: "main" });
    expect(html.match(/data-conversation-seat="/g)).toHaveLength(4);
    expect(html).not.toContain('invisible absolute start-0 top-0" data-conversation-seat');
  });
});

describe("ConversationStripView", () => {
  const RULES: LineCrewmate = {
    handle: "rules",
    name: "Game Rules",
    tint: "rose",
    face: "idle",
    lead: false,
    open: true,
    known: true,
    threadId: ThreadId.make("thread-crew-rules-1"),
    role: ", one of Fen's crew",
    job: "Owns the rules engine.",
    status: null,
  };
  function press(input: { readonly crew: boolean }) {
    const onRename = vi.fn();
    const onOpen = vi.fn();
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <ConversationStripView
          chats={null}
          crew={input.crew ? [RULES] : null}
          mate={{
            name: "Fen",
            tint: "amber",
            face: "idle",
            open: !input.crew,
            threadId: ThreadId.make("main"),
            tooltip: input.crew ? "Fen's own chat" : "Build the game server",
          }}
          onCloseChat={() => {}}
          onOpen={onOpen}
          onRename={onRename}
          renameField={null}
          renderCrewmateMenu={() => null}
        />,
      );
    });
    const mate = renderer.root.find(
      (node) => node.type === "button" && node.props["data-conversation-mate-press"] === true,
    );
    return { mate, onRename, onOpen };
  }
  const KEYS = { metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };

  it("renames a crewless Mate's chat on a double-click of its name, as with a crew", () => {
    const { mate, onRename, onOpen } = press({ crew: false });
    act(() => mate.props.onDoubleClick(KEYS));
    expect(onRename).toHaveBeenCalledOnce();
    act(() => mate.props.onClick());
    expect(onOpen).not.toHaveBeenCalled();
    act(() => mate.props.onDoubleClick({ ...KEYS, metaKey: true }));
    expect(onRename).toHaveBeenCalledOnce();
  });

  const crewOf = (open: string | null, handles = ["lead", "rules", "web"]) =>
    handles.map((handle): LineCrewmate => ({
      ...RULES,
      handle,
      name: handle,
      open: handle === open,
      threadId: ThreadId.make(`thread-crew-${handle}-1`),
    }));
  function drawn(open: string | null, handles?: ReadonlyArray<string>) {
    return (
      <ConversationStripView
        chats={null}
        crew={crewOf(open, handles ? [...handles] : undefined)}
        mate={{
          name: "Fen",
          tint: "amber",
          face: "idle",
          open: open === null,
          threadId: ThreadId.make("main"),
          tooltip: null,
        }}
        onCloseChat={() => {}}
        onOpen={() => {}}
        onRename={null}
        renameField={null}
        renderCrewmateMenu={() => null}
      />
    );
  }
  const seatOf = (renderer: ReactTestRenderer, handle: string) =>
    renderer.root.find(
      (node) => node.type === "span" && node.props["data-conversation-seat"] === handle,
    );
  const labelsOf = (renderer: ReactTestRenderer) =>
    renderer.root
      .findAll(
        (node) => node.type === "span" && node.props["data-conversation-label"] !== undefined,
      )
      .map((node) => node.props["data-conversation-label"] as string);

  it("keeps each crewmate's seat through a switch: its face is drawn once, the press over it changes", () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(drawn("rules"));
    });
    const seat = seatOf(renderer, "lead");
    const face = seat.findByProps({ "data-mate-face-size": "sm" });
    act(() => renderer.update(drawn("lead")));
    expect(seatOf(renderer, "lead")).toBe(seat);
    expect(seatOf(renderer, "lead").findByProps({ "data-mate-face-size": "sm" })).toBe(face);
    expect(
      seat.find((node) => node.type === "button" && node.props["aria-current"] === "page").props[
        "data-conversation-crewmate"
      ],
    ).toBe("lead");
  });

  it.each<{
    readonly name: string;
    readonly from: string | null;
    readonly to: string | null;
    readonly handles?: ReadonlyArray<string>;
    readonly labels: ReadonlyArray<string>;
  }>([
    {
      name: "a switch folds the name left while the one opened opens",
      from: "rules",
      to: "lead",
      labels: ["open", "leaving"],
    },
    {
      name: "the Mate's own chat folds the crewmate's name left",
      from: "web",
      to: null,
      labels: ["leaving"],
    },
    { name: "leaving the Mate's own chat folds nothing", from: null, to: "web", labels: ["open"] },
    {
      name: "a crewmate added as the chat changes is placed: nothing folds",
      from: "rules",
      to: "lead",
      handles: ["lead", "rules", "web", "docs"],
      labels: ["open"],
    },
  ])("$name", ({ from, to, handles, labels }) => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(drawn(from));
    });
    act(() => renderer.update(drawn(to, handles)));
    expect(labelsOf(renderer)).toEqual(labels);
  });

  it("opens the Mate's own chat from a crewmate's, and renames nothing there", () => {
    const { mate, onRename, onOpen } = press({ crew: true });
    act(() => mate.props.onClick());
    expect(onOpen).toHaveBeenCalledWith("main");
    act(() => mate.props.onDoubleClick(KEYS));
    expect(onRename).not.toHaveBeenCalled();
  });
});

describe("useAlsoWorkingBanner", () => {
  function Probe({
    typing,
    receive,
  }: {
    readonly typing: boolean;
    readonly receive: (item: ComposerBannerStackItem | null) => void;
  }) {
    receive(
      useAlsoWorkingBanner({ environmentId: FEN, currentThreadId: ThreadId.make("logs"), typing }),
    );
    return null;
  }
  function banner(typing: boolean): ComposerBannerStackItem | null {
    const items: Array<ComposerBannerStackItem | null> = [];
    renderToStaticMarkup(<Probe receive={(item) => items.push(item)} typing={typing} />);
    return items[0] ?? null;
  }

  it("says the Mate is at work in the main chat while you type in another", () => {
    state.shells = [
      shell("main", { latestTurn: running, latestUserMessageAt: "2026-09-05T12:00:00.000Z" }),
      shell("logs", { title: "Logs", createdAt: "2026-09-05T11:00:00.000Z" }),
    ];
    expect(banner(true)).toMatchObject({
      variant: "default",
      title: "Fen is also working in your main chat — both change the same files.",
    });
    expect(banner(false)).toBeNull();
  });
});

// @vitest-environment happy-dom
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import {
  MATE_VOICE_QUIET_MS,
  type MateLink as MachineLink,
} from "@t3tools/client-runtime/zerops/environments";
import { EnvironmentId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import { act, createElement as h, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { awaitMateConversation, takeMateConversation } from "~/zerops/mateOpening";
import { beginPress, forgetPress } from "~/zerops/matePress";
import { useNewProjectBirths, type NewProjectBirth } from "~/zerops/newProjectBirth";

import { ComingBelow, comingSentenceOf, ZeropsMateComingPage } from "./ZeropsMateComingPage";
import { NOT_SET_UP_LINE } from "./ZeropsProjectRow.logic";

const ENV_QUINN = EnvironmentId.make("env-quinn");

/**
 * A Mate's link as its machine reads it; one that has not failed since it connected says none, and
 * one that has not answered says nothing of it.
 */
type MateLink = Omit<MachineLink, "failuresSinceConnect" | "errorsSinceConnect" | "answered"> & {
  readonly failuresSinceConnect?: number;
  readonly errorsSinceConnect?: number;
  readonly answered?: boolean;
};
const KEY = "beviro-quinn:zcp";
const PROJECT = "beviro-quinn";

/** Quinn, an existing Mate of Beviro, as the listing reads it: its container up, not connected here. */
const QUINN = {
  key: KEY,
  project: {
    id: PROJECT,
    name: "Beviro - Quinn",
    status: "ACTIVE",
    tagList: ["mate", "mate:g:beviro", "mate:name:Beviro", "mate:role:dev", "mate:bot:Quinn"],
  },
  group: "ready",
  service: { id: "zcp", name: "zcp", status: "ACTIVE" },
  containerOrigin: "https://zcp-beviro-quinn.example.test",
  presence: "known",
} as unknown as ZeropsCandidate;

const listingOf = (rows: ReadonlyArray<ZeropsCandidate>) => ({
  state: "known",
  value: rows,
  coverage: "complete",
  asOf: { ordinal: 1, atMs: 0 },
  freshness: { kind: "live" },
});

/** Its main conversation, once its environment's conversations are read. */
const MAIN = {
  id: ThreadId.make("thread-main"),
  environmentId: ENV_QUINN,
  archivedAt: null,
  pinnedAt: null,
  latestUserMessageAt: null,
  updatedAt: "2026-09-30T07:00:00.000Z",
  createdAt: "2026-09-30T06:00:00.000Z",
};

const app = vi.hoisted(() => ({
  navigate: vi.fn(async (_to: unknown) => undefined),
  connect: vi.fn(async (_target: unknown) => ({ _tag: "Success" as const })),
  onScreen: vi.fn((_projectId: string | null) => undefined),
  openMate: vi.fn(),
  refresh: vi.fn(),
  handingOver: vi.fn(),
  link: { key: undefined, environmentId: undefined, reachability: null } as unknown,
  listing: { state: "unread", waitingFor: null } as unknown,
  threads: [] as Array<unknown>,
  projects: [] as Array<unknown>,
  remembered: undefined as { readonly subject: string; readonly threadKey?: string } | undefined,
  creations: {} as Record<string, unknown>,
  processes: [] as Array<unknown>,
  birthProgress: false,
}));
vi.mock("~/zerops/menuMemory", () => ({ rememberedActivity: () => app.remembered }));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => app.navigate,
  Link: ({ children }: { readonly children?: ReactNode }) => h("a", null, children),
}));
vi.mock("~/routes/-environmentTargets", () => ({
  useEnvironmentLinks: () => ({ mateLink: () => app.link }),
}));
vi.mock("~/state/entities", () => ({
  // A conversation's shell once its environment's conversations are read.
  useThreadShell: (ref: { readonly threadId: string } | null) =>
    ref === null
      ? null
      : ((app.threads as Array<{ readonly id: string }>).find(
          (thread) => thread.id === ref.threadId,
        ) ?? null),
  useThreadShells: () => app.threads,
  useThreadStatus: () => "live",
  useProjects: () => app.projects,
}));
vi.mock("~/zerops/accountEnvironments", () => ({
  useConnectMate: () => app.connect,
  useAccountEnvironments: () => environments,
}));
const environments = { setOnScreen: (projectId: string | null) => app.onScreen(projectId) };
vi.mock("~/zerops/useOpenMate", () => ({ useOpenMate: () => app.openMate }));
vi.mock("~/zerops/useZeropsCandidates", () => ({
  useZeropsCandidates: () => ({ listing: app.listing, refresh: app.refresh }),
}));
// The menu's verbs: none offered on these Mates, which are all whole.
vi.mock("~/zerops/useMateActions", () => ({
  useMateActions: () => ({ actionsFor: () => [], busyKey: null, trouble: null }),
}));
vi.mock("~/zerops/useZeropsRegistry", () => ({ useZeropsRegistry: () => null }));
vi.mock("~/zerops/giteaProject", () => ({ useAccountGitea: () => undefined }));
vi.mock("~/zerops/newMate", () => ({
  useNewMate: (select: (state: unknown) => unknown) =>
    select({ creations: app.creations, forget: () => undefined, handingOver: app.handingOver }),
}));
vi.mock("~/zerops/useZeropsCreationVerdicts", () => ({
  useZeropsCreationVerdicts: () => new Map(),
}));
vi.mock("~/zerops/zeropsContainers", () => ({
  useZeropsContainers: () => ({ health: new Map() }),
}));
vi.mock("~/zerops/zeropsDataContext", () => ({
  useZeropsData: () => ({ organizationRef: (id: string) => ({ id }), runtime: {} }),
  runZeropsCommand: () => Promise.resolve(),
}));
vi.mock("~/zerops/ZeropsSessionProvider", () => ({
  useZeropsSession: () => ({ activeOrganization: null, user: { id: "u-ada" } }),
}));
// Off unless a test reads how far a birth has got: then the real derivation, at a fixed clock.
vi.mock("~/zerops/useZeropsBirthProgress", async () => {
  const { deriveBirthFacts } = await import("~/zerops/birthFacts");
  const { deriveBirthProgress } = await import("@t3tools/client-runtime/zerops/birthProgress");
  return {
    useZeropsBirthProgress: (input: Parameters<typeof deriveBirthFacts>[0] | null) =>
      !app.birthProgress || input === null
        ? null
        : {
            progress: deriveBirthProgress(deriveBirthFacts({ ...input, processes: [] }), 0),
            nowMs: 0,
          },
  };
});
vi.mock("~/zerops/useMateSetup", () => ({ useMateSetup: () => undefined }));
vi.mock("~/zerops/useUsualAgent", () => ({
  useUsualAgent: () => ({ usual: null, settled: true }),
}));
vi.mock("~/zerops/useNowMs", () => ({ useSecondsNowMs: () => 0 }));
// A slow first connect lists its project's processes; none are read here.
vi.mock("~/zerops/activity/useProjectActivity", () => ({
  useProjectActivity: () => ({ processes: app.processes }),
}));
vi.mock("~/zerops/inventoryContext", () => ({
  useZeropsInventory: () => ({ services: new Map() }),
}));
vi.mock("./ZeropsMateEmptyState", () => ({
  useMateEmptyState: () => ({
    phase: null,
    signIn: null,
    signInRequired: false,
    unknown: null,
    signInKnown: true,
    onRetry: () => undefined,
    dialog: null,
  }),
  MateEmptyStateView: ({
    coming,
    mate,
  }: {
    readonly coming: { readonly kind: string; readonly below: ReactNode };
    readonly mate: { readonly name: string };
  }) => h("section", { "data-kind": coming.kind }, mate.name, coming.below),
}));
vi.mock("../chat/ConversationStrip", () => ({
  // What the header's line says after the Mate's name: what it is on.
  ConversationStripView: ({ mate }: { readonly mate: { readonly tooltip: string | null } }) =>
    h("span", null, mate.tooltip),
}));
vi.mock("../chat/ChatHeader", () => ({ ZeropsProjectLink: () => null }));
vi.mock("../chat/PanelLayoutControls", () => ({ PanelLayoutControls: () => null }));
vi.mock("../ui/sidebar", () => ({
  SidebarInset: ({ children }: { readonly children?: ReactNode }) => h("main", null, children),
}));
vi.mock("../WorkspacePageHeader", () => ({
  WorkspacePageHeader: ({ children }: { readonly children?: ReactNode }) =>
    h("header", null, children),
}));
vi.mock("../ui/button", () => ({
  Button: ({
    children,
    onClick,
    inert,
  }: {
    readonly children?: ReactNode;
    readonly onClick?: () => void;
    readonly inert?: boolean;
  }) => h("button", { onClick, inert }, children),
}));
vi.mock("./ZeropsProjectsPage", () => ({ removeFailedZeropsProject: async () => ({ ok: true }) }));

let tree: ReactTestRenderer | undefined;

/** Quinn's own view, rendered as the route draws it. */
function openView() {
  act(() => {
    tree = create(h(ZeropsMateComingPage, { projectId: PROJECT }));
  });
}

/** Everything the view says, as one line. */
const said = () =>
  (tree?.root.findAll((node) => typeof node.type === "string") ?? [])
    .flatMap((node) => node.children.filter((child) => typeof child === "string"))
    .join(" ");

/** The verbs the view offers: what can be pressed. */
const buttons = () =>
  tree?.root
    .findAllByType("button")
    .filter((node) => node.props.disabled !== true && node.props.inert !== true)
    .map((node) => node.children.join("")) ?? [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // The composer standing in takes the focus a frame after it arrives.
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  app.navigate.mockClear();
  app.connect.mockClear();
  app.onScreen.mockClear();
  app.openMate.mockClear();
  app.refresh.mockClear();
  app.handingOver.mockClear();
  app.listing = listingOf([QUINN]);
  app.threads = [];
  app.projects = [];
  app.link = { key: undefined, environmentId: undefined, reachability: null };
  app.remembered = undefined;
  app.creations = {};
  app.processes = [];
  app.birthProgress = false;
});
afterEach(async () => {
  const { useComposerDraftStore } = await import("~/composerDraftStore");
  useComposerDraftStore.getState().setPrompt({ environmentId: ENV_QUINN, threadId: MAIN.id }, "");
  act(() => tree?.unmount());
  tree = undefined;
  takeMateConversation(PROJECT);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// The owner, 2026-09-30: "all of the sudden when I now try to open Quinn or Wren it just throws me
// at /zerops page". A Mate's own view waits for its link where it stands, connects it, and hands
// over to its conversation; nothing in it takes the person to another screen on its own.
describe("a Mate's own view while its link is made", () => {
  it("connects it once by its target, says what it waits for, and stays", () => {
    const link: MateLink = {
      key: KEY,
      environmentId: undefined,
      reachability: { kind: "reconnecting" },
    };
    app.link = link;
    openView();
    act(() => vi.advanceTimersByTime(10_000));
    openView();
    // A blip says nothing; a link lost for longer says so in the Mate's name (`mateVoice`).
    expect(said()).not.toContain("Reconnecting");
    act(() => vi.advanceTimersByTime(MATE_VOICE_QUIET_MS));

    expect(said()).toContain("Quinn");
    expect(said()).toContain("Reconnecting to Quinn…");
    expect(app.connect).toHaveBeenCalledWith({ key: KEY });
    expect(app.navigate).not.toHaveBeenCalled();
  });

  it("offers Try now where its machine backs off, which retries its link", () => {
    app.link = {
      key: KEY,
      environmentId: undefined,
      reachability: {
        kind: "retrying",
        retryAtMs: 5_000,
        last: { kind: "network" },
        restart: false,
      },
    } satisfies MateLink;
    openView();
    expect(said()).toContain("This Mate isn't answering. Trying again in 5 s.");
    expect(buttons()).toEqual(["Try now"]);
    app.connect.mockClear();
    act(() =>
      tree?.root
        .findAllByType("button")
        .find((node) => node.children.join("") === "Try now")
        ?.props.onClick(),
    );
    expect(app.connect).toHaveBeenCalledExactlyOnceWith({ key: KEY });
  });

  // The ceiling on auto-connect is for Mates not on screen (a live run, 2026-10-01: a browser
  // with 21 registered stayed on "coming up" for an hour): the Mate whose view is open is wanted
  // past it while the view stands.
  it("puts its Mate on screen while it stands, and takes it off when it goes", () => {
    openView();
    expect(app.onScreen.mock.calls).toEqual([[PROJECT]]);
    act(() => tree?.unmount());
    tree = undefined;
    expect(app.onScreen.mock.calls).toEqual([[PROJECT], [null]]);
  });

  it("waits for a machine to name it before connecting: a Connect before the stage holds it ends unheard", () => {
    app.link = { key: KEY, environmentId: undefined, reachability: null } satisfies MateLink;
    openView();
    act(() => vi.advanceTimersByTime(MATE_VOICE_QUIET_MS));
    expect(said()).toContain("Opening Quinn…");
    expect(app.connect).not.toHaveBeenCalled();
    expect(app.navigate).not.toHaveBeenCalled();
  });

  it.each([
    {
      case: "gone",
      link: {
        key: KEY,
        environmentId: undefined,
        reachability: { kind: "gone", because: "direct-not-found" },
      } satisfies MateLink,
      listing: listingOf([QUINN]),
      words: "This project is no longer available. It was deleted, or you no longer have access.",
      name: "Quinn",
    },
    {
      case: "not on the account, the listing whole",
      link: { key: undefined, environmentId: undefined, reachability: null } satisfies MateLink,
      listing: listingOf([]),
      words: "This conversation isn't in your Zerops projects.",
      name: "This Mate",
    },
  ])(
    "says why a Mate that cannot be opened is not, and stays: $case",
    ({ link, listing, words, name }) => {
      app.link = link;
      app.listing = listing;
      openView();
      act(() => vi.advanceTimersByTime(10_000));

      expect(said()).toContain(name);
      expect(said()).toContain(words);
      expect(buttons()).toEqual(["Go to projects"]);
      expect(app.connect).not.toHaveBeenCalled();
      expect(app.navigate).not.toHaveBeenCalled();
    },
  );

  it("hands over at once once its conversation can be opened, telling what its door asked", () => {
    app.link = {
      key: KEY,
      environmentId: ENV_QUINN,
      reachability: { kind: "ready", notice: null },
    } satisfies MateLink;
    app.threads = [MAIN];
    const told: Array<ScopedThreadRef> = [];
    awaitMateConversation(PROJECT, (conversation) => told.push(conversation));
    openView();
    act(() => vi.advanceTimersByTime(0));

    expect(told).toEqual([{ environmentId: ENV_QUINN, threadId: "thread-main" }]);
    expect(app.navigate).toHaveBeenCalledExactlyOnceWith({
      to: "/$environmentId/$threadId",
      params: { environmentId: ENV_QUINN, threadId: "thread-main" },
      replace: true,
    });
    // An existing Mate's hand-over is not a new Mate's stand-up.
    expect(app.handingOver).not.toHaveBeenCalled();
  });
});

// The owner, 2026-09-30: "sometimes the text area still flashed because old one is gone sooner
// than new one is in". A switch from a conversation to a Mate whose link is still being made
// lands here: its composer stands in its place, as the conversation that takes over draws it,
// never nothing until the conversation opens. A Mate coming up for the first time holds its
// composer back for its stand-up, and one that cannot be opened has nothing to write to.
describe("the composer in a Mate's own view", () => {
  const composer = () =>
    tree?.root.findAll((node) => typeof node.type === "string" && node.type === "textarea") ?? [];

  it.each([
    {
      case: "an existing Mate while its link is made",
      link: { key: KEY, environmentId: undefined, reachability: { kind: "reconnecting" } },
      candidate: QUINN,
      shown: true,
    },
    {
      case: "an existing Mate no machine names yet",
      link: { key: KEY, environmentId: undefined, reachability: null },
      candidate: QUINN,
      shown: true,
    },
    {
      case: "a Mate that cannot be opened",
      link: {
        key: KEY,
        environmentId: undefined,
        reachability: { kind: "gone", because: "direct-not-found" },
      },
      candidate: QUINN,
      shown: false,
    },
    {
      case: "a new Mate coming up",
      link: { key: KEY, environmentId: undefined, reachability: null },
      candidate: { ...QUINN, group: "provisioning" } as ZeropsCandidate,
      shown: false,
    },
  ] satisfies ReadonlyArray<{
    case: string;
    link: MateLink;
    candidate: ZeropsCandidate;
    shown: boolean;
  }>)("$case: shown $shown", ({ link, candidate, shown }) => {
    app.link = link;
    app.listing = listingOf([candidate]);
    openView();

    expect(composer().length).toBe(shown ? 1 : 0);
    if (shown) {
      expect(composer()[0]?.props.placeholder).toBe("Describe what you want to build or change…");
    }
  });

  // What the person types while the Mate connects is not lost: it is the conversation's draft
  // once it opens, the caret where they left it.
  it("hands what was typed to the conversation's draft, the caret with it", async () => {
    const { useComposerDraftStore } = await import("~/composerDraftStore");
    const { takeHandedOverCaret } = await import("~/zerops/mateHandOver");
    app.link = { key: KEY, environmentId: undefined, reachability: { kind: "reconnecting" } };
    openView();
    act(() =>
      composer()[0]?.props.onChange({
        currentTarget: { value: "Deploy it to stage", selectionEnd: 6 },
      }),
    );

    app.link = {
      key: KEY,
      environmentId: ENV_QUINN,
      reachability: { kind: "ready", notice: null },
    } satisfies MateLink;
    app.threads = [MAIN];
    act(() => tree?.update(h(ZeropsMateComingPage, { projectId: PROJECT })));
    act(() => vi.advanceTimersByTime(0));

    const conversation = { environmentId: ENV_QUINN, threadId: MAIN.id };
    expect(useComposerDraftStore.getState().getComposerDraft(conversation)?.prompt).toBe(
      "Deploy it to stage",
    );
    expect(takeHandedOverCaret(`${ENV_QUINN}:${MAIN.id}`, Date.now())).toBe(6);
  });
});

describe("the composer in a Mate's own view, its conversation known from the menu", () => {
  it("is that conversation's composer: its draft shown, what is typed its draft", async () => {
    const { useComposerDraftStore } = await import("~/composerDraftStore");
    const { takeHandedOverCaret } = await import("~/zerops/mateHandOver");
    const conversation = { environmentId: ENV_QUINN, threadId: MAIN.id };
    const threadKey = `${ENV_QUINN}:${MAIN.id}`;
    useComposerDraftStore.getState().setPrompt(conversation, "Check the logs");
    app.remembered = { subject: "Check the logs", threadKey };
    app.link = { key: KEY, environmentId: undefined, reachability: { kind: "reconnecting" } };
    openView();
    const field = () =>
      tree!.root.find((node) => typeof node.type === "string" && node.type === "textarea");
    expect(field().props.value).toBe("Check the logs");

    act(() =>
      field().props.onChange({
        currentTarget: { value: "Check the logs first", selectionEnd: 20 },
      }),
    );
    expect(useComposerDraftStore.getState().getComposerDraft(conversation)?.prompt).toBe(
      "Check the logs first",
    );

    app.link = {
      key: KEY,
      environmentId: ENV_QUINN,
      reachability: { kind: "ready", notice: null },
    } satisfies MateLink;
    app.threads = [MAIN];
    act(() => tree?.update(h(ZeropsMateComingPage, { projectId: PROJECT })));
    act(() => vi.advanceTimersByTime(0));
    expect(useComposerDraftStore.getState().getComposerDraft(conversation)?.prompt).toBe(
      "Check the logs first",
    );
    expect(takeHandedOverCaret(threadKey, Date.now())).toBe(20);
  });
});

describe("the composer in a Mate's own view, the menu naming an older conversation", () => {
  it("moves what was typed there into the conversation that opens", async () => {
    const { useComposerDraftStore } = await import("~/composerDraftStore");
    const { takeHandedOverCaret } = await import("~/zerops/mateHandOver");
    const older = { environmentId: ENV_QUINN, threadId: ThreadId.make("thread-older") };
    const conversation = { environmentId: ENV_QUINN, threadId: MAIN.id };
    app.remembered = { subject: "Earlier", threadKey: `${ENV_QUINN}:thread-older` };
    app.link = { key: KEY, environmentId: undefined, reachability: { kind: "reconnecting" } };
    openView();
    act(() =>
      tree!.root
        .find((node) => typeof node.type === "string" && node.type === "textarea")
        .props.onChange({ currentTarget: { value: "Ship it", selectionEnd: 4 } }),
    );

    app.link = {
      key: KEY,
      environmentId: ENV_QUINN,
      reachability: { kind: "ready", notice: null },
    } satisfies MateLink;
    app.threads = [MAIN];
    act(() => tree?.update(h(ZeropsMateComingPage, { projectId: PROJECT })));
    act(() => vi.advanceTimersByTime(0));

    const drafts = useComposerDraftStore.getState();
    expect(drafts.getComposerDraft(conversation)?.prompt).toBe("Ship it");
    expect(drafts.getComposerDraft(older)?.prompt ?? "").toBe("");
    expect(takeHandedOverCaret(`${ENV_QUINN}:${MAIN.id}`, Date.now())).toBe(4);
  });
});

describe("the header in a Mate's own view", () => {
  it("says what an existing Mate is on, as its menu row does, while its link is made", () => {
    app.link = { key: KEY, environmentId: undefined, reachability: { kind: "reconnecting" } };
    app.remembered = { subject: "Rename the orders column" };
    openView();
    expect(said()).toContain("Rename the orders column");
  });
});

// The arrival is one surface from the press to the sign-in (measured 2026-10-02): a Mate this tab
// made read "This Mate isn't running." for 45 s, and one that came up here flashed its name alone
// with a composer — "Almost there." for 10 s on a New project — before its sign-in.
describe("a new Mate's arrival, from the press to the sign-in", () => {
  const composer = () =>
    tree?.root.findAll((node) => typeof node.type === "string" && node.type === "textarea") ?? [];
  const kind = () => tree?.root.findAll((node) => node.type === "section")[0]?.props["data-kind"];
  const coming = {
    ...QUINN,
    group: "provisioning",
    service: { id: "zcp", name: "zcp", status: "CREATING" },
  } as unknown as ZeropsCandidate;
  const QUINN_MADE = {
    projectId: PROJECT,
    groupId: "beviro",
    groupName: "Beviro",
    botName: "Quinn",
    face: { tint: "sky", shape: "pick" },
  };

  it("a Mate this tab made is coming up from its first frame, its container up or not", () => {
    app.creations = { [PROJECT]: QUINN_MADE };
    app.link = { key: KEY, environmentId: undefined, reachability: { kind: "reconnecting" } };
    openView();
    expect(kind()).toBe("coming");
    expect(said()).not.toContain("Reconnecting");
    expect(composer()).toHaveLength(0);
  });

  it.each([
    {
      case: "its container booting",
      reachability: { kind: "container", container: { level: "booting", overdue: false } },
    },
    { case: "its link being made", reachability: { kind: "connecting", waitingOn: "exchange" } },
    { case: "its link reconnecting", reachability: { kind: "reconnecting" } },
    { case: "no machine naming it yet", reachability: null },
  ])("keeps the board once it came up here, through $case", ({ reachability }) => {
    app.listing = listingOf([coming]);
    openView();
    expect(kind()).toBe("coming");
    // Its container is up and its link not made yet: still the board, never its name alone.
    app.listing = listingOf([QUINN]);
    app.link = { key: KEY, environmentId: undefined, reachability } as MateLink;
    act(() => tree?.update(h(ZeropsMateComingPage, { projectId: PROJECT })));
    act(() => vi.advanceTimersByTime(MATE_VOICE_QUIET_MS * 3));
    expect(kind()).toBe("coming");
    expect(composer()).toHaveLength(0);
    expect(app.navigate).not.toHaveBeenCalled();
  });

  it("says its first build failed, with Remove, never coming up for good", () => {
    const building = {
      ...QUINN,
      group: "provisioning",
      service: {
        id: "zcp",
        name: "zcp",
        status: "READY_TO_DEPLOY",
        created: new Date().toISOString(),
      },
    } as unknown as ZeropsCandidate;
    app.listing = listingOf([building]);
    app.creations = { [PROJECT]: QUINN_MADE };
    openView();
    expect(kind()).toBe("coming");
    app.processes = [
      {
        actionName: "stack.build",
        serviceStackIds: ["zcp"],
        status: "FAILED",
        created: new Date().toISOString(),
        failReason: "the build failed",
      },
    ];
    act(() => tree?.update(h(ZeropsMateComingPage, { projectId: PROJECT })));
    expect(kind()).toBe("failed");
    expect(buttons()).toEqual(["Remove"]);
  });

  it("holds the board through its link's first three failures only, never taking turns with its words", () => {
    app.listing = listingOf([coming]);
    openView();
    app.listing = listingOf([QUINN]);
    const rung = (reachability: MateLink["reachability"], failuresSinceConnect: number) => {
      app.link = { key: KEY, environmentId: undefined, reachability, failuresSinceConnect };
      act(() => tree?.update(h(ZeropsMateComingPage, { projectId: PROJECT })));
      return kind();
    };
    const retrying = {
      kind: "retrying",
      retryAtMs: 5_000,
      last: { kind: "network" },
      restart: false,
    } as const;
    const connecting = { kind: "connecting", waitingOn: "exchange" } as const;
    // Its link failing on every attempt, the attempts between its back-offs read as connecting.
    expect([
      rung(connecting, 0),
      rung(retrying, 1),
      rung(connecting, 1),
      rung(retrying, 2),
      rung(connecting, 2),
      rung(retrying, 3),
      rung(connecting, 3),
      rung(retrying, 4),
      rung(connecting, 4),
      rung(retrying, 5),
    ]).toEqual([
      "coming",
      "coming",
      "coming",
      "coming",
      "coming",
      "coming",
      "coming",
      "reaching",
      "reaching",
      "reaching",
    ]);
    act(() => vi.advanceTimersByTime(MATE_VOICE_QUIET_MS * 3));
    rung(retrying, 6);
    expect(buttons()).toEqual(["Try now"]);
  });

  it("a Mate this tab made that a whole listing, read well after, lacks is not coming up", () => {
    app.creations = { [PROJECT]: { ...QUINN_MADE, at: 1_000 } };
    app.listing = { ...listingOf([]), asOf: { ordinal: 2, atMs: 1_000 + 5_000 } };
    openView();
    expect(kind()).toBe("coming");
    app.listing = { ...listingOf([]), asOf: { ordinal: 3, atMs: 1_000 + 120_000 } };
    act(() => tree?.update(h(ZeropsMateComingPage, { projectId: PROJECT })));
    expect(kind()).toBe("unreachable");
  });

  it("reads its organization's projects again once, when it is still not listed a minute on", () => {
    // Deleted while the organization's socket is live: a push takes it off the listing, whose
    // time stays the full read's, moments after the creation.
    const madeAt = Date.now();
    app.creations = { [PROJECT]: { ...QUINN_MADE, at: madeAt } };
    app.listing = { ...listingOf([]), asOf: { ordinal: 2, atMs: madeAt + 5_000 } };
    openView();
    expect(kind()).toBe("coming");
    act(() => vi.advanceTimersByTime(30_000));
    expect(app.refresh).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(40_000));
    expect(app.refresh).toHaveBeenCalledOnce();
    // The fresh read lacks it: it is gone.
    app.listing = { ...listingOf([]), asOf: { ordinal: 3, atMs: madeAt + 70_000 } };
    act(() => tree?.update(h(ZeropsMateComingPage, { projectId: PROJECT })));
    expect(kind()).toBe("unreachable");
    act(() => vi.advanceTimersByTime(120_000));
    expect(app.refresh).toHaveBeenCalledOnce();
  });

  it("never reads them again for a creation the listing holds", () => {
    const madeAt = Date.now();
    app.creations = { [PROJECT]: { ...QUINN_MADE, at: madeAt } };
    openView();
    act(() => vi.advanceTimersByTime(120_000));
    expect(app.refresh).not.toHaveBeenCalled();
  });

  it("says why once it came up here and its container stopped", () => {
    app.listing = listingOf([coming]);
    openView();
    app.listing = listingOf([QUINN]);
    app.link = {
      key: KEY,
      environmentId: undefined,
      reachability: { kind: "container", container: { level: "inactive", status: "STOPPED" } },
    } as MateLink;
    act(() => tree?.update(h(ZeropsMateComingPage, { projectId: PROJECT })));
    expect(kind()).toBe("reaching");
  });

  it("hands over once, its header turning into the conversation's with its words", () => {
    // The header's actions as the conversation draws them, standing in until it takes the route.
    const headerActions = () =>
      tree?.root.findAllByType("button").filter((node) => node.props.inert === true) ?? [];
    app.listing = listingOf([coming]);
    openView();
    expect(headerActions()).toHaveLength(0);
    app.listing = listingOf([QUINN]);
    app.link = {
      key: KEY,
      environmentId: ENV_QUINN,
      reachability: { kind: "ready", notice: null },
    };
    app.threads = [MAIN];
    act(() => tree?.update(h(ZeropsMateComingPage, { projectId: PROJECT })));
    expect(kind()).toBe("coming");
    expect(headerActions()).toHaveLength(1);
    expect(app.navigate).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1_000));
    expect(app.navigate).toHaveBeenCalledOnce();
  });
});

// A Mate whose press stopped before its container (live, 2026-10-01: its view sat on "Opening
// Hugo…" with only its managed services, and nothing could finish it).
describe("ComingBelow — a Mate half made", () => {
  const HALF_MADE = {
    kind: "failed",
    line: "Its setup stopped before its container. Finish setup completes it.",
    verb: "finish-setup",
  } as const;
  const render = (onFinishSetup: (() => void) | undefined) => {
    let rendered: ReactTestRenderer | undefined;
    act(() => {
      rendered = create(
        h(ComingBelow, {
          coming: HALF_MADE,
          progress: undefined,
          nowMs: undefined,
          mate: { name: "Quinn", project: "Acme" },
          you: null,
          ...(onFinishSetup === undefined ? {} : { onFinishSetup }),
        }),
      );
    });
    return rendered!;
  };

  it("offers Finish setup to whoever may finish it, and runs it on a press", () => {
    let finished = 0;
    const rendered = render(() => {
      finished += 1;
    });
    const button = rendered.root.findByType("button");
    expect(button.children).toEqual(["Finish setup"]);
    act(() => button.props.onClick());
    expect(finished).toBe(1);
  });

  it("offers nothing to anyone else", () => {
    expect(render(undefined).root.findAllByType("button")).toHaveLength(0);
  });
});

// Run 6's second review: a registration refused read as an owner's, with no reason and nothing to
// finish it. It says what is not done and why, with this person's Finish setup, while it comes up.
describe("ComingBelow — a registration not finished while it comes up", () => {
  const COMING = { kind: "coming", line: "Coming up." } as const;
  const progress = {
    steps: [],
    active: null,
    failed: null,
    doneCount: 0,
    total: 0,
    complete: false,
    press: [
      { id: "closed-off", label: "Closed off", state: "done" },
      {
        id: "registered",
        label: "Not registered",
        state: "unfinished",
        why: "Its grant timed out.",
      },
    ],
  } as const;
  const render = (onFinishSetup: (() => void) | undefined) => {
    let rendered: ReactTestRenderer | undefined;
    act(() => {
      rendered = create(
        h(ComingBelow, {
          coming: COMING,
          progress,
          nowMs: 0,
          mate: { name: "Ida", project: "Acme" },
          you: null,
          ...(onFinishSetup === undefined ? {} : { onFinishSetup }),
        }),
      );
    });
    return rendered!;
  };
  const text = (rendered: ReactTestRenderer) =>
    rendered.root
      .findAll((node) => node.props["data-press-note"] !== undefined)
      .map((node) => node.children.join(""));

  it("says what is not done and why, under the steps, with Finish setup at once", () => {
    let finished = 0;
    const rendered = render(() => {
      finished += 1;
    });
    expect(text(rendered)).toEqual(["Not registered: Its grant timed out."]);
    const button = rendered.root.findByType("button");
    expect(button.children).toEqual(["Finish setup"]);
    act(() => button.props.onClick());
    expect(finished).toBe(1);
  });

  it("still says why to someone who cannot finish it", () => {
    const rendered = render(undefined);
    expect(text(rendered)).toEqual(["Not registered: Its grant timed out."]);
    expect(rendered.root.findAllByType("button")).toHaveLength(0);
  });
});

// Run 6's second review: a stop's whole reason lived in a hover tooltip on a span that took no
// focus — on a phone, or by keyboard, it could not be read. Its step keeps one line; the reason is
// read whole under the steps, over Try again.
describe("ComingBelow — a stop's reason, whole, under the steps", () => {
  const REASON =
    "The organization has reached its limit of projects; remove one or ask an owner for room.";
  const progress = {
    steps: [],
    active: null,
    failed: null,
    doneCount: 0,
    total: 0,
    complete: false,
    press: [
      { id: "created", label: "Created", state: "failed", why: REASON },
      { id: "container", label: "Container", state: "waiting" },
    ],
  } as const;
  const render = (coming: Parameters<typeof ComingBelow>[0]["coming"]) => {
    let rendered: ReactTestRenderer | undefined;
    act(() => {
      rendered = create(
        h(ComingBelow, {
          coming,
          progress,
          nowMs: 0,
          mate: { name: "Ida", project: "Acme" },
          you: null,
          onTryAgain: () => undefined,
        }),
      );
    });
    return rendered!;
  };
  const notes = (rendered: ReactTestRenderer) =>
    rendered.root
      .findAll((node) => node.props["data-press-note"] !== undefined)
      .map((node) => node.children.join(""));

  it("reads it whole over Try again, with no hover", () => {
    const rendered = render({ kind: "failed", line: REASON, verb: "try-again" });
    expect(notes(rendered)).toEqual([REASON]);
    expect(rendered.root.findAllByType("button").map((button) => button.children)).toEqual([
      ["Try again"],
    ]);
  });

  it("leaves it to the sentence where Zerops may have made it", () => {
    const rendered = render({ kind: "failed", line: REASON, verb: "go-to-projects" });
    expect(notes(rendered)).toEqual([]);
  });

  // Run 6's second review: a create Zerops may have made had no way to end but the projects.
  it("lets one Zerops may have made be dismissed beside the way to the projects, never started over", () => {
    let dismissed = 0;
    let rendered: ReactTestRenderer | undefined;
    act(() => {
      rendered = create(
        h(ComingBelow, {
          coming: { kind: "failed", line: REASON, verb: "go-to-projects" },
          progress,
          nowMs: 0,
          mate: { name: "Ida", project: "Acme" },
          you: null,
          ends: {
            onDismiss: () => {
              dismissed += 1;
            },
          },
          projects: h("a", { href: "/zerops" }),
        }),
      );
    });
    const buttons = rendered!.root.findAllByType("button");
    expect(buttons.map((button) => button.children)).toEqual([["Go to projects"], ["Dismiss"]]);
    act(() => buttons[1]!.props.onClick());
    expect(dismissed).toBe(1);
  });
});

// The stop's words come from what made the stop: a step this tab ran says why in its place, and
// the sentence only that it did; anything else, the sentence says why.
describe("comingSentenceOf — the sentence over a stop", () => {
  const sub = (id: string, state: "done" | "failed" | "unfinished", why?: string) => ({
    id,
    label: id,
    state,
    ...(why === undefined ? {} : { why }),
  });
  const progressOf = (press: ReadonlyArray<ReturnType<typeof sub>>) => ({
    steps: [],
    active: null,
    failed: null,
    doneCount: 0,
    total: 0,
    complete: false,
    press,
  });

  it.each([
    {
      case: "a step this tab ran stopped it, certain: the step says why",
      coming: { kind: "failed", line: "No room in this account.", verb: "try-again" },
      press: [sub("created", "failed", "No room in this account.")],
      want: NOT_SET_UP_LINE,
    },
    {
      case: "a create Zerops may have made: the reason, with the way to the projects",
      coming: {
        kind: "failed",
        line: "Zerops may have created it. Check your projects before trying again.",
        verb: "go-to-projects",
      },
      press: [sub("created", "failed", "Zerops may have created it.")],
      want: "Zerops may have created it. Check your projects before trying again.",
    },
    {
      case: "a registration not finished, then the container stopped: the container's reason",
      coming: { kind: "failed", line: "Its container stopped.", verb: "remove" },
      press: [sub("closed-off", "done"), sub("registered", "unfinished", "Refused.")],
      want: "Its container stopped.",
    },
  ] as const)("$case", ({ coming, press, want }) => {
    expect(comingSentenceOf({ coming, progress: progressOf(press), nowMs: 0 })).toBe(want);
  });
});

// Run 6's review: an Add's runtimes were drawn from its press alone, so its rows moved when the
// press ended. The creation this tab holds names them from the press until the project's own read.
describe("an added Mate's own view, after its hand-over", () => {
  const IDA: NewProjectBirth = {
    id: "add-1",
    organizationId: "org-beviro",
    groupId: "beviro",
    name: "Beviro",
    botName: "Quinn",
    face: { tint: "sky", shape: "pick" },
    locationId: null,
    agents: [],
    startedAt: 0,
    withGitea: false,
    giteaProjectId: "gitea-1",
    step: "created",
    failed: null,
    projectId: PROJECT,
    progress: null,
    adds: {
      displayName: "Beviro - Quinn",
      registers: true,
      managed: ["db"],
      runtimes: [{ hostname: "appdev", role: "dev" }],
    },
  };
  /** Each row with its services and the steps this tab runs under it: `id[…]{…}`. */
  const rows = () =>
    tree?.root
      .findAll((node) => node.props["data-arrival-step"] !== undefined)
      .map((node) => {
        const services = node
          .findAll((inner) => inner.props["data-zerops-surface"] === "arrival-services")
          .flatMap((list) => list.findAllByType("li"))
          .map((service) => String(service.props["aria-label"]).split(":")[0]);
        const substeps = node
          .findAll((inner) => inner.props["data-arrival-substep"] !== undefined)
          .map((inner) => String(inner.props["data-arrival-substep"]));
        return `${String(node.props["data-arrival-step"])}[${services.join(",")}]{${substeps.join(",")}}`;
      }) ?? [];

  beforeEach(() => {
    app.birthProgress = true;
    app.listing = listingOf([]);
    app.creations = {
      [PROJECT]: {
        projectId: PROJECT,
        groupId: "beviro",
        groupName: "Beviro",
        botName: "Quinn",
        face: IDA.face,
      },
    };
    useNewProjectBirths.setState({ births: { [IDA.id]: IDA } });
  });
  afterEach(() => {
    forgetPress(PROJECT);
    useNewProjectBirths.setState({ births: {} });
  });

  it("draws its copy's and its workspace's lines and its steps from its press, and keeps them when the press ends", () => {
    beginPress({
      projectId: PROJECT,
      organizationId: "org-beviro",
      startedAt: 0,
      placement: null,
      container: true,
      managed: ["db"],
      runtimes: [{ hostname: "appdev", role: "dev" }],
    });
    openView();
    const held = rows();
    expect(held).toEqual([
      "copy[db]{created,container,closed-off,registered}",
      "workspace[appdev]{}",
      "you[]{}",
    ]);
    // Closed off and registered: the press is over (`endPress`).
    act(() => forgetPress(PROJECT));
    expect(rows()).toEqual(held);
  });
});

import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import type { MateLink } from "@t3tools/client-runtime/zerops/environments";
import { EnvironmentId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import { act, createElement as h, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { awaitMateConversation, takeMateConversation } from "~/zerops/mateOpening";

import { ZeropsMateComingPage } from "./ZeropsMateComingPage";

const ENV_QUINN = EnvironmentId.make("env-quinn");
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
  openMate: vi.fn(),
  handingOver: vi.fn(),
  link: { key: undefined, environmentId: undefined, reachability: null } as unknown,
  listing: { state: "unread", waitingFor: null } as unknown,
  threads: [] as Array<unknown>,
  projects: [] as Array<unknown>,
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => app.navigate,
  Link: ({ children }: { readonly children?: ReactNode }) => h("a", null, children),
}));
vi.mock("~/routes/-environmentTargets", () => ({
  useEnvironmentLinks: () => ({ mateLink: () => app.link }),
}));
vi.mock("~/state/entities", () => ({
  useThreadShells: () => app.threads,
  useThreadStatus: () => "live",
  useProjects: () => app.projects,
}));
vi.mock("~/zerops/accountEnvironments", () => ({ useConnectMate: () => app.connect }));
vi.mock("~/zerops/useOpenMate", () => ({ useOpenMate: () => app.openMate }));
vi.mock("~/zerops/useZeropsCandidates", () => ({
  useZeropsCandidates: () => ({ listing: app.listing }),
}));
vi.mock("~/zerops/zeropsBirths", () => ({
  useZeropsBirths: () => ({ births: [], waits: new Map() }),
  forgetBirth: () => undefined,
  retryBirth: () => undefined,
}));
vi.mock("~/zerops/newMate", () => ({
  useNewMate: (select: (state: unknown) => unknown) =>
    select({ creations: {}, forget: () => undefined, handingOver: app.handingOver }),
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
vi.mock("~/zerops/useZeropsBirthProgress", () => ({ useZeropsBirthProgress: () => null }));
vi.mock("~/zerops/useUsualAgent", () => ({
  useUsualAgent: () => ({ usual: null, settled: true }),
}));
vi.mock("~/zerops/useNowMs", () => ({ useSecondsNowMs: () => 0 }));
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
vi.mock("../chat/ConversationStrip", () => ({ ConversationStripView: () => null }));
vi.mock("../chat/ChatHeader", () => ({ ZeropsProjectLink: () => null }));
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
  }: {
    readonly children?: ReactNode;
    readonly onClick?: () => void;
  }) => h("button", { onClick }, children),
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
    .filter((node) => node.props.disabled !== true)
    .map((node) => node.children.join("")) ?? [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  app.navigate.mockClear();
  app.connect.mockClear();
  app.openMate.mockClear();
  app.handingOver.mockClear();
  app.listing = listingOf([QUINN]);
  app.threads = [];
  app.projects = [];
  app.link = { key: undefined, environmentId: undefined, reachability: null };
});
afterEach(() => {
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

    expect(said()).toContain("Quinn");
    expect(said()).toContain("Reconnecting…");
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

  it("waits for a machine to name it before connecting: a Connect before the stage holds it ends unheard", () => {
    app.link = { key: KEY, environmentId: undefined, reachability: null } satisfies MateLink;
    openView();
    expect(said()).toContain("Opening this conversation…");
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
    tree?.root.findAll((node) => typeof node.type === "string" && node.props.role === "textbox") ??
    [];

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
      expect(composer()[0]?.props["aria-disabled"]).toBe("true");
      expect(said()).toContain("Describe what you want to build or change…");
    }
  });
});

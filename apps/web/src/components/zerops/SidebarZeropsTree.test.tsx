// @effect-diagnostics nodeBuiltinImport:off -- The heading's band is checked against the stylesheet that draws it.
import {
  buildZeropsGroupTree,
  groupFlow,
  type EnvironmentRow,
  type FlowPullRequest,
  type GroupNextStepKind,
  type ZeropsPlacedBirth,
} from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import type { HqMate, HqPlacement } from "@t3tools/client-runtime/zerops/hq";
import { crewSnapshotFixture } from "@t3tools/client-runtime/zerops/crew/testing/fixtures";
import type { CandidatesNotice } from "@t3tools/client-runtime/zerops/projections";
import * as NodeFS from "node:fs";
import { act, act as act_, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RegistryContext } from "@effect/atom-react";
import { AtomRegistry } from "effect/unstable/reactivity";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ProjectId, ThreadId, type CrewSnapshot } from "@t3tools/contracts";
import type { CrewDigest } from "@t3tools/shared/mateLink";

import { DraftId, useComposerDraftStore } from "~/composerDraftStore";
import { getLocalStorageItem, setLocalStorageItem } from "~/hooks/useLocalStorage";
import { restingActivity, type ZeropsAgentActivity } from "~/zerops/agentActivity";
import { markMateDeleting, settleDeletingMates } from "~/zerops/deletingMates";
import type { ZeropsMateOwner } from "~/zerops/useZeropsMateOwners";
import {
  PROJECT_CUSTOM_ORDER_STORAGE_KEY,
  PROJECT_ORDER_STORAGE_KEY,
  ProjectCustomOrderSchema,
  ProjectOrderSchema,
} from "~/zerops/projectOrderPreference";
import { ZeropsProjectFlowContext, type ZeropsProjectFlowValue } from "~/zerops/projectFlowContext";
import { InventoryContext, type Inventory } from "~/zerops/inventoryContext";
import type { ProjectRef } from "@t3tools/client-runtime/zerops/data";

// The projects a person collapsed, as storage would hand them back, and what
// the tree last asked it to remember.
const stored = vi.hoisted(() => ({
  collapsed: new Set<string>(),
  written: undefined as ReadonlySet<string> | undefined,
}));
vi.mock("~/zerops/collapsedProjects", () => ({
  readCollapsedProjects: () => stored.collapsed,
  writeCollapsedProjects: (collapsed: ReadonlySet<string>) => {
    stored.written = collapsed;
  },
}));
// A crew's faces open their chats through the router, which a menu drawn
// here has none of.
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useNavigate: () => () => undefined,
}));
// The shared minute clock, where a test sets it: the menu's coming-up windows close on it. The
// real one's timer has no window to run on in a menu drawn here.
const clock = vi.hoisted(() => ({ ms: undefined as number | undefined }));
vi.mock("~/zerops/useNowMs", async (original) => ({
  ...(await original<typeof import("~/zerops/useNowMs")>()),
  useNowMs: () => clock.ms ?? Date.now(),
}));
// The crew HQ holds of each Mate, by its project, where a test says one: none otherwise.
const hqCrews = vi.hoisted(() => new Map<string, unknown>());
vi.mock("~/zerops/crew/useCrew", async (original) => ({
  ...(await original<typeof import("~/zerops/crew/useCrew")>()),
  useMateCrew: (projectId: string | null) =>
    (projectId === null ? undefined : hqCrews.get(projectId)) ?? {
      status: null,
      crew: null,
      logins: {},
      current: false,
      environmentId: undefined,
    },
}));
// The stops a drawn surface holds the deployment demand of, by project id.
const demandedStops = vi.hoisted(() => new Set<string>());
vi.mock("~/zerops/accountForge", async (original) => {
  const actual = await original<typeof import("~/zerops/accountForge")>();
  return {
    ...actual,
    useStopDeploymentDemand: (project: ProjectRef | null) => {
      actual.useStopDeploymentDemand(project);
      if (project !== null) demandedStops.add(project.projectId);
    },
  };
});
// Who is looking: nobody signed in to Zerops unless a test says whom.
const session = vi.hoisted(() => ({ viewer: undefined as string | undefined }));
vi.mock("~/zerops/ZeropsSessionProvider", async (original) => ({
  ...(await original<typeof import("~/zerops/ZeropsSessionProvider")>()),
  useZeropsSessionOptional: () =>
    session.viewer === undefined ? null : { user: { id: session.viewer } },
}));
// Whom each Mate waits on, as HQ says it (`waitsOnViewer`): the viewer who signed its agent in.
const signerOf = vi.hoisted(() => new Map<string, string>());
vi.mock("~/zerops/useZeropsMateOwners", async (original) => ({
  ...(await original<typeof import("~/zerops/useZeropsMateOwners")>()),
  useWaitsOnViewer: () => (projectId: string) =>
    session.viewer !== undefined && signerOf.get(projectId) === session.viewer,
}));
afterEach(() => {
  // A tree left mounted would answer the next test's asks of the one menu.
  for (const tree of mountedTrees.splice(0)) {
    act(() => {
      tree.unmount();
    });
  }
  stored.collapsed = new Set();
  stored.written = undefined;
  session.viewer = undefined;
  signerOf.clear();
  hqCrews.clear();
  demandedStops.clear();
  vi.unstubAllGlobals();
});
import {
  groupFlowInputOf,
  groupMemberFactsOf,
  type GroupFlowReads,
} from "./projects/projectsView.logic";
import { useSidebarJump } from "~/zerops/sidebarJump";
import { useSidebarReveal } from "~/zerops/sidebarReveal";
import { zeropsSessionAtom } from "~/state/zerops";
import { organization } from "~/zerops/__fixtures__/platformData";
import type { SidebarCrewRead } from "./crew/SidebarCrewLine";
import { MateMenu, type MateRowActions } from "./SidebarMateMenu";
import {
  ProjectHeader,
  SidebarHqStatus,
  SidebarNewProject,
  SidebarZeropsTree,
  type SidebarProjectFlow,
} from "./SidebarZeropsTree";
import { mountHqNavigation } from "~/zerops/__fixtures__/hqNavigation";

/** One comparison HQ answered for `appdev`: what a release would put live. */
const compared = (commits: ReadonlyArray<{ readonly sha: string; readonly subject: string }>) => ({
  repository: "appdev",
  services: ["app"],
  commits: commits.map((commit) => ({
    ...commit,
    authorName: "Juno",
    at: "2026-10-02T10:00:00.000Z",
    change: null,
  })),
  total: commits.length,
  truncated: false,
});

/**
 * Where HQ places a project: in application `appId`, named `appName`, as `kind`; with a Mate's
 * record where `recorded` — its name is its project's (D3).
 */
function inApp(
  appId: string,
  appName: string,
  kind: HqPlacement["kind"] = "mate",
  recorded = false,
): HqPlacement {
  return { appId, appName, kind, mate: recorded ? { face: "" } : null };
}
const AAA = (kind?: HqPlacement["kind"], recorded?: boolean) =>
  inApp("aaa", "Beviro CRM", kind, recorded);
const IN_LINKS = (kind?: HqPlacement["kind"]) => inApp("links", "Links", kind);

/** A project's own tags, and where HQ places it, if anywhere. */
interface Own {
  readonly tags?: ReadonlyArray<string>;
  readonly hq?: HqPlacement;
}

function candidate(
  id: string,
  own: Own,
  group: ZeropsCandidate["group"] = "ready",
  withContainer = true,
): ZeropsCandidate {
  const base = {
    key: `${id}:zcp`,
    project: {
      id,
      name: id,
      status: "ACTIVE",
      tagList: own.tags ?? [],
      ...(own.hq === undefined ? {} : { hq: own.hq }),
    },
    group,
  };
  return withContainer
    ? { ...base, service: { id: "zcp", name: "zcp", status: "ACTIVE" } }
    : {
        ...base,
        group: "unavailable",
        reason: "no Zerops Mate container in this project",
        missingContainer: true,
      };
}

/** D6's record of who signed a Mate's agent in, as HQ's overview of its logins names them. */
const SIGNER = "u-ada";

/** `placed`, its Mate's record at HQ saying `over` too. */
function recorded(placed: HqPlacement, over: Partial<HqMate>): HqPlacement {
  return { ...placed, mate: { face: "", ...placed.mate, ...over } };
}

/** A Mate's logins as HQ's overview says them, naming `signer` as who signed Claude in. */
const signedBy = (signer: string): Partial<HqMate> => ({
  logins: { "claude-code": { signedInBy: signer, present: true, token: false } },
});

/** A Mate signed in by `u-ada` — the viewer's own, where a test makes her the viewer. */
function mine(item: ZeropsCandidate, signer = SIGNER): ZeropsCandidate {
  signerOf.set(item.project.id, signer);
  return {
    ...item,
    project: { ...item.project, hq: recorded(item.project.hq!, signedBy(signer)) },
  };
}

const CRM_DEV = candidate("crm-dev", { tags: ["mate"], hq: AAA() });
const CRM_STAGE = candidate("crm-stage", { hq: AAA("stage") }, "ready", false);
const CRM_PROD = candidate("crm-prod", { hq: AAA("production") }, "ready", false);
const LOOSE = candidate("loose", { tags: ["mate"] });
/**
 * Connected, so its activity is read — a Mate that is only ready has not been
 * spoken to as far as anyone here knows, as on the projects page — and up.
 */
const CRM_DEV_CONNECTED = {
  ...CRM_DEV,
  group: "connected",
  environmentId: "env-crm-dev" as ZeropsCandidate["environmentId"],
} as ZeropsCandidate;

/** A group whose environments are named the way Zerops names them: after it. */
function named(id: string, name: string, own: Own, withContainer = true) {
  const base = candidate(id, own, "ready", withContainer);
  return { ...base, project: { ...base.project, name } } as ZeropsCandidate;
}

const LINKS_MATE = named("links-dev", "Links - dev", { tags: ["mate"], hq: IN_LINKS() });
const LINKS_STAGE = named("links-stage", "Links - stage", { hq: IN_LINKS("stage") }, false);
const LINKS_PROD = named("links-prod", "Links - production", { hq: IN_LINKS("production") }, false);

/** A stop whose services the platform has read, standing as given, reachable at `routes`. */
function up<T extends ZeropsCandidate>(
  item: T,
  status = "ACTIVE",
  routes: ReadonlyArray<{ readonly host: string }> = [],
) {
  return {
    ...item,
    routes: routes.map(({ host }) => ({ service: "app", port: 80, host, url: `https://${host}` })),
    services: {
      hostnames: ["app"],
      deployedAt: undefined,
      deployable: [],
      statuses: [{ hostname: "app", status, runtime: true }],
    },
  };
}

function render(candidates: ReadonlyArray<ZeropsCandidate>, props: Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    <SidebarZeropsTree
      candidates={candidates}
      complete
      onBrowseProjects={() => {}}
      onSelect={() => {}}
      {...props}
    />,
  );
}

/**
 * A tree mounted for pressing, rather than drawn once as a string. Its menus
 * and stored preferences listen on `window` once mounted and ask whether a
 * node is a DOM element; there is no DOM here, so an event target stands in
 * for the window and nothing is an element.
 */
const mountedTrees: ReactTestRenderer[] = [];
function mount(element: ReactElement): ReactTestRenderer {
  const noDom = Object.fromEntries(
    ["Node", "Element", "HTMLElement", "ShadowRoot"].map((name) => [name, function none() {}]),
  );
  vi.stubGlobal("window", Object.assign(new EventTarget(), noDom));
  for (const [name, type] of Object.entries(noDom)) vi.stubGlobal(name, type);
  let tree: ReactTestRenderer | undefined;
  act(() => {
    tree = create(element);
  });
  mountedTrees.push(tree!);
  return tree!;
}

/** The one host element wearing this surface. */
function surface(tree: ReactTestRenderer, name: string): ReactTestInstance {
  return tree.root.find(
    (node) => typeof node.type === "string" && node.props["data-zerops-surface"] === name,
  );
}

function press(tree: ReactTestRenderer, name: string): void {
  act(() => {
    // A tooltip's trigger reads the click it wraps; a bare one will do.
    surface(tree, name).props.onClick({
      nativeEvent: {},
      preventDefault: () => {},
      stopPropagation: () => {},
    });
  });
}

/** Everything a node says, as text. */
function text(node: ReactTestInstance): string {
  return node.children.map((child) => (typeof child === "string" ? child : text(child))).join("");
}

/** A crew snapshot as HQ holds it in its Mate's overview: faces at rest, nothing waiting. */
function crewDigestOf(snapshot: CrewSnapshot): CrewDigest {
  return {
    crewmates: snapshot.crewmates.map((mate) => ({
      handle: mate.handle,
      displayName: mate.displayName,
      tint: mate.tint,
      lead: mate.kind === "lead",
      threadId: mate.currentThreadId,
      threadKind: null,
      loginKey: null,
    })),
    attention: [],
    readyTasks: [],
    personLands: true,
  };
}

describe("SidebarZeropsTree", () => {
  it("names the project as a name, then its Mate as the menu's own row with its face", () => {
    const html = render([CRM_DEV, CRM_STAGE]);
    const projectAt = html.indexOf('data-zerops-surface="sidebar-project"');
    const project = html.slice(
      html.lastIndexOf("<div", projectAt),
      html.indexOf('data-zerops-surface="sidebar-mate"'),
    );
    expect(project).toContain("Beviro CRM");
    // A name, not a label: sentence case in the sidebar's own foreground.
    expect(project).not.toContain("uppercase");
    expect(project).not.toContain("micro-label");
    expect(project).toContain("font-semibold");
    expect(project).toContain("text-sidebar-foreground");

    expect(html.match(/data-zerops-surface="sidebar-mate"/gu)).toHaveLength(1);
    expect(html).toContain('data-zerops-primitive="mate-face"');
    // The Mate is the heaviest thing in its project, so its face is the
    // card's size, not the 20px a name in a row of text gets.
    expect(html).toContain('data-mate-face-size="md"');
    // The state is the face's: a Mate whose container runs is awake though
    // its socket is not open here yet, and no word says "Ready" or "Idle".
    expect(html).toContain('data-mate-face-state="idle"');
    expect(html).not.toContain(">Ready<");
    expect(html).not.toContain(">Idle<");
    // The menu's own row — the surface every thread row has, lit on hover —
    // not a bordered card. The whole row is the button.
    const rowAt = html.indexOf('data-zerops-surface="sidebar-mate"');
    const row = html.slice(html.lastIndexOf("<button", rowAt), rowAt);
    expect(row).toContain("w-full");
    // Its corners are the menu's row's own (`.menu-row`, 12px).
    expect(row).toContain("menu-row");
    // Lit as its unit, which holds its menu too, so it stays lit while the
    // pointer is on that ("a Mate and its crew, one unit in the menu").
    expect(html).toContain('data-zerops-mate-unit="crm-dev"');
    expect(row).not.toContain("border");
  });

  it("wears a colleague's picture on its face's corner, cut out of the face, never before the name", () => {
    const jan = { name: "Jan Novák", initials: "JN", avatarUrl: "https://cdn/jan.png" };
    const html = render([CRM_DEV], { getOwner: () => jan });
    const rowAt = html.indexOf('data-zerops-surface="sidebar-mate"');
    const row = html.slice(rowAt, html.indexOf("</button>", rowAt));
    const ownerAt = row.indexOf('data-zerops-surface="sidebar-mate-owner"');
    // In the face's box, after the face and before the words: "(face) Cleo"
    // on the name's line read as a person called Cleo (the owner, 2026-09-30).
    expect(ownerAt).toBeGreaterThan(row.indexOf("</svg>"));
    expect(ownerAt).toBeLessThan(row.indexOf('data-zerops-surface="sidebar-mate-name"'));
    expect(row).toContain("menu-face-cut");
    expect(row).toContain('data-zerops-avatar="picture"');
    expect(row).toContain('src="https://cdn/jan.png"');
    expect(row).toContain('class="menu-owner"');
    // The picture is decoration; whose Mate it is is still said.
    expect(row).toContain("Jan Novák&#x27;s Mate");
  });

  it("puts nothing on the face of the viewer's own Mate", () => {
    const petra = {
      name: "Petra Malá",
      initials: "PM",
      avatarUrl: "https://cdn/petra.png",
      isViewer: true,
    };
    const html = render([CRM_DEV], { getOwner: () => petra });
    expect(html).not.toContain('data-zerops-surface="sidebar-mate-owner"');
    expect(html).not.toContain("menu-face-cut");
  });

  it("gives an owner without a picture their initial on their own hue, and an unnamed one nothing yet", () => {
    const quiet = { name: "Eva Dvořák", initials: "ED", avatarUrl: null };
    const withInitials = render([CRM_DEV], { getOwner: () => quiet });
    expect(withInitials).toContain('data-zerops-avatar="initials"');
    expect(withInitials).toContain('<span aria-hidden="true">E</span>');
    expect(withInitials).toMatch(/--menu-owner-hue:\d+/u);

    // Somebody its records name, whom the member list has not named: it may be
    // the viewer, so the face waits whole — the badge only ever arrives, and
    // in the face's box, so nothing moves when it does.
    const signed = candidate("crm-dev", {
      tags: CRM_DEV.project.tagList!,
      hq: recorded(AAA(), signedBy(SIGNER)),
    });
    const unnamed = render([signed], { getOwner: () => undefined });
    expect(unnamed).not.toContain('data-zerops-surface="sidebar-mate-owner"');
    expect(unnamed).not.toContain("menu-face-cut");
    expect(unnamed).not.toContain("&#x27;s Mate");
    expect(unnamed).not.toContain('data-zerops-primitive="avatar"');
    expect(unnamed).not.toContain("sidebar-mate-sign-in");
  });

  it("keeps saying what a connected Mate is on, or was last on, under its name", () => {
    const connected: ZeropsCandidate = { ...CRM_DEV, group: "connected" };
    const idle: ZeropsAgentActivity = {
      threadId: "thread-1" as ZeropsAgentActivity["threadId"],
      kind: "idle",
      status: null,
      face: "idle",
      subject: "Fix the login redirect",
      at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
      snippet: undefined,
      unread: false,
      pausedUntil: undefined,
      threadKey: "env:thread",
      task: undefined,
    };
    const html = render([connected], { getActivity: () => idle });
    expect(html).toContain('data-mate-face-state="idle"');
    expect(html).toContain('data-zerops-surface="sidebar-mate-subject"');
    expect(html).toContain("Fix the login redirect");
    expect(html).not.toContain(">Idle<");
    // When it last did something, at the right edge, the way a messenger dates its rows.
    expect(html).toContain('data-zerops-surface="sidebar-mate-time"');
    expect(html).toContain(">3h<");
  });

  it("quotes the Mate's last words under the task it was set on", () => {
    const connected: ZeropsCandidate = { ...CRM_DEV, group: "connected" };
    const spoken: ZeropsAgentActivity = {
      threadId: "thread-1" as ZeropsAgentActivity["threadId"],
      kind: "idle",
      status: null,
      face: "idle",
      subject: "give it optimistic updates",
      at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
      snippet: "Deploying and verifying now.",
      unread: false,
      pausedUntil: undefined,
      threadKey: "env:thread",
      task: undefined,
    };
    const html = render([connected], { getActivity: () => spoken });
    const subjectAt = html.indexOf('data-zerops-surface="sidebar-mate-subject"');
    const snippetAt = html.indexOf('data-zerops-surface="sidebar-mate-snippet"');
    expect(subjectAt).toBeGreaterThan(-1);
    expect(snippetAt).toBeGreaterThan(subjectAt);
    expect(html).toContain("give it optimistic updates");
    expect(html).toContain("Deploying and verifying now.");
  });

  const READING: CandidatesNotice = {
    region: "placeholder",
    message: { text: "Reading your projects…", afterMs: 400, tone: "quiet" },
    affordance: null,
  };

  it('an unread listing renders its placeholder, never nothing and never "none"', () => {
    const html = render([], { complete: false, notice: READING });

    expect(html).toContain("Reading your projects…");
    expect(html).not.toContain("No environment has Mate yet");
    // Read and Mate-less: the empty state, as before.
    expect(render([candidate("unplaced", {}, "ready", false)], { complete: true })).toContain(
      "sidebar-environments-empty",
    );
  });

  it.each([
    { name: "while its first read is under way, the rows' room held", reading: true, drawn: true },
    { name: "with nothing being read, nothing", reading: false, drawn: false },
  ])("a cold menu with no row and no notice: $name", ({ reading, drawn }) => {
    const html = render([], { complete: false, notice: null, reading });
    expect(html.includes('data-zerops-surface="sidebar-environments-skeleton"')).toBe(drawn);
    expect(html).not.toContain("No environment has Mate yet");
  });

  it("draws no skeleton once a row is there", () => {
    expect(render([CRM_DEV], { complete: false, notice: null, reading: true })).not.toContain(
      "sidebar-environments-skeleton",
    );
  });

  it.each([false, true])(
    "paints HQ application placements with no Mate and inventory complete=%s",
    (complete) => {
      const html = render([CRM_STAGE], { complete });
      expect(html).toContain("Beviro CRM");
      expect(html).toContain('data-zerops-group="aaa"');
      expect(html).not.toContain("sidebar-environments-empty");
    },
  );

  it("a failed listing names its cause once, with one Try again", () => {
    const html = render([], {
      complete: false,
      notice: {
        region: "message",
        message: {
          text: "Couldn't read your projects. Zerops didn't answer.",
          afterMs: 0,
          tone: "alert",
        },
        affordance: { kind: "retry", label: "Try again" },
      },
      onNoticeAct: () => {},
    });

    expect(html.match(/Zerops didn(?:&#x27;|')t answer\./g)).toHaveLength(1);
    expect(html.match(/Try again/g)).toHaveLength(1);
    expect(html).not.toContain("No environment has Mate yet");
  });

  it('never says "No environment has Mate yet" while a project\'s presence is unknown', () => {
    // The project is listed, but whether a container runs in it is not read yet.
    const html = render([candidate("unplaced", {}, "ready", false)], {
      complete: false,
      notice: {
        region: "value",
        message: { text: "Still reading…", afterMs: 0, tone: "quiet" },
        affordance: null,
      },
    });

    expect(html).toContain("Still reading…");
    expect(html).not.toContain("No environment has Mate yet");
  });

  it("a partial listing says Still reading… under the Mates it already holds", () => {
    const html = render([CRM_DEV], {
      complete: false,
      notice: {
        region: "value",
        message: { text: "Still reading…", afterMs: 0, tone: "quiet" },
        affordance: null,
      },
    });

    expect(html).toContain('data-zerops-surface="sidebar-mate"');
    expect(html.indexOf("Still reading…")).toBeGreaterThan(
      html.indexOf('data-zerops-surface="sidebar-mate"'),
    );
  });

  it("never says HQ's standing above the list, so the list never moves for it", () => {
    for (const candidates of [[CRM_DEV], [CRM_STAGE], []]) {
      expect(render(candidates)).not.toContain("sidebar-hq-outage");
    }
  });

  // The menu's header says it instead (the owner, 2026-10-05: a notice pushed the menu down and
  // back on every reconnect): a spinner while HQ is read again, words once it does not answer.
  it.each([
    ["syncing", false, false, false],
    ["syncing", true, false, false],
    ["unavailable", false, true, false],
    ["unavailable", true, true, true],
  ] as const)("the header's HQ standing: %s, a retry offered %s", (kind, offered, words, again) => {
    const line = "HQ unavailable since 14:05. Projects as of 13:58.";
    const html = renderToStaticMarkup(
      <SidebarHqStatus kind={kind} line={line} onAgain={offered ? () => {} : undefined} />,
    );
    expect(html).toContain(line);
    expect(html.includes(">HQ unavailable<")).toBe(words);
    expect(html.includes("<button")).toBe(again);
  });

  // One band in the list lights the open Mate's row and slides to the next
  // one opened (M11): the row itself paints nothing for being open, and
  // lights only under the pointer.
  it("lights the open Mate's row with the list's one band, not a fill of its own", () => {
    const html = render([CRM_DEV], { activeProjectId: "crm-dev" });
    expect(html).toContain('aria-current="true"');
    expect(html.match(/data-zerops-surface="sidebar-selected-band"/gu)).toHaveLength(1);
    expect(html).toContain('<nav aria-label="Mates" class="relative isolate');
    const row = /<button aria-current="true" class="([^"]*)"/u.exec(html)?.[1] ?? "";
    expect(row).not.toContain("bg-sidebar-row-active");
    expect(row).not.toContain("hover:bg-sidebar-row-hover");
  });

  it("never makes production a Mate, whatever runs in it", () => {
    const prodWithContainer = candidate("crm-prod", { hq: AAA("production") }, "connected");
    const html = render([CRM_DEV, prodWithContainer]);
    expect(html.match(/data-zerops-surface="sidebar-mate"/gu)).toHaveLength(1);
  });

  it("gives two Mates two colours", () => {
    const html = render([CRM_DEV, LOOSE]);
    const tints = [...html.matchAll(/data-mate-face-tint="([a-z]+)"/gu)].map((match) => match[1]);
    expect(new Set(tints).size).toBe(2);
  });

  it("keeps another HQ application even when it holds only a stage", () => {
    const html = render([
      CRM_DEV,
      candidate("other", { hq: inApp("bbb", "Other", "stage") }, "ready", false),
    ]);
    expect(html).toContain('data-zerops-group="aaa"');
    expect(html).toContain('data-zerops-group="bbb"');
  });

  it("keeps a Mate whose container is not reachable right now, asleep", () => {
    // Membership is presence, not liveness — a sleeping container must not
    // make a card vanish from under the user.
    const asleep: ZeropsCandidate = {
      ...CRM_DEV,
      group: "unavailable",
      reason: "container is STOPPED",
    };
    const html = render([asleep]);
    expect(html).toContain('data-mate-face-state="sleep"');
    expect(html).toContain('data-zerops-surface="sidebar-mate"');
  });

  it("keeps a declared Mate whose container is gone — the tag is its existence", () => {
    const declared = candidate("crm-dev", { tags: ["mate"], hq: AAA() }, "ready", false);
    expect(render([declared])).toContain('data-zerops-surface="sidebar-mate"');
  });

  it("shows an ungrouped Mate without inventing a project for it", () => {
    const html = render([LOOSE]);
    expect(html).toContain("loose");
    expect(html).not.toContain("Ungrouped");
  });

  it("labels the ungrouped section only when there is a project to tell it from", () => {
    expect(render([CRM_DEV, LOOSE])).toContain("Ungrouped");
  });

  // The menu's one empty state: a project without a Mate. An account without
  // a project says nothing here — the header's "+ New project" is the
  // affordance, and the projects screen already says the rest.
  it.each([
    {
      name: "says Mate is missing, and offers to set one up, when the account has projects",
      candidates: [candidate("unplaced", {}, "ready", false)],
      shows: ["sidebar-environments-empty", "No environment has Mate yet", "Set up Mate"],
      hides: ["No Zerops projects yet", "New project"],
    },
    {
      name: "says nothing at all when the account has no project",
      candidates: [],
      shows: [],
      hides: ["sidebar-environments-empty", "No Zerops projects yet", "New project", "Set up Mate"],
    },
  ])("$name", ({ candidates, shows, hides }) => {
    const html = render(candidates);
    for (const text of shows) expect(html).toContain(text);
    for (const text of hides) expect(html).not.toContain(text);
  });

  it("left-aligns the empty state to the menu's own edge, like every other row", () => {
    const html = render([candidate("unplaced", {}, "ready", false)]);
    const block = html.match(
      /<div class="([^"]*)" data-zerops-surface="sidebar-environments-empty"/u,
    );
    expect(block).not.toBeNull();
    const classes = block![1]!.split(" ");
    expect(classes).toContain("items-start");
    expect(classes).not.toContain("items-center");
    expect(classes).not.toContain("text-center");
  });

  it("marks the active Mate", () => {
    const html = render([CRM_DEV, LOOSE], { activeProjectId: "loose" });
    expect(html).toContain('aria-current="true"');
    expect(html.match(/aria-current="true"/gu)).toHaveLength(1);
  });
});

const pull = (number: number, overrides: Partial<FlowPullRequest> = {}): FlowPullRequest => ({
  repository: "appdev",
  number,
  title: `Change ${number}`,
  kind: "code",
  mateProjectId: "crm-dev",
  url: `https://gitea.example/crm/appdev/pulls/${number}`,
  mergeability: "mergeable",
  behind: false,
  merged: false,
  mergedAt: undefined,
  headSha: "abc",
  baseBranch: "main",
  line: `appdev #${number}`,
  updatedAt: `2026-09-17T1${number}:00:00Z`,
  ...overrides,
});
const stageRow: EnvironmentRow = {
  kind: "environment",
  projectId: "crm-stage",
  name: "stage",
  tier: "stage",
  source: "main",
  commit: "3f9c1b2",
  version: {
    name: undefined,
    commit: "3f9c1b2",
    sha: "3f9c1b2000000000000000000000000000000000",
    taggedBy: undefined,
    label: "3f9c1b2",
  },
  versionRepository: "appdev",
  line: "main · 3f9c1b2",
  tone: "good",
  deploys: [],
  keyGap: false,
};
const productionRow: EnvironmentRow = {
  ...stageRow,
  projectId: "crm-prod",
  name: "production",
  tier: "production",
  source: "release",
  tone: "neutral",
};

// A Mate with no owner, or nobody signed in (the owner, 2026-09-29: "mate
// without auth / owner should have the state specially handled"): nobody's
// is an empty seat, said in words; a row with nothing else to say says that
// nobody has signed in, and offers nothing to press there: the row's own
// press opens the Mate, whose conversation holds the sign-in (the owner, of
// a *Sign in* on the row: it did nothing there, and stood on the row's edge).
describe("a Mate with no owner, or nobody signed in", () => {
  const OWNER_ROLE = (clientUserId: string) => ({ clientUserId, roleCode: "OWNER" });
  const mate = (
    record: Partial<HqMate> | null,
    options: {
      readonly group?: ZeropsCandidate["group"];
      readonly userRoles?: ReadonlyArray<{ clientUserId: string; roleCode: string }>;
    } = {},
  ): ZeropsCandidate => {
    const base = candidate(
      "crm-dev",
      { tags: CRM_DEV.project.tagList!, hq: record === null ? AAA() : recorded(AAA(), record) },
      options.group,
    );
    return {
      ...base,
      project: { ...base.project, userRoles: options.userRoles ?? [] },
      ...(options.group === "connected" ? { environmentId: "env-crm-dev" } : {}),
    } as ZeropsCandidate;
  };
  const seat = (html: string) => /data-zerops-avatar="([^"]*)"/u.exec(html)?.[1];
  const line = (html: string) =>
    /<span[^>]*data-zerops-surface="sidebar-mate-sign-in"[^>]*>([^<]*)<\/span>/u.exec(html);
  const PETRA = { name: "Petra Malá", initials: "PM", avatarUrl: null, isViewer: true };
  const KAREL = { name: "Karel Novák", initials: "KN", avatarUrl: null, isViewer: false };

  // Board D1, 2026-09-30: the person who added a Mate reads that it waits on them, with the amber
  // dot of what needs them; anybody else that it waits for a sign-in — never a failure while it
  // is being set up (2026-10-01) — and no dot: it is not waiting on them.
  it.each([
    { case: "the viewer added it", viewer: "u-petra", says: "Waiting for your sign-in", dot: true },
    {
      case: "somebody else added it",
      viewer: "u-karel",
      says: "Waiting for sign-in",
      dot: false,
    },
  ])("says whose sign-in it waits for: $case", ({ viewer, says, dot }) => {
    session.viewer = viewer;
    const html = render([mate({ standupRequestedBy: "u-petra" }, { group: "connected" })], {
      getOwner: () => undefined,
    });
    expect(line(html)?.[1]).toBe(says);
    expect(html.includes('data-zerops-surface="sidebar-mate-dot"')).toBe(dot);
    expect(html.includes('data-tone="attention"')).toBe(dot);
  });

  it("seats nobody's Mate on a dashed ring, and says so in words, never as a person", () => {
    const html = render([mate(null, { group: "connected" })], { getOwner: () => undefined });
    expect(seat(html)).toBe("nobody");
    const ring = /<span[^>]*data-zerops-avatar="nobody"[^>]*>(.*?)<\/span><\/span>/u.exec(
      html,
    )?.[1];
    expect(ring).toContain("<svg");
    expect(ring).toContain("stroke-dasharray");
    expect(ring).not.toMatch(/<img|>[A-Z]</u);
    expect(html).toContain("No owner yet. Whoever signs in its coding agent owns it.");
  });

  it.each([
    { case: "nobody's, open here", group: "connected", roles: [], owner: undefined },
    { case: "nobody's, not open here yet", group: "ready", roles: [], owner: undefined },
    { case: "the viewer's own", group: "connected", roles: ["cu-petra"], owner: PETRA },
    { case: "a colleague's", group: "connected", roles: ["cu-karel"], owner: KAREL },
  ] as const)(
    "says nobody has signed in under the name, one muted line with nothing to press: $case",
    ({ group, roles, owner }) => {
      const html = render([mate(null, { group, userRoles: roles.map((id) => OWNER_ROLE(id)) })], {
        getOwner: () => owner,
      });
      const found = line(html);
      expect(found?.[1]).toBe("Nobody has signed in yet");
      // One line of the row's leading, on the words' edge, the words' muted ink.
      expect(found?.[0]).toEqual(expect.stringContaining("leading-4.5"));
      expect(found?.[0]).toEqual(expect.stringContaining("text-muted-foreground"));
      expect(html).not.toContain(">Sign in<");
      expect(html).not.toContain("sidebar-mate-sign-in-verb");
    },
  );

  // E2E 2026-10-03 (F6): a `mate` project whose press stopped before its container read "Nobody
  // has signed in yet" after a reload — a Mate nobody can sign in, its container never made, or
  // its services not read yet. Asleep under its name, it says nothing it does not know.
  const bare = (over: Partial<ZeropsCandidate> & { readonly presence?: "unknown" }) => {
    const { service: _service, ...rest } = mate(null);
    return { ...rest, group: "unavailable", ...over } as ZeropsCandidate;
  };
  it.each([
    { case: "its services not read yet", item: bare({ presence: "unknown" }) },
    {
      case: "no container in its project",
      item: bare({ reason: "no Zerops Mate container in this project", missingContainer: true }),
    },
  ])("says nothing of signing in where there is no container to sign in: $case", ({ item }) => {
    const html = render([item], { getOwner: () => undefined });
    expect(html).toContain('data-mate-face-state="sleep"');
    expect(html).not.toContain("sidebar-mate-sign-in");
  });

  // The lead, 2026-10-03: nor does its face wear the empty seat — "No owner yet. Whoever signs in
  // its coding agent owns it." is the same claim of a sign-in nobody can make.
  it.each([
    { case: "its services not read yet", item: bare({ presence: "unknown" }) },
    {
      case: "no container in its project",
      item: bare({ reason: "no Zerops Mate container in this project", missingContainer: true }),
    },
  ])("seats nobody where there is no container to sign in: $case", ({ item }) => {
    const html = render([item], { getOwner: () => undefined });
    expect(seat(html)).toBeUndefined();
    expect(html).not.toContain("No owner yet");
  });

  it("says nothing of signing in once somebody has, or once it was asked something", () => {
    const signed = render([mate(signedBy(SIGNER), { group: "connected" })], {
      getOwner: () => KAREL,
    });
    expect(signed).not.toContain("sidebar-mate-sign-in");
    const asked: ZeropsAgentActivity = {
      threadId: "thread-1" as ZeropsAgentActivity["threadId"],
      kind: "idle",
      status: null,
      face: "idle",
      subject: "Fix the login redirect",
      at: new Date().toISOString(),
      snippet: undefined,
      unread: false,
      pausedUntil: undefined,
      threadKey: "env-crm-dev:thread-1",
      task: undefined,
    };
    const html = render([mate(null, { group: "connected" })], {
      getOwner: () => undefined,
      getActivity: () => asked,
    });
    // Still nobody's — the seat says it — but the row says what was asked.
    expect(seat(html)).toBe("nobody");
    expect(html).toContain("Fix the login redirect");
    expect(html).not.toContain("sidebar-mate-sign-in");
  });

  it("opens the Mate — where its sign-in is — when its row is pressed", () => {
    const opened: string[] = [];
    const mounted = mount(
      <SidebarZeropsTree
        candidates={[mate(null, { group: "connected" })]}
        complete
        onBrowseProjects={() => {}}
        onSelect={(item) => {
          opened.push(item.project.id);
        }}
      />,
    );
    // The line is the row's, and so is its press.
    const said = surface(mounted, "sidebar-mate-sign-in");
    let row: ReactTestInstance | null = said.parent;
    while (row !== null && row.props["data-zerops-surface"] !== "sidebar-mate") row = row.parent;
    expect(row).not.toBeNull();
    act(() => {
      row!.props.onClick();
    });
    expect(opened).toEqual(["crm-dev"]);
  });

  // Focus on a row — the keyboard walking the list — warms its conversation,
  // as the pointer resting on it does, so the press finds its rows placed.
  it("warms its conversation when its row takes focus", async () => {
    const { useWarmTimelineAsk } = await import("../chat/warmTimeline");
    let asked: string | null = null;
    function Asked() {
      asked = useWarmTimelineAsk();
      return null;
    }
    const activity: ZeropsAgentActivity = {
      threadId: "thread-crm" as ZeropsAgentActivity["threadId"],
      kind: "idle",
      status: null,
      face: "idle",
      subject: "Something",
      at: new Date().toISOString(),
      snippet: undefined,
      errorLine: undefined,
      unread: false,
      pausedUntil: undefined,
      threadKey: "env-crm-dev:thread-focused",
      task: undefined,
    };
    const mounted = mount(
      <>
        <Asked />
        <SidebarZeropsTree
          candidates={[mate(null, { group: "connected" })]}
          complete
          getActivity={() => activity}
          onBrowseProjects={() => {}}
          onSelect={() => {}}
        />
      </>,
    );
    const row = mounted.root.find(
      (node) =>
        typeof node.type === "string" && node.props["data-zerops-surface"] === "sidebar-mate",
    );
    act(() => {
      row.props.onFocus({});
    });
    expect(asked).toBe("env-crm-dev:thread-focused");
  });
});

describe("a creation under way in the menu", () => {
  const birth = (
    over: Partial<ZeropsPlacedBirth["placement"]> & { readonly projectId?: string } = {},
  ): ZeropsPlacedBirth => {
    const { projectId = "vera-dev", ...placement } = over;
    return {
      projectId,
      startedAt: Date.parse("2026-09-24T12:00:00.000Z"),
      placement: {
        groupId: "aaa",
        groupName: "Beviro CRM",
        kind: "mate",
        displayName: "Vera",
        ...placement,
      },
    };
  };
  const comingRows = (html: string) =>
    html.match(/data-zerops-surface="sidebar-mate-coming"/gu) ?? [];

  it("draws a Mate being created after the listed ones: waking, named, how far it has got", () => {
    const html = render([CRM_DEV], { births: [birth()] });
    expect(comingRows(html)).toHaveLength(1);
    const at = html.indexOf('data-zerops-surface="sidebar-mate-coming"');
    expect(html.indexOf('data-zerops-surface="sidebar-mate"')).toBeLessThan(at);
    const row = html.slice(html.lastIndexOf("<div", at));
    expect(row).toContain('data-mate-face-state="waking"');
    expect(row).toContain(">Vera<");
    // On the clock from when the platform took it (board D1, 2026-09-30).
    expect(row).toMatch(/>Coming up · \d+(:\d\d|h \d\dm)</u);
  });

  it("says a creation that stopped in its line, in red", () => {
    const html = render([CRM_DEV], { births: [{ ...birth(), failed: true }] });
    const at = html.indexOf('data-zerops-surface="sidebar-mate-coming"');
    const row = html.slice(html.lastIndexOf("<button", at), html.indexOf("</button>", at));
    expect(row).toContain('data-mate-face-state="sleep"');
    expect(row).toContain(">Setting up stopped<");
    expect(row).toContain('data-zerops-coming-tone="failed"');
  });

  // The owner, 2026-09-29: "on the left it looks like its ready to be opened, but it's not" — and
  // a press on it did nothing. It opens its own view, where it comes up; it is one of the menu's
  // Mates, lit when that view is open.
  it("opens its own view where it comes up, and is lit while that view is open", () => {
    const opened: Array<string> = [];
    const tree = mount(
      <SidebarZeropsTree
        activeProjectId="vera-dev"
        births={[birth()]}
        candidates={[CRM_DEV]}
        complete
        onBrowseProjects={() => {}}
        onOpenComing={(projectId: string) => {
          opened.push(projectId);
        }}
        onSelect={() => {}}
      />,
    );
    const row = surface(tree, "sidebar-mate-coming");
    expect(row.type).toBe("button");
    expect(row.props["aria-current"]).toBe("true");
    act(() => {
      row.props.onClick();
    });
    expect(opened).toEqual(["vera-dev"]);
    const unit = tree.root.find(
      (node) => typeof node.type === "string" && node.props["data-zerops-mate-unit"] === "vera-dev",
    );
    expect(unit).toBeDefined();
  });

  // Picked in the New Mate dialog: the Mate wears it from its first moment, waking.
  it.each([
    {
      case: "the face its person picked",
      face: { tint: "coral", shape: "gem" },
      tint: "coral",
      shape: "gem",
    },
    { case: "no face given: the coming slate", face: undefined, tint: "slate", shape: "squircle" },
  ] as const)("wears $case while it comes up", ({ face, tint, shape }) => {
    const html = render([CRM_DEV], { births: [birth(face === undefined ? {} : { face })] });
    const at = html.indexOf('data-zerops-surface="sidebar-mate-coming"');
    const row = html.slice(at, html.indexOf("</button>", at));
    expect(row).toContain(`data-mate-face-tint="${tint}"`);
    expect(row).toContain(`data-mate-face-shape="${shape}"`);
    expect(row).toContain('data-mate-face-state="waking"');
  });

  it("stands the listed Mate in its place once the listing holds it, never both", () => {
    const html = render([CRM_DEV], { births: [birth({ projectId: "crm-dev" })] });
    expect(comingRows(html)).toHaveLength(0);
    expect(html.match(/data-zerops-surface="sidebar-mate"/gu)).toHaveLength(1);
  });

  it("lists a brand-new project from its birth alone, first", () => {
    const html = render([CRM_DEV], {
      births: [birth({ groupId: "new", groupName: "Todo" })],
    });
    expect(html).toContain('data-zerops-group="new"');
    expect(html.indexOf('data-zerops-group="new"')).toBeLessThan(
      html.indexOf('data-zerops-group="aaa"'),
    );
    expect(html).toContain(">Todo<");
    expect(comingRows(html)).toHaveLength(1);
  });

  // A project's name is its application's in HQ; until HQ holds one, the name its creation was
  // asked under; until anything names it, its id.
  it.each([
    {
      case: "HQ's, over the one its creation was asked under",
      candidates: [CRM_DEV],
      over: { groupName: "Old CRM" },
      shows: ">Beviro CRM<",
      hides: ">Old CRM<",
    },
    {
      case: "its creation's, while HQ holds none",
      candidates: [],
      over: { groupId: "new", groupName: "Todo" },
      shows: ">Todo<",
      hides: ">new<",
    },
    {
      case: "its id, while nothing names it",
      candidates: [],
      over: { groupId: "new", groupName: "" },
      shows: ">new<",
      hides: ">Todo<",
    },
  ])("names a project by $case", ({ candidates, over, shows, hides }) => {
    const html = render(candidates, { births: [birth({ projectId: "vera-dev", ...over })] });
    expect(html).toContain(shows);
    expect(html).not.toContain(hides);
  });

  it("draws a first project being created in an account with no Mate listed yet", () => {
    const html = render([], { births: [birth({ groupId: "new", groupName: "Todo" })] });
    expect(html).toContain('data-zerops-group="new"');
    expect(comingRows(html)).toHaveLength(1);
    expect(html).not.toContain("No environment has Mate yet");
  });
});

// A listed Mate still coming up (its birth held here, or its project on the way up) says so in
// its row — never "Nobody has signed in yet" beside it — and a press opens its own view, which
// the menu's caller routes.
describe("a listed Mate still coming up", () => {
  const COMING = { kind: "coming", line: "Almost there.", verb: undefined } as const;
  const FAILED = { kind: "failed", line: "Could not be created.", verb: "remove" } as const;
  const rowOf = (html: string) => {
    const at = html.indexOf('data-zerops-surface="sidebar-mate"');
    return html.slice(html.lastIndexOf("<div", at), html.indexOf("</button>", at));
  };

  it.each([
    { case: "coming up", coming: COMING, says: "Coming up", tone: "muted", face: "waking" },
    {
      case: "not created",
      coming: FAILED,
      says: "Setting up stopped",
      tone: "failed",
      face: "sleep",
    },
  ] as const)(
    "says it is $case in its line, $face, with no sign-in line",
    ({ coming, says, tone, face }) => {
      const html = render([CRM_DEV], { getComing: () => coming });
      const row = rowOf(html);
      expect(row).toContain(`data-mate-face-state="${face}"`);
      expect(row).toContain(`>${says}<`);
      expect(row).toContain(`data-zerops-coming-tone="${tone}"`);
      expect(row).not.toContain("Nobody has signed in yet");
    },
  );

  it("counts its clock from when the platform took it, where its birth is held here", () => {
    const since = Date.now() - 42_000;
    const html = render([CRM_DEV], { getComing: () => ({ ...COMING, since }) });
    expect(rowOf(html)).toMatch(/>Coming up · 0:4[1-3]</u);
  });

  it("offers no menu while it comes up: nothing on it is about a Mate still being made", () => {
    const html = render([CRM_DEV], {
      getComing: () => COMING,
      getMateActions: () => ({ entries: [] }),
    });
    expect(html).not.toContain('data-zerops-surface="sidebar-mate-actions"');
  });

  it("is an ordinary row once it is up", () => {
    const html = render([CRM_DEV], { getComing: () => undefined });
    expect(rowOf(html)).toContain("Nobody has signed in yet");
  });
});

// The owner, 2026-09-29: a new Mate at work read "Working on a reply" under an asleep face. The
// face and the words are one reading of the Mate (`mateRowReading`).
describe("a Mate's face follows its work in the menu", () => {
  const working: ZeropsAgentActivity = {
    threadId: ThreadId.make("thread-1"),
    kind: "working",
    status: null,
    face: "working",
    subject: "Add a size guide to the product page",
    at: "2026-09-29T20:10:00.000Z",
    snippet: undefined,
    awaitingWords: true,
    unread: false,
    pausedUntil: undefined,
    threadKey: "env:thread-1",
    task: "Add a size guide to the product page",
  };
  const faceOf = (html: string) =>
    /<svg[^>]*data-mate-face-state="([a-z]+)"/u.exec(
      html.slice(html.indexOf('data-zerops-surface="sidebar-mate"')),
    )?.[1];

  it.each([
    {
      case: "connected and at work",
      group: "connected",
      activity: working,
      face: "working",
      dots: true,
    },
    {
      case: "at work while its socket reconnects",
      group: "ready",
      activity: working,
      face: "working",
      dots: true,
    },
    {
      case: "a running Mate with HQ's last word at rest, its socket not open yet",
      group: "ready",
      activity: restingActivity(working),
      face: "idle",
      dots: false,
    },
  ] as const)("$case: the face and the line agree", ({ group, activity, face, dots }) => {
    const html = render([{ ...CRM_DEV, group, environmentId: EnvironmentId.make("env-1") }], {
      getActivity: () => activity,
    });
    expect(faceOf(html)).toBe(face);
    expect(html.includes("Working on a reply")).toBe(dots);
  });

  // HQ holds a Mate's link open, so it is up, though this tab holds no socket to it and no chat of
  // its says anything yet (t12, 2026-10-03): its presence wakes its face, not a main chat.
  it("keeps the application and its open work when its last Mate leaves the listing", () => {
    const registry = AtomRegistry.make();
    registry.set(zeropsSessionAtom, {
      status: "signed-in",
      organizationStatus: "selected",
      activeOrganization: organization,
    });
    mountHqNavigation(registry, organization.organizationId, {
      structure: { apps: [{ id: "aaa", name: "Beviro CRM", projects: [] }], ungrouped: [] },
    });
    const html = renderToStaticMarkup(
      <RegistryContext.Provider value={registry}>
        <SidebarZeropsTree
          candidates={[]}
          complete
          onBrowseProjects={() => {}}
          onSelect={() => {}}
          getFlow={() => ({
            pullRequests: [pull(7, { mateProjectId: "gone-mate" })],
            environments: new Map(),
            releaseOffered: false,
          })}
        />
      </RegistryContext.Provider>,
    );
    expect(html).toContain("Beviro CRM");
    expect(html).toContain("#7 Change 7 · gone-mate");
    expect(html).not.toContain("No Zerops projects yet");
    registry.dispose();
  });

  it("says a foreign Mate is outside this HQ instead of inventing a sign-in state", () => {
    const registry = AtomRegistry.make();
    registry.set(zeropsSessionAtom, {
      status: "signed-in",
      organizationStatus: "selected",
      activeOrganization: organization,
    });
    mountHqNavigation(registry, organization.organizationId, {
      structure: { apps: [], ungrouped: [] },
    });
    const foreign = candidate("foreign", { tags: ["mate"] });
    const html = renderToStaticMarkup(
      <RegistryContext.Provider value={registry}>
        <SidebarZeropsTree
          candidates={[foreign]}
          complete
          onBrowseProjects={() => {}}
          onSelect={() => {}}
        />
      </RegistryContext.Provider>,
    );
    expect(html).toContain("Not in this HQ");
    expect(html).not.toContain("Nobody has signed in yet");
    expect(html).not.toContain("Coming up");
    registry.dispose();
  });

  it("wears an awake face for a Mate HQ holds online, before any chat of its says anything", () => {
    const registry = AtomRegistry.make();
    registry.set(zeropsSessionAtom, {
      status: "signed-in",
      organizationStatus: "selected",
      activeOrganization: organization,
    });
    const held = (online: boolean) =>
      mountHqNavigation(registry, organization.organizationId, {
        // HQ relays a Mate it places.
        structure: {
          apps: [],
          ungrouped: [{ projectId: "crm-dev", name: "crm-dev", mate: { face: "" } }],
        },
        mates: Object.fromEntries([
          [
            "crm-dev",
            {
              presence: {
                online,
                since: "2026-10-03T10:00:00.000Z",
                overview: online ? "live" : "stored",
              },
            },
          ],
        ]),
      });
    const drawn = () =>
      renderToStaticMarkup(
        <RegistryContext.Provider value={registry}>
          <SidebarZeropsTree
            candidates={[{ ...CRM_DEV, group: "unavailable" }]}
            complete
            onBrowseProjects={() => {}}
            onSelect={() => {}}
          />
        </RegistryContext.Provider>,
      );
    held(true);
    expect(faceOf(drawn())).toBe("idle");
    // Gone from HQ, and no socket either: asleep.
    held(false);
    expect(faceOf(drawn())).toBe("sleep");
  });

  it.each([
    { group: "unavailable", face: "sleep" },
    { group: "ready", face: "idle" },
  ] as const)(
    "ignores remembered HQ presence for a $group Mate, keeping its $face face",
    ({ group, face }) => {
      const registry = AtomRegistry.make();
      registry.set(zeropsSessionAtom, {
        status: "signed-in",
        organizationStatus: "selected",
        activeOrganization: organization,
      });
      mountHqNavigation(registry, organization.organizationId, {
        mates: Object.fromEntries([
          [
            "crm-dev",
            {
              presence: { online: true, since: "2026-10-03T10:00:00.000Z", overview: "live" },
            },
          ],
        ]),
        live: false,
      });
      const html = renderToStaticMarkup(
        <RegistryContext.Provider value={registry}>
          <SidebarZeropsTree
            candidates={[{ ...CRM_DEV, group }]}
            complete
            onBrowseProjects={() => {}}
            onSelect={() => {}}
          />
        </RegistryContext.Provider>,
      );
      expect(faceOf(html)).toBe(face);
      registry.dispose();
    },
  );

  // Board D1, 2026-09-30: a new Mate's first run is the stand-up its person's sign-in sent; the
  // row says what it is doing, under the face at work, instead of the command sent for them.
  it("says a new Mate is setting up development while its stand-up runs", () => {
    const standingUp: ZeropsAgentActivity = {
      ...working,
      subject: "Stand up development of the project.",
      task: "Stand up development of the project.",
    };
    const html = render(
      [{ ...CRM_DEV, group: "connected", environmentId: EnvironmentId.make("env-1") }],
      { getActivity: () => standingUp },
    );
    expect(faceOf(html)).toBe("working");
    expect(html).toContain("Setting up development");
    expect(html).not.toContain("Stand up development of the project.");
    expect(html).not.toContain("Working on a reply");
  });
});

describe("the project's flow under it", () => {
  const flow = (overrides: Partial<SidebarProjectFlow> = {}): SidebarProjectFlow => ({
    pullRequests: [pull(4)],
    environments: new Map([
      ["crm-stage", stageRow],
      ["crm-prod", productionRow],
    ]),
    releaseOffered: true,
    ...overrides,
  });
  const withFlow = (candidates: ReadonlyArray<ZeropsCandidate>, state = flow()) =>
    render(candidates, { getFlow: () => state });

  it("hangs the Mate's open pull requests under it", () => {
    const html = withFlow([CRM_DEV, CRM_STAGE, CRM_PROD]);
    expect(html).toContain('data-zerops-surface="sidebar-pull-request"');
    expect(html).toContain("#4 Change 4");
    expect(html.indexOf('data-zerops-surface="sidebar-mate"')).toBeLessThan(
      html.indexOf("#4 Change 4"),
    );
    // Nothing here opens a forge: the title opens the change's own page, and
    // the verdict lives in the review: no check dot on the row.
    expect(html).not.toContain("gitea.example");
    expect(html).not.toContain('aria-label="Passing"');
    expect(html).toContain('data-zerops-surface="sidebar-pull-request-review"');
  });

  // The menu has one text column (the owner, 2026-09-25: "everything jumps
  // around differently"), 56 px from its edge, and one column of marks at 16:
  // the list starts 9 px in, and a row's own inset, its mark's column and the
  // gap after it make up the rest.
  it("starts a Mate's name on the menu's one text column, its face on the column of marks", () => {
    const html = withFlow([CRM_DEV, CRM_STAGE, CRM_PROD]);
    const PX: Record<string, number> = {
      "ps-1.75": 7,
      "grid-cols-[28px_minmax(0,1fr)]": 28,
      "gap-x-3": 12,
    };
    const LIST = 9;
    const classes = (tag: string | undefined) => (tag ?? "").split(" ");
    const px = (tag: string | undefined, pattern: RegExp) =>
      PX[classes(tag).find((name) => pattern.test(name)) ?? ""] ?? Number.NaN;
    const mate = /<button class="([^"]*)"[^>]*data-zerops-surface="sidebar-mate"/u.exec(html)?.[1];
    const face = LIST + px(mate, /^ps-/u);
    expect(face).toBe(16);
    expect(face + px(mate, /^grid-cols-/u) + px(mate, /^gap-x-/u)).toBe(56);
    // A change's mark in the faces' column, its title on the words' edge.
    const change = /<li class="([^"]*)"[^>]*data-zerops-surface="sidebar-pull-request"/u.exec(
      html,
    )?.[1];
    expect(classes(change)).toContain("grid-cols-[28px_minmax(0,1fr)_auto]");
    expect(LIST + px(change, /^ps-/u) + 28 + px(change, /^gap-x-/u)).toBe(56);
  });

  // The one door to merging is the review (R1): every change says *Review*
  // in blue, and nothing on the row merges, asks or grades it.
  it("offers Review on every change, and never Merge, Ask or a status dot from the row", () => {
    for (const change of [
      pull(4),
      pull(4, { mergeability: "conflicting" }),
      pull(4, { mergeability: "checking" }),
    ]) {
      const html = withFlow([CRM_DEV, CRM_STAGE], flow({ pullRequests: [change] }));
      const rows = html.slice(html.indexOf('data-zerops-surface="sidebar-pull-requests"'));
      expect(rows).toContain('data-zerops-surface="sidebar-pull-request-review"');
      expect(rows).toContain(">Review</button>");
      expect(rows).not.toContain('data-zerops-primary-action="Merge"');
      expect(rows).not.toContain('data-zerops-primary-action="Ask"');
      expect(rows).not.toContain("sidebar-pull-request-blocked");
      expect(rows).not.toContain('data-zerops-primitive="status-dot"');
    }
  });

  // A change asks for review only once its Mate described it at its head, and only while the
  // Mate rests: a draft, or a change its Mate still works on, stays listed and opens, and asks
  // nothing.
  it.each([
    {
      case: "a change described at its head, its Mate at rest",
      ready: true,
      busy: false,
      asks: true,
    },
    { case: "a draft", ready: false, busy: false, asks: false },
    { case: "a described change its Mate still works on", ready: true, busy: true, asks: false },
  ])("lists $case, asking for review: $asks", ({ ready, busy, asks }) => {
    const atWork: ZeropsAgentActivity = {
      threadId: ThreadId.make("thread-1"),
      kind: "working",
      status: null,
      face: "working",
      subject: "Add a size guide",
      at: "2026-10-05T10:00:00.000Z",
      snippet: undefined,
      unread: false,
      pausedUntil: undefined,
      threadKey: "env:thread-1",
      task: "Add a size guide",
    };
    const html = render([CRM_DEV, CRM_STAGE], {
      getFlow: () => flow({ pullRequests: [pull(4, { ready })] }),
      ...(busy ? { getActivity: () => atWork } : {}),
    });
    const rows = html.slice(html.indexOf('data-zerops-surface="sidebar-pull-requests"'));
    expect(rows).toContain("#4 Change 4");
    expect(rows.includes('data-zerops-surface="sidebar-pull-request-review"')).toBe(asks);
  });

  // One meaning per colour (S3): the mark is amber where the change fell
  // behind main, and its own grey otherwise.
  it.each([
    { case: "that merges", change: pull(4), tone: undefined, ink: "text-muted-foreground" },
    {
      case: "that fell behind main",
      change: pull(4, { mergeability: "conflicting" }),
      tone: "attention",
      ink: "text-status-attention-text",
    },
  ])("tints only the mark of a change $case", ({ change, tone, ink }) => {
    const html = withFlow([CRM_DEV, CRM_STAGE], flow({ pullRequests: [change] }));
    const row = html.slice(html.indexOf('data-zerops-surface="sidebar-pull-request"') - 400);
    if (tone === undefined) expect(html).not.toContain("data-zerops-change-tone");
    else expect(html).toContain(`data-zerops-change-tone="${tone}"`);
    expect(row).toMatch(new RegExp(`<span class="flex justify-center ${ink}"><svg`, "u"));
  });

  it("offers to set up a stop the recipe has, in the project's menu rather than as a row", () => {
    const html = withFlow([CRM_DEV], flow({ recipeRead: true, recipeTiers: ["production"] }));
    // Not every project wants one, and a permanent row asking for something
    // optional reads as a fault (the owner, 2026-09-19).
    expect(html).not.toContain('data-zerops-surface="sidebar-environment-missing"');
    expect(html).toContain('data-zerops-surface="sidebar-project-more"');
  });

  it("says nothing about missing stops when the recipe offers none", () => {
    expect(withFlow([CRM_DEV])).not.toContain('data-zerops-surface="sidebar-environment-missing"');
  });

  // A project needs no production (the owner, 2026-09-28: "production not
  // required, this shouldn't be there"; 2026-10-05: an absent environment is a quiet slot): the
  // menu never marks it as something waiting, whatever main holds.
  it("never dots a project for the production it does not have", () => {
    // The Mate has been spoken to, so an empty flow asks for no first task.
    const activity: ZeropsAgentActivity = {
      threadId: "thread-1" as ZeropsAgentActivity["threadId"],
      kind: "idle",
      status: null,
      face: "idle",
      subject: "Something already asked",
      at: new Date().toISOString(),
      snippet: undefined,
      unread: false,
      pausedUntil: undefined,
      threadKey: "env:thread",
      task: undefined,
    };
    const html = render([CRM_DEV_CONNECTED], {
      getActivity: () => activity,
      getFlow: () =>
        flow({
          pullRequests: [],
          merged: [pull(4, { merged: true })],
          recipeRead: true,
          recipeTiers: ["production"],
        }),
    });
    expect(html).not.toContain('data-zerops-surface="sidebar-project-next-step"');
    expect(html).not.toContain("no production yet");
  });

  it("names the repository on each of a Mate's changes once they span two", () => {
    const html = withFlow(
      [CRM_DEV, CRM_STAGE],
      flow({
        pullRequests: [
          pull(1, { title: "Build the storefront" }),
          pull(1, { repository: "apidev", title: "Rebuild the API" }),
        ],
      }),
    );
    const rows = [
      ...html.matchAll(/data-zerops-surface="sidebar-pull-request"[\s\S]*?<\/li>/gu),
    ].map((match) => match[0].replace(/<[^>]+>/gu, " "));
    expect(rows).toHaveLength(2);
    expect(rows.some((row) => row.includes("appdev #1 Build the storefront"))).toBe(true);
    expect(rows.some((row) => row.includes("apidev #1 Rebuild the API"))).toBe(true);
  });

  it("folds a Mate's pull requests behind a count once there are more than three", () => {
    const html = withFlow(
      [CRM_DEV, CRM_STAGE],
      flow({ pullRequests: [pull(1), pull(2), pull(3), pull(4)] }),
    );
    expect(html).toContain("4 changes");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('data-zerops-surface="sidebar-pull-request"');
    // Three read at a glance.
    const three = withFlow(
      [CRM_DEV, CRM_STAGE],
      flow({ pullRequests: [pull(1), pull(2), pull(3)] }),
    );
    expect(three).not.toContain("changes<");
    expect(three.match(/data-zerops-surface="sidebar-pull-request"/gu)).toHaveLength(3);
  });

  // Production and stage leave the list (M1): the chip on the heading
  // carries them, so no stop is ever a row among the Mates.
  it("draws no row for a stop, and with nothing read no change, dot or verb", () => {
    const html = render([CRM_DEV, CRM_STAGE, CRM_PROD]);
    expect(html).not.toContain('sidebar-environment"');
    expect(html).not.toContain("sidebar-stop");
    expect(html).not.toContain("sidebar-pull-request");
    expect(html).not.toContain("status-dot");
    expect(html).not.toContain("Release");
  });

  it("keeps a missing Mate's open change in a separate block with Review and its identity", () => {
    const missing = pull(7, { mateProjectId: "gone-mate" });
    const html = withFlow([CRM_DEV, CRM_STAGE], flow({ pullRequests: [missing] }));
    expect(html).toContain('data-zerops-surface="sidebar-other-pull-requests"');
    expect(html).toContain("#7 Change 7 · gone-mate");
    expect(html).toContain('data-zerops-surface="sidebar-pull-request-review"');
  });

  it("keeps the recipe change counted by the Overview under its Mate", () => {
    const html = withFlow(
      [CRM_DEV, CRM_STAGE],
      flow({ pullRequests: [pull(4, { repository: "group", kind: "recipe" })] }),
    );
    expect(html).toContain('data-zerops-change="group#4"');
    expect(html).toContain("#4 Change 4");
    expect(html).toContain('data-zerops-surface="sidebar-pull-request-review"');
  });

  // The heading's lone amber dot said "something here needs you" without
  // saying who, and beside a globe it read as production in trouble (M15).
  it("wears no dot of its own: the rows and the chip say what waits", () => {
    const html = withFlow([CRM_DEV, CRM_STAGE, CRM_PROD]);
    expect(html).not.toContain("sidebar-project-next-step");
  });
});

// A Mate and its crew's line are one thing in the menu (the owner,
// 2026-09-29: "why isn't crew included in the hover?"): one unit, lit as one
// under the pointer, while a menu of its is open and by the selected band
// (`SidebarSelectedBand.test.tsx`), and its changes rows of their own.
describe("a Mate and its crew, one unit in the menu", () => {
  const crew = (): SidebarCrewRead => ({
    status: "applied",
    crew: crewDigestOf(crewSnapshotFixture()),
    logins: {},
  });
  const drawn = (options: { readonly crew: boolean; readonly open?: boolean }) =>
    mount(
      <SidebarZeropsTree
        {...(options.open === true ? { activeProjectId: "crm-dev" } : {})}
        candidates={[CRM_DEV_CONNECTED, CRM_STAGE, CRM_PROD]}
        complete
        getCrew={() => (options.crew ? crew() : undefined)}
        getFlow={() => ({
          pullRequests: [pull(4)],
          environments: new Map([
            ["crm-stage", stageRow],
            ["crm-prod", productionRow],
          ]),
          releaseOffered: true,
        })}
        onBrowseProjects={() => {}}
        onSelect={() => {}}
      />,
    );
  const unitOf = (tree: ReactTestRenderer) =>
    tree.root.find(
      (node) => typeof node.type === "string" && node.props["data-zerops-mate-unit"] === "crm-dev",
    );
  const count = (node: ReactTestInstance, name: string) =>
    node.findAll(
      (child) => typeof child.type === "string" && child.props["data-zerops-surface"] === name,
    ).length;

  it("holds the Mate's row and its crew's line, and none of its changes", () => {
    const tree = drawn({ crew: true });
    const unit = unitOf(tree);
    expect(count(unit, "sidebar-mate")).toBe(1);
    expect(count(unit, "sidebar-crew")).toBe(1);
    expect(count(unit, "sidebar-pull-request")).toBe(0);
    // The change is still drawn, under the unit, as a row of its own.
    expect(count(tree.root, "sidebar-pull-request")).toBe(1);
  });

  it("holds a Mate without a crew as its row alone, as it always stood", () => {
    const unit = unitOf(drawn({ crew: false }));
    const row = unit.find(
      (node) => typeof node.type === "string" && node.props["data-zerops-mate-row"] === "crm-dev",
    );
    const elements = (node: ReactTestInstance) =>
      node.findAll((child) => typeof child.type === "string").length;
    expect(count(unit, "sidebar-crew")).toBe(0);
    // Itself, and its row's elements: nothing else to be lit.
    expect(elements(unit)).toBe(elements(row) + 1);
  });

  it("lights as one in the row's corners, under the pointer and while a menu of its is open", () => {
    const tree = drawn({ crew: true });
    const unit = String(unitOf(tree).props.className).split(" ");
    expect(unit).toEqual(
      expect.arrayContaining([
        "menu-unit",
        "group/mate",
        "hover:bg-sidebar-row-hover",
        "has-[[data-popup-open]]:bg-sidebar-row-hover",
      ]),
    );
    // The row paints nothing of its own, so the crew's line is never outside it.
    expect(String(surface(tree, "sidebar-mate").props.className)).not.toContain(
      "bg-sidebar-row-hover",
    );
  });

  it("leaves the open Mate's unit to the selected band, which slides to it", () => {
    const unit = String(unitOf(drawn({ crew: true, open: true })).props.className);
    expect(unit).not.toContain("bg-sidebar-row-hover");
  });
});

// An HQ is open, so its releases are coming — but it has not answered them.
const HQ_OPEN = {
  deployments: new Map([
    [
      "crm-prod",
      {
        state: "known",
        asOf: { ordinal: 1, atMs: 0 },
        coverage: "complete",
        freshness: { kind: "live" },
        value: {
          kind: "running",
          activatedAt: null,
          version: {
            name: "v2.4.0",
            commit: "3f9c1b2",
            sha: undefined,
            taggedBy: undefined,
            label: "v2.4.0",
          },
        },
      },
    ],
  ]),
  flows: new Map(),
  hqAddress: "https://hq.example.test",
} as unknown as ZeropsProjectFlowValue;

describe("production and the stages are two chips on the project's heading (M2, M1)", () => {
  const released = (label: string): EnvironmentRow => ({
    ...productionRow,
    version: { ...productionRow.version, name: label, label },
    line: `release · ${label}`,
  });
  const flow = (overrides: Partial<SidebarProjectFlow> = {}): SidebarProjectFlow => ({
    pullRequests: [],
    environments: new Map([
      ["crm-stage", stageRow],
      ["crm-prod", released("v2.4.0")],
    ]),
    releaseOffered: false,
    ...overrides,
  });
  /** The heading alone: everything before the project's rows. */
  const heading = (html: string) =>
    html.slice(
      html.indexOf('data-zerops-surface="sidebar-project"'),
      html.includes("sidebar-project-rows")
        ? html.indexOf('data-zerops-surface="sidebar-project-rows"')
        : undefined,
    );
  /** Each chip on the heading: its word, its tone, its accessible name. */
  const chipsOf = (html: string) =>
    [
      ...heading(html).matchAll(
        /<button[^>]*data-zerops-surface="sidebar-production-chip"[^>]*>(.*?)<\/button>/gu,
      ),
    ].map(([button, word]) => ({
      word,
      tone: /data-tone="([^"]*)"/u.exec(button)?.[1],
      words: /aria-label="([^"]*)"/u.exec(button)?.[1],
    }));

  it("never calls production healthy where what a service runs cannot be told", () => {
    const html = render([CRM_DEV, up(CRM_PROD)], {
      getFlow: () => flow({ releaseUntold: ["api"] }),
    });
    expect(chipsOf(html)).toEqual([
      { word: "prod", tone: "neutral", words: "Production v2.4.0, can&#x27;t tell what api runs" },
    ]);
  });

  it("wears a chip for the stage and one for production, each its word alone", () => {
    const html = render([CRM_DEV, up(CRM_STAGE), up(CRM_PROD)], { getFlow: () => flow() });
    expect(chipsOf(html)).toEqual([
      { word: "stage", tone: "neutral", words: "Stage main, healthy" },
      { word: "prod", tone: "neutral", words: "Production v2.4.0, healthy" },
    ]);
    // No stop is a row under the heading, and no chip draws a dot.
    expect(html).not.toContain('sidebar-environment"');
    expect(heading(html)).not.toContain("zerops-envdot");
  });

  it("says what waits for production nowhere on the pill: it is healthy, and neutral", () => {
    const html = render([CRM_DEV, up(CRM_PROD)], {
      getFlow: () =>
        flow({
          releaseOffered: true,
          releaseContents: [
            compared([
              { sha: "a", subject: "Search box" },
              { sha: "b", subject: "Cart badge" },
            ]),
          ],
        }),
    });
    expect(chipsOf(html)).toEqual([
      { word: "prod", tone: "neutral", words: "Production v2.4.0, healthy" },
    ]);
  });

  // D′: the release is said on the heading's second line, under the name and above the Mates,
  // with the Review a merge has — never a row after the Mates.
  const lineOf = (html: string) => {
    const at = html.indexOf('data-zerops-surface="sidebar-project-line"');
    if (at === -1) return undefined;
    const row = html.slice(html.indexOf(">", at) + 1, html.indexOf("</div></div></div>", at));
    return {
      words: row
        .replace(/<[^>]+>/gu, "")
        .replace(/(Review|Details)$/u, "")
        .trim(),
      door: /sidebar-project-line-door"[^>]*>([^<]*)</u.exec(row)?.[1],
    };
  };
  it.each([
    {
      case: "changes waiting",
      flow: {
        releaseOffered: true,
        releaseContents: [
          compared([
            { sha: "a", subject: "Search box" },
            { sha: "b", subject: "Cart badge" },
          ]),
        ],
      },
      words: "2 changes not released · since v2.4.0",
      door: "Review",
    },
    {
      case: "a release that did not go out",
      flow: {
        releaseFailure: {
          tag: "v2.5.0",
          kind: "deploy-failed" as const,
          at: undefined,
          error: undefined,
          service: "app",
        },
      },
      words: "v2.5.0 didn’t go out · app’s deploy failed",
      door: "Review",
    },
  ])("says $case on the heading's second line, above the Mates", ({ flow: over, words, door }) => {
    const html = render([CRM_DEV, up(CRM_PROD)], { getFlow: () => flow(over) });
    expect(lineOf(html)).toMatchObject({ words, door });
    // Under the name, before the Mates.
    expect(html.indexOf("sidebar-project-line")).toBeLessThan(html.indexOf("sidebar-project-rows"));
  });

  it("draws no second line on a healthy project, nor on a folded one", () => {
    expect(lineOf(render([CRM_DEV, up(CRM_PROD)], { getFlow: () => flow() }))?.words).toBe("");
    stored.collapsed = new Set(["aaa"]);
    const folded = render([CRM_DEV, up(CRM_PROD)], {
      getFlow: () =>
        flow({
          releaseOffered: true,
          releaseContents: [compared([{ sha: "a", subject: "x" }])],
        }),
    });
    expect(lineOf(folded)?.words ?? "").toBe("");
    stored.collapsed = new Set();
  });

  it("marks a folded heading with what waits for a release, after its faces", () => {
    stored.collapsed = new Set(["aaa"]);
    const html = render([CRM_DEV, up(CRM_PROD)], {
      getFlow: () =>
        flow({
          releaseOffered: true,
          releaseContents: [compared([{ sha: "a", subject: "x" }])],
        }),
    });
    stored.collapsed = new Set();
    expect(
      /data-zerops-surface="sidebar-project-release-mark"[^>]*>.*?<span class="sr-only">([^<]*)</u.exec(
        html,
      )?.[1],
    ).toBe("1 change not released · since v2.4.0");
  });

  it("keeps production neutral when the newest release did not go through: the old one serves", () => {
    const html = render([CRM_DEV, up(CRM_PROD)], {
      getFlow: () =>
        flow({
          releaseFailure: {
            tag: "v2.5.0",
            kind: "deploy-failed",
            at: undefined,
            error: undefined,
            service: "app",
          },
        }),
    });
    expect(chipsOf(html)).toEqual([
      { word: "prod", tone: "neutral", words: "Production v2.4.0, healthy" },
    ]);
  });

  it("turns production red at once where the platform marks a service failed, whatever is unread", () => {
    const html = render([CRM_DEV, up(CRM_PROD, "CONTAINER_FAILED")]);
    expect(chipsOf(html)).toEqual([{ word: "prod", tone: "red", words: "Production is down" }]);
  });

  it("turns the stage chip alone when only the stage is in trouble", () => {
    const html = render([CRM_DEV, up(CRM_STAGE, "CONTAINER_FAILED"), up(CRM_PROD)], {
      getFlow: () => flow(),
    });
    expect(chipsOf(html).map((chip) => [chip.word, chip.tone])).toEqual([
      ["stage", "red"],
      ["prod", "neutral"],
    ]);
  });

  it("keeps both chips on the heading while the project is folded", () => {
    stored.collapsed = new Set(["aaa"]);
    const html = render([CRM_DEV, up(CRM_STAGE), up(CRM_PROD)], { getFlow: () => flow() });
    expect(html).not.toContain("sidebar-project-rows");
    expect(chipsOf(html).map((chip) => chip.word)).toEqual(["stage", "prod"]);
  });

  it("wears the stage chip alone where there is no production", () => {
    const html = render([CRM_DEV, up(CRM_STAGE)], {
      getFlow: () => flow({ environments: new Map([["crm-stage", stageRow]]) }),
    });
    expect(chipsOf(html)).toEqual([
      { word: "stage", tone: "neutral", words: "Stage main, healthy" },
    ]);
  });

  it("draws no chip where there is neither a production nor a stage", () => {
    expect(render([CRM_DEV], { getFlow: () => flow({ environments: new Map() }) })).not.toContain(
      "sidebar-production-chip",
    );
  });

  it("draws no chip while what decides it is unread", () => {
    // The platform has not said how the stops' services stand.
    expect(render([CRM_DEV, CRM_STAGE, CRM_PROD], { getFlow: () => flow() })).not.toContain(
      "sidebar-production-chip",
    );
  });

  it("demands its stops from a cold load with nothing remembered, and draws the chips once they answer", () => {
    const refOf = (projectId: string) =>
      ({ kind: "project", projectId, organization: { kind: "organization" } }) as ProjectRef;
    const inventory = {
      projectRefs: new Map(["crm-stage", "crm-prod"].map((id) => [id, refOf(id)])),
    } as unknown as Inventory;
    const tree = (candidates: ReadonlyArray<ZeropsCandidate>) => (
      <InventoryContext value={inventory}>
        <SidebarZeropsTree
          candidates={candidates}
          complete
          getFlow={() => flow()}
          onBrowseProjects={() => {}}
          onSelect={() => {}}
        />
      </InventoryContext>
    );
    const chips = (mounted: ReactTestRenderer) =>
      mounted.root
        .findAll(
          (node) =>
            node.type === "button" &&
            node.props["data-zerops-surface"] === "sidebar-production-chip",
        )
        .map((chip) => chip.props["aria-label"]);
    // The stops' services are unread and no chip is remembered: no chip holds their demand.
    const mounted = mount(tree([CRM_DEV, CRM_STAGE, CRM_PROD]));
    expect(chips(mounted)).toEqual([]);
    expect([...demandedStops].toSorted()).toEqual(["crm-prod", "crm-stage"]);
    act(() => {
      mounted.update(tree([CRM_DEV, up(CRM_STAGE), up(CRM_PROD)]));
    });
    expect(chips(mounted)).toEqual(["Stage main, healthy", "Production v2.4.0, healthy"]);
  });

  it("draws what the platform alone says while HQ has not answered the releases", () => {
    const tree = mount(
      <ZeropsProjectFlowContext.Provider value={HQ_OPEN}>
        <SidebarZeropsTree
          candidates={[CRM_DEV, up(CRM_PROD)]}
          complete
          onBrowseProjects={() => {}}
          onSelect={() => {}}
        />
      </ZeropsProjectFlowContext.Provider>,
    );
    const chips = tree.root.findAll(
      (node) =>
        node.type === "button" && node.props["data-zerops-surface"] === "sidebar-production-chip",
    );
    expect(chips.map((chip) => chip.props["aria-label"])).toEqual(["Production v2.4.0, healthy"]);
  });

  it("lets the jump box find production and each stage, each with its own dot and words", () => {
    mount(
      <SidebarZeropsTree
        candidates={[CRM_DEV, up(CRM_STAGE, "CONTAINER_FAILED"), up(CRM_PROD)]}
        complete
        getFlow={() => flow()}
        onBrowseProjects={() => {}}
        onSelect={() => {}}
      />,
    );
    expect(useSidebarJump.getState().index?.stops).toEqual([
      expect.objectContaining({
        projectId: "crm-stage",
        dot: "failed",
        line: "3f9c1b2",
        word: "Stage is down",
      }),
      expect.objectContaining({
        projectId: "crm-prod",
        dot: "ok",
        line: "v2.4.0",
        word: "Production v2.4.0, healthy",
      }),
    ]);
  });

  it("names on each chip the stops a find lands on", () => {
    const html = render([CRM_DEV, up(CRM_STAGE), up(CRM_PROD)], { getFlow: () => flow() });
    expect(heading(html)).toContain('data-zerops-stops="crm-stage"');
    expect(heading(html)).toContain('data-zerops-stops="crm-prod"');
  });
});

describe("New project at the menu's foot (D11)", () => {
  const row = (html: string) =>
    /<button[^>]*data-zerops-surface="sidebar-new-project"[^>]*>(.*?)<\/button>/u.exec(html);

  // Pinned above the account's row, the same place whatever the list's
  // length (the owner, 2026-09-29: "not sure if this shouldn't be stuck to
  // the bottom somehow"): the list scrolls under it, so it is never one of
  // the list's rows.
  it("is never one of the list's rows", () => {
    expect(row(render([CRM_DEV, LINKS_MATE]))).toBeNull();
    expect(row(render([]))).toBeNull();
  });

  it("keeps the row's look: the + in the faces' column, the words on the text edge", () => {
    const html = renderToStaticMarkup(<SidebarNewProject onNewProject={() => {}} />);
    // On the list's own inset, so the + stands at 16 px and the words at 56.
    const slot = /<div class="([^"]*)"/u.exec(html)![1]!.split(" ");
    expect(slot).toEqual(expect.arrayContaining(["shrink-0", "ps-2.25", "pe-2"]));
    const found = row(html);
    expect(found).not.toBeNull();
    const classes = /class="([^"]*)"/u.exec(found![0])![1]!.split(" ");
    expect(classes).toEqual(expect.arrayContaining(["h-7", "ps-1.75", "gap-3", "rounded-lg"]));
    expect(found![1]).toContain("lucide-plus");
    expect(found![1]).toMatch(/<span class="[^"]*\bw-7\b/u);
    expect(found![1]).toContain(">New project</span>");
  });

  it("starts a new project when pressed", () => {
    let started = 0;
    const mounted = mount(
      <SidebarNewProject
        onNewProject={() => {
          started += 1;
        }}
      />,
    );
    press(mounted, "sidebar-new-project");
    expect(started).toBe(1);
  });
});

describe("a project collapsed to its heading", () => {
  const tree = (props: Record<string, unknown> = {}) => (
    <SidebarZeropsTree
      candidates={[CRM_DEV, CRM_STAGE, CRM_PROD]}
      complete
      onBrowseProjects={() => {}}
      onSelect={() => {}}
      {...props}
    />
  );
  const mates = (mounted: ReactTestRenderer) =>
    mounted.root.findAll(
      (node) =>
        typeof node.type === "string" && node.props["data-zerops-surface"] === "sidebar-mate",
    );

  it("collapses from the heading's name and remembers it; the name opens it again", () => {
    const mounted = mount(tree());
    expect(surface(mounted, "sidebar-project-toggle").props["aria-expanded"]).toBe(true);
    press(mounted, "sidebar-project-toggle");
    expect(mates(mounted)).toHaveLength(0);
    expect(surface(mounted, "sidebar-project-toggle").props["aria-expanded"]).toBe(false);
    expect(stored.written).toEqual(new Set(["aaa"]));
    press(mounted, "sidebar-project-toggle");
    expect(mates(mounted)).toHaveLength(1);
    expect(stored.written).toEqual(new Set());
  });

  it("draws only the heading of a project collapsed last time", () => {
    stored.collapsed = new Set(["aaa"]);
    const html = renderToStaticMarkup(
      tree({
        getFlow: (): SidebarProjectFlow => ({
          pullRequests: [pull(4)],
          environments: new Map([["crm-prod", productionRow]]),
          releaseOffered: true,
        }),
      }),
    );
    expect(html).toContain('data-zerops-surface="sidebar-project"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("sidebar-project-next-step");
    // No summary and no small badges: a second design of the rows is what the
    // owner turned down.
    for (const gone of ["sidebar-mate", "sidebar-pull-request", "sidebar-project-rows"])
      expect(html).not.toContain(`data-zerops-surface="${gone}"`);
  });

  // A heading never moves when it is pressed (M9): the room between two
  // projects is at the end of an open one — its rows unfold below the heading
  // with the room after them — and folded projects stack as a list of names.
  it("keeps the room at the end of an open project, never above a heading", () => {
    const notes = named("notes-dev", "Notes - dev", {
      tags: ["mate"],
      hq: inApp("notes", "Notes"),
    });
    stored.collapsed = new Set(["links", "notes"]);
    const html = render([CRM_DEV, LINKS_MATE, notes]);
    const sections = [...html.matchAll(/<section class="([^"]*)" data-zerops-group="([^"]*)"/g)];
    expect(sections.map(([, , group]) => group)).toEqual(["aaa", "links", "notes"]);
    for (const [, classes] of sections)
      expect(classes!.split(" ").filter((name) => /^m[ty]-/u.test(name))).toEqual([]);
    // Only the open project draws its rows, and they end with its room.
    const rows = [
      ...html.matchAll(/data-zerops-surface="sidebar-project-rows"><div class="([^"]*)"/g),
    ].map(([, classes]) => classes!.split(" "));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(expect.arrayContaining(["pt-1.5", "pb-9"]));
  });

  // The owner, 2026-09-29, of the list's rhythm: "slightly decrease the space
  // between open project and next project", "slightly increase the space
  // between project title and first mate", "slightly increase the space
  // between closed projects". From one text's foot to the next text's head:
  // a heading hands over to its first Mate at 20, as a folded heading to the
  // next; Mates follow one another at 30; an open project hands over to the
  // next at 50 — the folded 20 and one Mate's 30. Each group reads as one:
  // heading to row < row to row < project to project.
  it("steps 20 from a heading to what follows it, 30 from Mate to Mate, 50 from an open project to the next", () => {
    const notes = named("notes-dev", "Notes - dev", {
      tags: ["mate"],
      hq: inApp("notes", "Notes"),
    });
    const two = { ...named("crm-b", "CRM - b", { tags: ["mate"], hq: AAA() }) };
    stored.collapsed = new Set(["links", "notes"]);
    const html = render([CRM_DEV, two, LINKS_MATE, notes]);
    const PX: Record<string, number> = {
      "h-8": 32,
      "leading-6": 24,
      "pt-1.5": 6,
      "pb-9": 36,
      "py-2.5": 10,
      "mt-2.5": 10,
      "h-3": 12,
    };
    const classesOf = (pattern: RegExp) => pattern.exec(html)?.[1]?.split(" ") ?? [];
    const px = (classes: ReadonlyArray<string>, pattern: RegExp) =>
      PX[classes.find((name) => pattern.test(name)) ?? ""] ?? NaN;
    const heading = classesOf(/<div class="([^"]*)"[^>]*data-zerops-surface="sidebar-project"/u);
    const title = classesOf(/<span class="([^"]*zerops-project-name[^"]*)"/u);
    const rows = classesOf(/data-zerops-surface="sidebar-project-rows"><div class="([^"]*)"/u);
    const mate = classesOf(/<button class="([^"]*)"[^>]*data-zerops-surface="sidebar-mate"/u);
    const block = classesOf(/<div class="(flex flex-col mt-2\.5)"/u);
    const folded = classesOf(
      /<div aria-hidden="true" class="([^"]*)"[^>]*data-zerops-surface="sidebar-project-room"/u,
    );
    // The words' inset in their boxes: a heading's title, a Mate row's lines.
    const titleInset = (px(heading, /^h-8$/u) - px(title, /^leading-6$/u)) / 2;
    const mateInset = px(mate, /^py-2\.5$/u);
    const gaps = {
      headingToMate: titleInset + px(rows, /^pt-/u) + mateInset,
      mateToMate: mateInset + px(block, /^mt-/u) + mateInset,
      openToNext: mateInset + px(rows, /^pb-/u) + titleInset,
      foldedToFolded: titleInset + px(folded, /^h-/u) + titleInset,
    };
    expect(gaps).toEqual({ headingToMate: 20, mateToMate: 30, openToNext: 50, foldedToFolded: 20 });
    expect(gaps.headingToMate).toBeLessThan(gaps.mateToMate);
    expect(gaps.mateToMate).toBeLessThan(gaps.openToNext);
    expect(gaps.openToNext).toBe(gaps.foldedToFolded + gaps.mateToMate);
  });

  // Folded names stand a little apart (the owner, 2026-09-29: "increase the
  // spacing between a little", then "slightly increase the space between
  // closed projects"): 12 px under a folded heading, its own — the room a
  // fold leaves and an unfold starts from — so no heading moves.
  it("leaves 12 px under a folded heading, and none under the list's last", () => {
    const notes = named("notes-dev", "Notes - dev", {
      tags: ["mate"],
      hq: inApp("notes", "Notes"),
    });
    stored.collapsed = new Set(["links", "notes"]);
    const html = render([CRM_DEV, LINKS_MATE, notes]);
    const room = (group: string) => {
      const at = html.indexOf(`data-zerops-group="${group}"`);
      const section = html.slice(at, html.indexOf("</section>", at));
      return /<div[^>]*data-zerops-surface="sidebar-project-room"[^>]*>/u.exec(section)?.[0];
    };
    expect(room("links")).toContain('class="h-3 shrink-0"');
    expect(room("links")).toContain('aria-hidden="true"');
    expect(room("notes")).toBeUndefined();
    expect(room("aaa")).toBeUndefined();
  });

  // Folded, a heading shows who is busy in it (M15): the faces of its Mates
  // that need you, work, or finished unseen, a dot for what is not work.
  it("shows its busy Mates' faces while folded, and none while open", () => {
    const MATES = [
      { ...named("crm-a", "Ada", { tags: ["mate"], hq: AAA("mate", true) }) },
      { ...named("crm-b", "Bo", { tags: ["mate"], hq: AAA("mate", true) }) },
      { ...named("crm-c", "Cy", { tags: ["mate"], hq: AAA("mate", true) }) },
    ].map((item) => mine({ ...item, group: "connected" }) as ZeropsCandidate);
    session.viewer = "u-ada";
    const busy = (id: string): ZeropsAgentActivity => ({
      threadId: `thread-${id}` as ZeropsAgentActivity["threadId"],
      kind: id === "crm-a" ? "working" : id === "crm-b" ? "input" : "idle",
      status: null,
      face: id === "crm-a" ? "working" : id === "crm-b" ? "needs" : "idle",
      subject: "Something",
      at: new Date().toISOString(),
      snippet: undefined,
      unread: false,
      pausedUntil: undefined,
      threadKey: `env:${id}`,
      task: undefined,
    });
    const faces = (html: string) =>
      /data-zerops-surface="sidebar-project-faces">(.*?)<span class="sr-only">([^<]*)</u.exec(html);
    stored.collapsed = new Set(["aaa"]);
    const folded = render(MATES, { getActivity: (item: ZeropsCandidate) => busy(item.project.id) });
    const shown = faces(folded);
    expect(shown).not.toBeNull();
    // Who needs you comes first, then who works; the idle one is not shown.
    expect(shown![2]).toBe("Bo needs you, Ada is working");
    expect(shown![1]!.match(/data-mate-face-state="/gu)).toHaveLength(2);
    expect(shown![1]).toContain('data-dot="attention"');
    stored.collapsed = new Set();
    expect(
      render(MATES, { getActivity: (item: ZeropsCandidate) => busy(item.project.id) }),
    ).not.toContain("sidebar-project-faces");
  });

  // A Mate whose own change waits for the person's review needs them, as the
  // composer's top says (`mateNextStep`): folded, its heading shows its face
  // (the owner, 2026-09-30: a folded project read only its name while its
  // Mate's #2 waited for Review); open, its row wears the same face.
  it("shows a Mate whose change waits for review on its folded heading, and its row wears the same face", () => {
    const resting: ZeropsAgentActivity = {
      threadId: "thread-crm" as ZeropsAgentActivity["threadId"],
      kind: "idle",
      status: null,
      face: "idle",
      subject: "Something",
      at: new Date().toISOString(),
      snippet: undefined,
      unread: false,
      pausedUntil: undefined,
      threadKey: "env-crm-dev:thread-crm",
      task: undefined,
    };
    const props = {
      getActivity: () => resting,
      getFlow: (): SidebarProjectFlow => ({
        pullRequests: [pull(2)],
        environments: new Map(),
        releaseOffered: false,
      }),
    };
    session.viewer = "u-ada";
    stored.collapsed = new Set(["aaa"]);
    const folded = render([mine(CRM_DEV_CONNECTED)], props);
    const shown =
      /data-zerops-surface="sidebar-project-faces">(.*?)<span class="sr-only">([^<]*)</u.exec(
        folded,
      );
    expect(shown?.[2]).toMatch(/needs you$/u);
    expect(shown?.[1]).toContain('data-mate-face-state="needs"');
    expect(shown?.[1]).toContain('data-dot="attention"');
    stored.collapsed = new Set();
    const open = render([mine(CRM_DEV_CONNECTED)], props);
    expect(open).not.toContain("sidebar-project-faces");
    expect(open).toContain('data-mate-face-state="needs"');
    // Still being checked, it waits on HQ, not on the person: at rest.
    const checking = render([mine(CRM_DEV_CONNECTED)], {
      ...props,
      getFlow: (): SidebarProjectFlow => ({
        pullRequests: [pull(2, { mergeability: "checking" })],
        environments: new Map(),
        releaseOffered: false,
      }),
    });
    expect(checking).not.toContain('data-mate-face-state="needs"');
  });

  // Another's Mate waits on its owner, not the viewer (the owner, 2026-09-30: "sana doesn't wait
  // for me, it waits for karlos"): no needs face, no amber, nothing on its folded heading — and
  // its change keeps its Review, for anybody with write on the group to merge.
  it("claims nothing of the viewer for another's Mate whose change waits, and keeps its Review", () => {
    session.viewer = "u-ada";
    const theirs = mine(CRM_DEV_CONNECTED, "u-karlos");
    const props = {
      getActivity: (): ZeropsAgentActivity => ({
        threadId: "thread-crm" as ZeropsAgentActivity["threadId"],
        kind: "idle",
        status: null,
        face: "idle",
        subject: "Something",
        at: new Date().toISOString(),
        snippet: undefined,
        unread: false,
        pausedUntil: undefined,
        threadKey: "env-crm-dev:thread-crm",
        task: undefined,
      }),
      getFlow: (): SidebarProjectFlow => ({
        pullRequests: [pull(2)],
        environments: new Map(),
        releaseOffered: false,
      }),
    };
    stored.collapsed = new Set(["aaa"]);
    expect(render([theirs], props)).not.toContain("sidebar-project-faces");
    stored.collapsed = new Set();
    const open = render([theirs], props);
    expect(open).not.toContain('data-mate-face-state="needs"');
    expect(open).not.toContain('data-zerops-surface="sidebar-mate-dot"');
    expect(open).toContain('data-zerops-surface="sidebar-pull-request"');
    expect(open).toContain(">Review<");
  });

  // A folded heading's face is its row's (`mateRowView`): a Mate stopped on
  // an error stands still with a red dot, as it does in the list — and what
  // the heading opened onto is simply there: no dot scales in on a paint.
  it("wears each Mate's row face — still where it stopped on an error — and scales no dot in on a paint", () => {
    stored.collapsed = new Set(["aaa"]);
    const failed: ZeropsAgentActivity = {
      threadId: "thread-crm" as ZeropsAgentActivity["threadId"],
      kind: "failed",
      status: null,
      face: "needs",
      subject: "Something",
      at: new Date().toISOString(),
      snippet: undefined,
      errorLine: "The type check stopped at 2 errors",
      unread: false,
      pausedUntil: undefined,
      threadKey: "env-crm-dev:thread-crm",
      task: undefined,
    };
    const html = render([CRM_DEV_CONNECTED], { getActivity: () => failed });
    const shown = /data-zerops-surface="sidebar-project-faces">(.*?)<span class="sr-only">/u.exec(
      html,
    )?.[1];
    expect(shown).toContain('data-mate-face-state="idle"');
    expect(shown).toContain('data-dot="failed"');
    expect(shown).not.toContain("data-arrived");
  });

  it("greets nothing its folded heading only stood in for until the Mate's state was read", () => {
    stored.collapsed = new Set(["aaa"]);
    const told: ZeropsAgentActivity = {
      threadId: ThreadId.make("thread-1"),
      kind: "idle",
      status: null,
      face: "idle",
      subject: "Something",
      at: "2026-09-27T10:00:00.000Z",
      snippet: undefined,
      unread: true,
      pausedUntil: undefined,
      threadKey: "env-crm-dev:thread-1",
      task: undefined,
    };
    const { remembered: _stoodIn, ...read } = restingActivity(told);
    const tree = (item: ZeropsCandidate, activity: ZeropsAgentActivity) => (
      <SidebarZeropsTree
        candidates={[item]}
        complete
        getActivity={() => activity}
        onBrowseProjects={() => {}}
        onSelect={() => {}}
      />
    );
    const mounted = mount(tree(CRM_DEV, restingActivity(told)));
    session.viewer = "u-ada";
    act(() => {
      mounted.update(tree(mine(CRM_DEV_CONNECTED), { ...read, kind: "input", face: "needs" }));
    });
    const faces = mounted.root.find(
      (node) =>
        typeof node.type === "string" &&
        node.props["data-zerops-surface"] === "sidebar-project-faces",
    );
    const face = faces.find(
      (node) =>
        typeof node.type === "string" && node.props["data-zerops-primitive"] === "mate-face",
    );
    expect(face.props["data-mate-face-state"]).toBe("needs");
    expect(face.props["data-mate-face-arrived"]).toBeUndefined();
    const dot = faces.find(
      (node) => typeof node.type === "string" && node.props.className === "zerops-heading-dot",
    );
    expect(dot.props["data-dot"]).toBe("attention");
    expect(dot.props["data-arrived"]).toBeUndefined();
  });

  it("keeps less room under the list's last project", () => {
    const rows = /data-zerops-surface="sidebar-project-rows"><div class="([^"]*)"/u.exec(
      render([CRM_DEV]),
    )?.[1];
    expect(rows?.split(" ")).toEqual(expect.arrayContaining(["pt-1.5", "pb-4"]));
  });

  // The faces arrive once the rows have folded away, under a pointer still on
  // the heading: + and ⋯ stand after the room that takes them up, never after
  // the faces, so nothing a person is about to press moves.
  it("keeps + and ⋯ at the heading's end, past the room the faces take", () => {
    const html = renderToStaticMarkup(
      <ProjectHeader
        collapsed
        faces={<span data-zerops-surface="sidebar-project-faces" />}
        name="Links"
        onBrowseProjects={() => {}}
        onToggle={() => {}}
        chips={<span data-zerops-surface="sidebar-production-chip" />}
      />,
    );
    const at = (needle: string) => html.indexOf(needle);
    const room = at('<span aria-hidden="true" class="min-w-0 flex-1"></span>');
    expect(room).toBeGreaterThan(at("sidebar-project-faces"));
    expect(at("sidebar-project-add-mate")).toBeGreaterThan(room);
    expect(at("sidebar-project-more")).toBeGreaterThan(at("sidebar-project-add-mate"));
    expect(at("sidebar-production-chip")).toBeGreaterThan(at("sidebar-project-more"));
  });

  // The owner, 2026-09-29: the + "leaves the conversation". It asks for the New Mate dialog over
  // whatever is on screen, and goes nowhere.
  it.each(["sidebar-project-add-mate"])(
    "asks for a Mate in place from its %s, going nowhere",
    (verb) => {
      const asked: Array<string> = [];
      let browsed = 0;
      const tree = mount(
        <ProjectHeader
          group={buildZeropsGroupTree([CRM_DEV], { order: "name" }).groups[0]!.group}
          onAddMate={(groupId: string) => {
            asked.push(groupId);
          }}
          onBrowseProjects={() => {
            browsed += 1;
          }}
          onToggle={() => {}}
        />,
      );
      press(tree, verb);
      expect(asked).toEqual(["aaa"]);
      expect(browsed).toBe(0);
    },
  );

  it("wears one chevron that turns, the heading saying whether it is folded", () => {
    const heading = (collapsed: boolean) =>
      renderToStaticMarkup(
        <ProjectHeader
          collapsed={collapsed}
          name="Links"
          onBrowseProjects={() => {}}
          onToggle={() => {}}
        />,
      );
    const chevron = (collapsed: boolean) =>
      /<svg[^>]*data-zerops-surface="sidebar-project-chevron"[^>]*>/u.exec(
        heading(collapsed),
      )?.[0] ?? "";
    // One glyph in both states: it turns a quarter down while open (the
    // stylesheet's `.zerops-project-chevron`), so opening is one movement.
    for (const collapsed of [true, false]) {
      expect(chevron(collapsed)).toContain("lucide-chevron-right");
      expect(chevron(collapsed)).toContain("zerops-project-chevron");
    }
    expect(heading(true)).toContain('data-collapsed="true"');
    expect(heading(false)).not.toContain("data-collapsed");
  });

  it("is 32 px tall, its title on the mark edge, its end on the rows' end edge, its verbs 28 px and always in their slot", () => {
    const html = renderToStaticMarkup(
      <ProjectHeader
        group={buildZeropsGroupTree([CRM_DEV], { order: "name" }).groups[0]!.group}
        onBrowseProjects={() => {}}
        onToggle={() => {}}
      />,
    );
    const heading = /<div class="([^"]*)"[^>]*data-zerops-surface="sidebar-project"/u.exec(html);
    expect(heading?.[1]?.split(" ")).toEqual(
      expect.arrayContaining(["h-8", "ms-px", "me-0.5", "ps-1.5", "pe-1.5"]),
    );
    const title = /<span class="([^"]*)">Beviro CRM</u.exec(html)?.[1]?.split(" ") ?? [];
    expect(title).toEqual(
      expect.arrayContaining(["text-base", "leading-6", "font-semibold", "zerops-project-name"]),
    );
    for (const verb of ["sidebar-project-add-mate", "sidebar-project-more"]) {
      const button = new RegExp(`<button[^>]*data-zerops-surface="${verb}"[^>]*>`, "u").exec(
        html,
      )?.[0];
      expect(button).toContain("size-7");
      expect(button).toContain("rounded-md");
    }
  });

  // The logo row and the projects are two groups (the owner, 2026-09-29:
  // "first project is too close to logo"): the list stands 16 px under the
  // row, so the first project's name starts 43 px under the mark's foot,
  // where one folded heading's stands 29 px under the one before it.
  it("stands the list 16 px under the logo row", () => {
    const nav = /<nav[^>]*class="([^"]*)"/u.exec(render([CRM_DEV]))?.[1]?.split(" ") ?? [];
    expect(nav).toContain("pt-4");
  });

  // The band stands as far from the window as from the divider, and the
  // chips sit in it with one gap above, below and after them, so its corners
  // run parallel to theirs (S4; the owner, 2026-09-29: "the tag no properly
  // aligned on the left with border radius looking bad"). The title keeps the
  // mark edge and the chips the menu's end edge: the band moved, not them.
  it("stands its band 10 px from either side of the menu, the chips 6 px inside it, its corners parallel to theirs", () => {
    const sheet = NodeFS.readFileSync(new URL("../../index.css", import.meta.url), "utf8").replace(
      /\/\*[\s\S]*?\*\//gu,
      "",
    );
    const rule = (selector: string) => {
      const at = sheet.indexOf(`\n${selector} {`);
      const body = sheet.slice(sheet.indexOf("{", at) + 1, sheet.indexOf("}", at));
      return new Map(
        body
          .split(";")
          .map((declaration) => declaration.split(":").map((part) => part.trim()))
          .filter(([property]) => property !== undefined && property !== "")
          .map(([property, ...value]) => [property!, Number.parseFloat(value.join(":"))]),
      );
    };
    const PX: Record<string, number> = {
      "ms-px": 1,
      "me-0.5": 2,
      "ps-1.5": 6,
      "pe-1.5": 6,
      "h-8": 32,
    };
    // The list's own inset: 9 px from the window, 8 from the divider.
    const LIST = { start: 9, end: 8 };
    const classes =
      /<div class="([^"]*)"[^>]*data-zerops-surface="sidebar-project"/u
        .exec(
          renderToStaticMarkup(
            <ProjectHeader name="Beviro" onBrowseProjects={() => {}} onToggle={() => {}} />,
          ),
        )?.[1]
        ?.split(" ") ?? [];
    const px = (pattern: RegExp) => PX[classes.find((name) => pattern.test(name)) ?? ""] ?? NaN;
    const bandStart = LIST.start + px(/^ms-/u);
    const bandEnd = LIST.end + px(/^me-/u);
    expect(bandStart).toBe(10);
    expect(bandEnd).toBe(bandStart);
    // The title on the mark edge; the chips on the menu's end edge, 16 px in.
    expect(bandStart + px(/^ps-/u)).toBe(16);
    expect(bandEnd + px(/^pe-/u)).toBe(16);
    const chip = rule(".zerops-envchip");
    const band = rule(".zerops-project-heading");
    const gap = (px(/^h-8$/u) - (chip.get("height") ?? NaN)) / 2;
    // One gap above, below and after the chips.
    expect(gap).toBe(px(/^pe-/u));
    expect(band.get("border-radius")).toBe((chip.get("border-radius") ?? NaN) + gap);
    expect(rule(".zerops-project-heading::before").get("border-radius")).toBe(
      band.get("border-radius"),
    );
  });

  // The whole heading folds the project, so it lights under the pointer as a
  // row does (the owner, 2026-09-29: "very slight grey bg on the hover"); the
  // ungrouped heading folds nothing and stays unlit.
  it("lights a heading that folds under the pointer, and never the ungrouped one", () => {
    const classes = (html: string) =>
      /<div class="([^"]*)"[^>]*data-zerops-surface="sidebar-project"/u.exec(html)?.[1]?.split(" ");
    expect(
      classes(
        renderToStaticMarkup(
          <ProjectHeader name="Beviro" onBrowseProjects={() => {}} onToggle={() => {}} />,
        ),
      ),
    ).toContain("zerops-project-heading");
    expect(
      classes(
        renderToStaticMarkup(<ProjectHeader muted name="Ungrouped" onBrowseProjects={() => {}} />),
      ),
    ).not.toContain("zerops-project-heading");
  });

  it("starts the title at the rail's own left edge and hangs the chevron after it", () => {
    const toggle =
      /<button[^>]*data-zerops-surface="sidebar-project-toggle"[^>]*>(.*?)<\/button>/u.exec(
        renderToStaticMarkup(
          <ProjectHeader name="Beviro" onBrowseProjects={() => {}} onToggle={() => {}} />,
        ),
      )?.[1] ?? "";
    // The title first, so it sits where the rail cell starts (the owner,
    // 2026-09-25: the chevron before it pushed it 18px right of the rail).
    expect(toggle.indexOf(">Beviro<")).toBeGreaterThan(-1);
    expect(toggle.indexOf(">Beviro<")).toBeLessThan(toggle.indexOf("sidebar-project-chevron"));
    // The title hugs its text, so the chevron follows the words, not the row's end.
    expect(/<span class="([^"]*)"[^>]*>Beviro</u.exec(toggle)?.[1]).not.toContain("flex-1");
  });

  it("collapses rather than opens the project from its name; the page is the menu's to open", () => {
    let opened = 0;
    let toggled = 0;
    const mounted = mount(
      <ProjectHeader
        name="Links"
        onBrowseProjects={() => {}}
        onOpen={() => {
          opened += 1;
        }}
        onToggle={() => {
          toggled += 1;
        }}
      />,
    );
    press(mounted, "sidebar-project-toggle");
    expect({ opened, toggled }).toEqual({ opened: 0, toggled: 1 });
    // The ungrouped heading is not a project: nothing to collapse.
    expect(
      renderToStaticMarkup(<ProjectHeader muted name="Ungrouped" onBrowseProjects={() => {}} />),
    ).not.toContain("sidebar-project-toggle");
  });

  it("opens a collapsed project when one of its Mates' conversations opens, and lets it collapse again", () => {
    stored.collapsed = new Set(["aaa"]);
    const mounted = mount(tree({ activeProjectId: null }));
    expect(mates(mounted)).toHaveLength(0);
    act(() => {
      mounted.update(tree({ activeProjectId: "crm-dev" }));
    });
    expect(mates(mounted)).toHaveLength(1);
    expect(stored.written).toEqual(new Set());
    press(mounted, "sidebar-project-toggle");
    act(() => {
      mounted.update(tree({ activeProjectId: "crm-dev" }));
    });
    expect(mates(mounted)).toHaveLength(0);
  });

  it("opens a collapsed project whose Mate's conversation is already open when the menu mounts", () => {
    stored.collapsed = new Set(["aaa"]);
    const mounted = mount(tree({ activeProjectId: "crm-dev" }));
    expect(mates(mounted)).toHaveLength(1);
    expect(stored.written).toEqual(new Set());
  });
});

describe("the Mate's card", () => {
  const NAMED = named("crm-dev", "Ada", { tags: ["mate"], hq: AAA("mate", true) });
  const working: ZeropsAgentActivity = {
    threadId: "t1" as ZeropsAgentActivity["threadId"],
    kind: "working",
    status: {
      kind: "working",
      toneId: "active",
      label: "Working",
      colorClass: "text-sky-600",
      dotClass: "bg-sky-500",
      pulse: true,
    },
    face: "working",
    subject: "Reviewing the migration",
    at: "2026-09-06T10:00:00.000Z",
    snippet: undefined,
    unread: false,
    pausedUntil: undefined,
    threadKey: "env:thread",
    task: undefined,
  };

  it("leads with the agent's name — not the project's, not its tag", () => {
    const html = render([NAMED]);
    expect(html).toContain("Ada");
    expect(html).not.toContain(">crm-dev<");
    expect(html).not.toContain("role-tag");
  });

  it("wears the conversation's state and says what it is on, when the caller knows", () => {
    const html = render([{ ...NAMED, group: "connected" }], { getActivity: () => working });
    expect(html).toContain('data-mate-face-state="working"');
    expect(html).toContain('data-zerops-surface="sidebar-mate-subject"');
    expect(html).toContain("Reviewing the migration");
    // The face is the state; the word would say it twice.
    expect(html).not.toContain(">Working<");
    expect(html).not.toContain("animate-status-pulse");
  });

  it("gives a connected environment with nothing running open eyes, and no word about it", () => {
    // The socket is the client's business; the row answers what the agent is
    // up to — with its face. Nothing known about the conversation, no line.
    const html = render([{ ...NAMED, group: "connected" }]);
    expect(html).toContain('data-mate-face-state="idle"');
    expect(html).not.toContain(">Idle<");
    expect(html).not.toContain("Connected");
    expect(html).not.toContain("sidebar-mate-subject");
  });

  // Waking while it arrives (`mateFaceFor`): from its press to its first sign-in, inside its
  // window — never a Mate signed in once, nor one nobody signed in for days (Everyone).
  it.each([
    {
      case: "up, made minutes ago, nobody signed in",
      ago: 5,
      signed: false,
      group: "connected",
      face: "waking",
    },
    {
      case: "its socket not up yet, made minutes ago",
      ago: 5,
      signed: false,
      group: "ready",
      face: "waking",
    },
    {
      case: "up, made two days ago, nobody signed in",
      ago: 2880,
      signed: false,
      group: "connected",
      face: "idle",
    },
    {
      case: "up, made minutes ago, signed in once",
      ago: 5,
      signed: true,
      group: "connected",
      face: "idle",
    },
  ] as const)("$case: $face", ({ ago, signed, group, face }) => {
    const made = new Date(Date.now() - ago * 60_000).toISOString();
    const listed = NAMED.project.tagList ?? [];
    const tagList = listed;
    const hq = signed ? recorded(NAMED.project.hq!, signedBy("u-eva")) : NAMED.project.hq;
    const html = render([
      {
        ...NAMED,
        group,
        project: { ...NAMED.project, created: made, tagList, ...(hq === undefined ? {} : { hq }) },
      },
    ]);
    expect(html).toContain(`data-mate-face-state="${face}"`);
  });

  // Its container runs (`candidateContainerRuns`): this browser's socket not open is its own wait.
  it("is awake for a running container nobody has connected to", () => {
    const html = render([NAMED]);
    expect(html).toContain('data-mate-face-state="idle"');
    expect(html).not.toContain(">Ready<");
  });

  it("stays awake while a registered environment's socket comes up — it wears its running container", () => {
    const connecting: ZeropsCandidate & {
      readonly connection: { phase: "connecting"; error: null; traceId: null };
    } = { ...NAMED, connection: { phase: "connecting", error: null, traceId: null } };
    const html = render([connecting]);
    expect(html).toContain('data-mate-face-state="idle"');
    expect(html).not.toContain(">Connecting<");
  });
});

describe("the sidebar and the projects page read one group the same way", () => {
  const reads = (over: Partial<GroupFlowReads> = {}): GroupFlowReads => ({
    environments: [],
    pullRequests: [],
    merged: [],
    release: {
      gate: { allowed: false, reason: "Nothing to release." },
      suggestion: "",
      contents: [],
      untold: [],
    },
    ...over,
  });
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly candidates: ReadonlyArray<ZeropsCandidate>;
    readonly reads: GroupFlowReads;
    readonly expected: GroupNextStepKind;
  }> = [
    {
      name: "a mergeable change asks for the merge",
      candidates: [CRM_DEV],
      reads: reads({ pullRequests: [pull(4)] }),
      expected: "merge",
    },
    {
      name: "merged code with no production asks nothing: an absent environment is a slot",
      candidates: [CRM_DEV],
      reads: reads({ merged: [pull(4, { merged: true })] }),
      expected: "none",
    },
    {
      name: "merged work not live on a production asks for the release",
      candidates: [CRM_DEV, CRM_PROD],
      reads: reads({
        merged: [pull(4, { merged: true })],
        environments: [productionRow],
        release: {
          gate: { allowed: true },
          suggestion: "v0.2.0",
          contents: [compared([{ sha: "a".repeat(40), subject: "Add a field" }])],
          untold: [],
        },
      }),
      expected: "release",
    },
  ];

  it.each(cases)("$name", ({ candidates, reads: groupReads, expected }) => {
    const group = buildZeropsGroupTree(candidates, { order: "name" }).groups[0]!;
    const page = groupFlow(
      groupFlowInputOf({
        groupId: group.group.groupId,
        members: groupMemberFactsOf(
          group.environments,
          () => undefined,
          () => false,
          () => false,
        ),
        flow: groupReads,
        deployments: new Map(),
        pending: group.group.pending,
      }),
    ).nextStep;
    expect(page.kind).toBe(expected);

    const sidebar: SidebarProjectFlow = {
      pullRequests: groupReads.pullRequests,
      merged: groupReads.merged,
      environments: new Map(groupReads.environments.map((row) => [row.projectId, row])),
      releaseOffered: groupReads.release.gate.allowed,
      releaseContents: groupReads.release.contents,
      releaseTag: groupReads.release.suggestion,
    };
    // The heading carries no step of its own any more (M15): its rows, its
    // faces and its production chip say what waits, each where it is.
    const html = render(candidates, { getFlow: () => sidebar });
    expect(html).not.toContain("sidebar-project-next-step");
  });
});

describe("arranging the projects by hand", () => {
  /** The stylesheet the heading's band is drawn by, without its comments. */
  const STYLESHEET = NodeFS.readFileSync(
    new URL("../../index.css", import.meta.url),
    "utf8",
  ).replace(/\/\*[\s\S]*?\*\//gu, "");
  const SHOP_MATE = named("shop-dev", "Shop - dev", { tags: ["mate"], hq: inApp("shop", "Shop") });
  const order = (html: string) =>
    [...html.matchAll(/data-zerops-group="([^"]+)"/gu)].map((match) => match[1]);
  afterEach(() => {
    setLocalStorageItem(PROJECT_ORDER_STORAGE_KEY, "newest", ProjectOrderSchema);
    setLocalStorageItem(PROJECT_CUSTOM_ORDER_STORAGE_KEY, [], ProjectCustomOrderSchema);
  });

  it.each([
    { order: "name", custom: [], expected: ["links", "shop"] },
    { order: "custom", custom: ["shop", "links"], expected: ["shop", "links"] },
    { order: "custom", custom: ["links", "shop"], expected: ["links", "shop"] },
  ] as const)(
    "draws the projects in the $order order: $expected",
    ({ order: mode, custom, expected }) => {
      setLocalStorageItem(PROJECT_ORDER_STORAGE_KEY, mode, ProjectOrderSchema);
      setLocalStorageItem(PROJECT_CUSTOM_ORDER_STORAGE_KEY, [...custom], ProjectCustomOrderSchema);
      expect(order(render([LINKS_MATE, SHOP_MATE]))).toEqual(expected);
    },
  );

  it("gives a heading a grip only in the Custom order, named for its project", () => {
    setLocalStorageItem(PROJECT_ORDER_STORAGE_KEY, "name", ProjectOrderSchema);
    expect(render([LINKS_MATE, SHOP_MATE])).not.toContain("sidebar-project-grip");
    setLocalStorageItem(PROJECT_ORDER_STORAGE_KEY, "custom", ProjectOrderSchema);
    const html = render([LINKS_MATE, SHOP_MATE]);
    const grip =
      /<button[^>]*data-zerops-surface="sidebar-project-grip"[^>]*>/u.exec(html)?.[0] ?? "";
    expect(grip).toContain('aria-label="Move Links: drag, or use the arrow keys"');
  });

  // The grip belongs to its heading (the owner, 2026-09-29: "handle out of
  // hover bg"), and it has room there (the owner, of the grip squeezed into
  // the band's rounded start: "it's too squeezed on left"): it stands among
  // the heading's verbs, a 28 px verb before + and ⋯, shown whenever they
  // are — nowhere near the band's corners, and the name keeps the mark edge
  // in either order, so nothing moves when it shows.
  it("stands the grip among the heading's verbs, clear of the band's corners, the name on its edge", () => {
    const band = (selector: string) => STYLESHEET.indexOf(`${selector} {`);
    setLocalStorageItem(PROJECT_ORDER_STORAGE_KEY, "custom", ProjectOrderSchema);
    const html = render([LINKS_MATE, SHOP_MATE]);
    const heading = html.slice(
      html.indexOf('data-zerops-surface="sidebar-project"'),
      html.indexOf('data-zerops-surface="sidebar-project-add-mate"'),
    );
    const at = (needle: string) => html.indexOf(needle);
    const grip =
      /<button[^>]*class="([^"]*)"[^>]*data-zerops-surface="sidebar-project-grip"/u
        .exec(html)?.[1]
        ?.split(" ") ?? [];
    // After the title and the room the title leaves, first of the verbs.
    expect(at("sidebar-project-grip")).toBeGreaterThan(at("sidebar-project-toggle"));
    expect(at("sidebar-project-grip")).toBeGreaterThan(
      at('<span aria-hidden="true" class="min-w-0 flex-1"></span>'),
    );
    expect(at("sidebar-project-add-mate")).toBeGreaterThan(at("sidebar-project-grip"));
    expect(heading).toContain("sidebar-project-grip");
    // A verb's size and corners, in the flow: no gutter, no reach of the band.
    expect(grip).toEqual(expect.arrayContaining(["size-7", "rounded-md", "cursor-grab"]));
    expect(grip.some((name) => /^(absolute|-?start-)/u.test(name))).toBe(false);
    expect(band(".zerops-project-heading:has([data-zerops-grip])::before")).toBe(-1);
    // The name on the mark edge, 6 px inside the band, grip or none.
    expect(
      /<div class="([^"]*)"[^>]*data-zerops-surface="sidebar-project"/u.exec(html)?.[1],
    ).toContain("ps-1.5");
  });

  // The heading's toggle covers the whole heading (`after:inset-0`): every
  // control on it stands above that, the grip too, or its right half folds
  // the project instead of dragging it.
  it.each(["sidebar-project-grip", "sidebar-project-add-mate", "sidebar-project-more"])(
    "stands %s above the heading's own press",
    (surface) => {
      setLocalStorageItem(PROJECT_ORDER_STORAGE_KEY, "custom", ProjectOrderSchema);
      const html = render([LINKS_MATE, SHOP_MATE]);
      const control =
        new RegExp(`<button[^>]*data-zerops-surface="${surface}"[^>]*>`, "u").exec(html)?.[0] ?? "";
      const layer = /class="([^"]*)"/u.exec(control)?.[1]?.split(" ") ?? [];
      // Its own layer, or the verbs' slot it stands in.
      const slot = html.slice(0, html.indexOf(control)).lastIndexOf("relative z-1");
      expect(layer.includes("z-1") || slot > html.lastIndexOf("<div", html.indexOf(control))).toBe(
        true,
      );
    },
  );

  it("moves a project with the grip's arrow keys, writing the order on screen with it moved", () => {
    setLocalStorageItem(PROJECT_ORDER_STORAGE_KEY, "custom", ProjectOrderSchema);
    setLocalStorageItem(
      PROJECT_CUSTOM_ORDER_STORAGE_KEY,
      ["links", "shop"],
      ProjectCustomOrderSchema,
    );
    vi.stubGlobal("requestAnimationFrame", () => 0);
    const mounted = mount(
      <SidebarZeropsTree
        candidates={[LINKS_MATE, SHOP_MATE]}
        complete
        onBrowseProjects={() => {}}
        onSelect={() => {}}
      />,
    );
    const grips = mounted.root.findAll(
      (node) =>
        typeof node.type === "string" &&
        node.props["data-zerops-surface"] === "sidebar-project-grip",
    );
    act(() => {
      grips[1]!.props.onKeyDown({ key: "ArrowUp", preventDefault: () => {} });
    });
    expect(getLocalStorageItem(PROJECT_CUSTOM_ORDER_STORAGE_KEY, ProjectCustomOrderSchema)).toEqual(
      ["shop", "links"],
    );
    const spoken = mounted.root.find(
      (node) => typeof node.type === "string" && node.props.role === "status",
    );
    expect(text(spoken)).toBe("Shop moved to 1 of 2.");
  });
});

describe("a Mate's row says more without words", () => {
  const SIGNED_IN = {
    ...CRM_DEV_CONNECTED,
    project: {
      ...CRM_DEV_CONNECTED.project,
      hq: recorded(CRM_DEV_CONNECTED.project.hq!, signedBy(SIGNER)),
    },
  } as ZeropsCandidate;
  const live = (overrides: Partial<ZeropsAgentActivity> = {}): ZeropsAgentActivity => ({
    threadId: "thread-1" as ZeropsAgentActivity["threadId"],
    kind: "idle",
    status: null,
    face: "idle",
    subject: "Add a /status page with the build number",
    at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    snippet: "The handler reads the build number from the environment.",
    unread: false,
    pausedUntil: undefined,
    threadKey: "env-crm-dev:thread-1",
    task: undefined,
    ...overrides,
  });
  const row = (activity: ZeropsAgentActivity, props: Record<string, unknown> = {}) =>
    render([CRM_DEV_CONNECTED], { getActivity: () => activity, ...props });
  const working = (overrides: Partial<ZeropsAgentActivity> = {}) =>
    live({
      kind: "working",
      face: "working",
      subject: "Run the build",
      at: new Date(Date.now() - 192_000).toISOString(),
      ...overrides,
    });
  const slot = (html: string) =>
    /<span[^>]*data-zerops-surface="sidebar-mate-time"[^>]*>(?:<span[^>]*><\/span>)?(.*?)<\/span>/u.exec(
      html,
    )?.[0] ?? "";

  // The working face turns and glances, and its step is the row's third
  // line: no ring around it repeats the step as a count in blue (S3).
  it("rings no working face", () => {
    expect(row(working())).not.toContain("plan-ring");
  });

  // A running clock is not something to click, so it is not blue (S3): it
  // counts up in ink where the age was.
  it("counts up how long it has been working, where its age was", () => {
    const time = slot(row(working()));
    expect(time).toContain("3:12");
    expect(slot(row(live()))).toContain(">2h<");
  });

  // Work left running in the background wears the working face and offers
  // Stop: its slot counts it up as any working face's does, never a grey age
  // beside a working face (the approved menu; the 2026-09-28 audit's gap).
  it("counts up work left running in the background, as it counts a run", () => {
    const time = slot(row(working({ kind: "monitoring" })));
    expect(time).toContain("3:12");
  });

  it.each([
    { case: "while it works on them", activity: working({ snippet: undefined }) },
    {
      case: "in the second after they were asked, before its run starts",
      activity: live({ snippet: undefined, awaitingWords: true }),
    },
  ])("keeps its last line for words still to come $case", ({ activity }) => {
    const html = row(activity);
    expect(html).toContain('data-zerops-surface="sidebar-mate-pending"');
    expect(html).toContain("Working on a reply");
    expect(html).not.toContain("sidebar-mate-snippet");
  });

  // A row is as tall as what it has to say, on one leading: the name's 20 px
  // line, 18 px for each line under it, 10 px of air above and below. The
  // face stands on the name's line, so a shorter row still starts the same
  // way (M6); while words are coming, their line is held by the dots.
  it.each([
    {
      case: "asked and answered",
      activity: live(),
      lines: ["sidebar-mate-name", "sidebar-mate-subject", "sidebar-mate-snippet"],
      height: 76,
    },
    {
      case: "asked, with no answer",
      activity: live({ snippet: undefined }),
      lines: ["sidebar-mate-name", "sidebar-mate-subject"],
      height: 58,
    },
    {
      case: "asked, its answer on its way",
      activity: live({ snippet: undefined, awaitingWords: true }),
      lines: ["sidebar-mate-name", "sidebar-mate-subject", "sidebar-mate-pending"],
      height: 76,
    },
    {
      case: "never asked anything",
      activity: live({ subject: undefined, snippet: undefined }),
      lines: ["sidebar-mate-name"],
      height: 48,
    },
  ])("draws as many lines as it has to say: $case", ({ activity, lines, height }) => {
    const html = row(activity);
    const drawn = [
      "sidebar-mate-name",
      "sidebar-mate-subject",
      "sidebar-mate-snippet",
      "sidebar-mate-pending",
    ].filter((name) => html.includes(`data-zerops-surface="${name}"`));
    expect(drawn).toEqual(lines);
    // The face (28 px) is taller than one line, so a one-line row is the face's.
    const tall = Math.max(28, 20 + 18 * (drawn.length - 1));
    expect(tall + 20).toBe(height);
  });

  it.each([
    {
      case: "a working Mate whose step is relayed",
      activity: working({ liveStep: { words: "Compile the gallery" } }),
    },
    { case: "a resting Mate with no last words", activity: live({ snippet: undefined }) },
    {
      case: "a working Mate nobody has asked anything",
      activity: working({ subject: undefined, snippet: undefined }),
    },
  ])("draws no waiting line on $case", ({ activity }) => {
    expect(row(activity)).not.toContain("sidebar-mate-pending");
  });

  it("sleeps through a usage limit, and says in the time slot when it picks up", () => {
    const resets = new Date(2026, 8, 27, 14, 20).toISOString();
    const html = row(live({ face: "sleep", pausedUntil: resets }), { timestampFormat: "24-hour" });
    expect(html).toContain('data-mate-face-state="sleep"');
    const time = slot(html);
    expect(time).toContain('data-zerops-surface="sidebar-mate-paused"');
    expect(time).toContain(">14:20<");
    expect(time).not.toContain(">2h<");
  });

  it("sets an unread Mate's name at 600, and keeps what was asked in its one ink either way", () => {
    const name = (html: string) =>
      /<span class="([^"]*)"[^>]*data-zerops-surface="sidebar-mate-name"/u.exec(html)?.[1] ?? "";
    const subject = (html: string) =>
      /<span class="([^"]*)"[^>]*data-zerops-surface="sidebar-mate-subject"/u.exec(html)?.[1] ?? "";
    const unread = row(live({ unread: true }));
    expect(name(unread)).toContain("font-semibold");
    expect(subject(unread)).toContain("menu-ink-2");
    const read = row(live());
    expect(name(read)).toContain("font-medium");
    expect(name(read)).not.toContain("font-semibold");
    expect(subject(read)).toBe(subject(unread));
  });

  // The plan's table (M7), as the row draws it: a dot, the face and the
  // third line say the state, and no word does.
  it.each([
    {
      case: "idle, seen",
      activity: live(),
      face: "idle",
      dot: undefined,
      third: 'data-zerops-reply-tone="muted"',
    },
    {
      case: "working, its step relayed",
      activity: working({ liveStep: { words: "Compile the gallery" } }),
      face: "working",
      dot: undefined,
      third: 'data-zerops-surface="sidebar-mate-live-step"',
    },
    {
      case: "needs you",
      activity: live({ kind: "input", face: "needs", question: "Pricing in CZK or EUR?" }),
      face: "needs",
      dot: "attention",
      third: 'data-zerops-reply-tone="ink"',
    },
    {
      case: "finished, not seen",
      activity: live({ kind: "done", face: "done", unread: true }),
      face: "done",
      dot: "unread",
      third: 'data-zerops-reply-tone="ink-2"',
    },
    {
      case: "stopped on an error",
      activity: live({ kind: "failed", face: "needs", errorLine: "The type check failed" }),
      face: "idle",
      dot: "failed",
      third: 'data-zerops-reply-tone="failed"',
    },
  ])("draws $case", ({ activity, face, dot, third }) => {
    // The viewer's own Mate: what it waits on waits on them.
    session.viewer = "u-ada";
    signerOf.set(SIGNED_IN.project.id, SIGNER);
    const html = render([SIGNED_IN], { getActivity: () => activity });
    expect(html).toContain(`data-mate-face-state="${face}"`);
    if (dot === undefined) expect(html).not.toContain("sidebar-mate-dot");
    else
      expect(html).toMatch(
        new RegExp(`data-tone="${dot}" data-zerops-surface="sidebar-mate-dot"`, "u"),
      );
    expect(html).toContain(third);
    for (const word of ["Idle", "Working", "Needs you", "Done", "Failed", "Unread"]) {
      expect(html).not.toContain(`>${word}<`);
    }
  });

  // T6: a run that finishes out of sight pops the face and scales the blue
  // dot in — once, as it arrives; a menu opened onto an unread Mate shows it
  // there, still.
  it("scales a dot in as it arrives while watched, never on the first paint", () => {
    const tree = (activity: ZeropsAgentActivity) => (
      <SidebarZeropsTree
        candidates={[CRM_DEV_CONNECTED]}
        complete
        getActivity={() => activity}
        onBrowseProjects={() => {}}
        onSelect={() => {}}
      />
    );
    const dot = (mounted: ReactTestRenderer) =>
      mounted.root.find(
        (node) =>
          typeof node.type === "string" && node.props["data-zerops-surface"] === "sidebar-mate-dot",
      );
    const opened = mount(tree(live({ kind: "done", face: "done", unread: true })));
    expect(dot(opened).props["data-arrived"]).toBeUndefined();

    const watched = mount(tree(working()));
    act(() => {
      watched.update(tree(live({ kind: "done", face: "done", unread: true })));
    });
    expect(dot(watched).props["data-tone"]).toBe("unread");
    expect(dot(watched).props["data-arrived"]).toBe("");
  });

  // A new step rises into its line as the sweep keeps running over its words:
  // the two are separate animations, so each stands on its own element — on
  // one, the sweep's took the rise's place and a new step never rose.
  it.each([
    { case: "the step the menu opened onto", next: undefined, rises: false },
    { case: "a new step while watched", next: "Deploy to stage", rises: true },
  ])("sweeps the words and rises the line apart: $case", ({ next, rises }) => {
    const tree = (words: string) => (
      <SidebarZeropsTree
        candidates={[CRM_DEV_CONNECTED]}
        complete
        getActivity={() => working({ liveStep: { words } })}
        onBrowseProjects={() => {}}
        onSelect={() => {}}
      />
    );
    const mounted = mount(tree("Compile the gallery"));
    if (next !== undefined) {
      act(() => {
        mounted.update(tree(next));
      });
    }
    const line = mounted.root.find(
      (node) =>
        typeof node.type === "string" &&
        node.props["data-zerops-surface"] === "sidebar-mate-live-step",
    );
    expect(String(line.props.className).includes("animate-words-in")).toBe(rises);
    expect(line.props["data-run-shimmer"]).toBeUndefined();
    const words = line.findAll(
      (node) => typeof node.type === "string" && node.props["data-run-shimmer"] === "",
    );
    expect(words).toHaveLength(1);
  });

  describe("an unsent draft", () => {
    const ref = scopeThreadRef(EnvironmentId.make("env-crm-dev"), ThreadId.make("thread-1"));
    const NEW_CHAT = DraftId.make("draft-crm-dev");
    afterEach(() => {
      useComposerDraftStore.getState().setPrompt(ref, "");
      useComposerDraftStore.getState().clearDraftThread(NEW_CHAT);
    });
    const drawn = (activity: ZeropsAgentActivity | undefined, read = true) =>
      mount(
        <SidebarZeropsTree
          candidates={[SIGNED_IN]}
          complete
          getActivity={() => activity}
          getConversationsRead={() => read}
          onBrowseProjects={() => {}}
          onSelect={() => {}}
        />,
      );
    const said = (tree: ReactTestRenderer, name: string) =>
      tree.root.findAll(
        (node) => typeof node.type === "string" && node.props["data-zerops-surface"] === name,
      );

    // Mounted, not drawn once: a store read on the server answers with its
    // first state, never the draft written since.
    it.each([
      { case: "answered", activity: () => live(), last: "sidebar-mate-snippet" },
      {
        case: "working",
        activity: () => working({ snippet: undefined }),
        last: "sidebar-mate-pending",
      },
      {
        case: "waiting on a question",
        activity: () => live({ face: "needs", question: "Which port?" }),
        last: "sidebar-mate-snippet",
      },
    ])(
      "stands in the person's line, the Mate's line under it kept: $case",
      ({ activity, last }) => {
        useComposerDraftStore.getState().setPrompt(ref, "also check the thumbnails");
        const tree = drawn(activity());
        expect(text(surface(tree, "sidebar-mate-draft"))).toBe("Draft: also check the thumbnails");
        expect(said(tree, "sidebar-mate-subject")).toHaveLength(0);
        expect(said(tree, last)).toHaveLength(1);
      },
    );

    it("gives the line back to the ask once it is cleared", () => {
      useComposerDraftStore.getState().setPrompt(ref, "also check the thumbnails");
      const tree = drawn(live());
      act(() => {
        useComposerDraftStore.getState().setPrompt(ref, "  ");
      });
      expect(said(tree, "sidebar-mate-draft")).toHaveLength(0);
      expect(text(surface(tree, "sidebar-mate-subject"))).toBe(
        "Add a /status page with the build number",
      );
    });

    it("shows a new conversation's draft on a Mate nobody has asked anything", () => {
      const store = useComposerDraftStore.getState();
      store.setProjectDraftThreadId(
        scopeProjectRef(EnvironmentId.make("env-crm-dev"), ProjectId.make("project-crm")),
        NEW_CHAT,
        { threadId: ThreadId.make("thread-new"), createdAt: new Date().toISOString() },
      );
      store.setPrompt(NEW_CHAT, "set up a staging");
      const tree = drawn(undefined);
      expect(text(surface(tree, "sidebar-mate-draft"))).toBe("Draft: set up a staging");
      expect(said(tree, "sidebar-mate-nothing-asked")).toHaveLength(0);
    });
  });

  it.each([
    { case: "its conversations read", read: true, says: ["Nothing asked yet"] },
    { case: "its conversations not read yet", read: false, says: [] },
  ])("says nothing was asked of a Mate nobody has spoken to: $case", ({ read, says }) => {
    const html = render([SIGNED_IN], {
      getActivity: () => undefined,
      getConversationsRead: () => read,
    });
    const found = [
      ...html.matchAll(
        /<span[^>]*data-zerops-surface="sidebar-mate-nothing-asked"[^>]*>([^<]*)<\/span>/gu,
      ),
    ].map((match) => match[1]);
    expect(found).toEqual(says);
  });
});

describe("a Mate's own menu, in its row", () => {
  const ACTIONS: MateRowActions = { muted: false, entries: [] };
  const spoken: ZeropsAgentActivity = {
    threadId: "thread-1" as ZeropsAgentActivity["threadId"],
    kind: "idle",
    status: null,
    face: "idle",
    subject: "Add a /status page",
    at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    snippet: undefined,
    unread: false,
    pausedUntil: undefined,
    threadKey: "env:thread",
    task: undefined,
  };
  const row = (actions: MateRowActions | undefined) =>
    render([CRM_DEV_CONNECTED], {
      getActivity: () => spoken,
      ...(actions === undefined ? {} : { getMateActions: () => actions }),
    });

  it("gives the time slot to the menu on hover and focus, in a slot reserved so nothing moves", () => {
    const html = row(ACTIONS);
    const actions =
      /<span class="([^"]*)"[^>]*data-zerops-surface="sidebar-mate-actions"/u.exec(html)?.[1] ?? "";
    expect(actions).toContain("absolute");
    expect(actions).toContain("opacity-0");
    expect(actions).toContain("group-hover/mate:opacity-100");
    expect(actions).toContain("group-has-[:focus-visible]/mate:opacity-100");
    // The time stands in a slot at least the menu's width, and steps aside.
    const slotClass = /<span class="([^"]*min-w-11[^"]*)"/u.exec(html)?.[1] ?? "";
    expect(slotClass).toContain("min-w-11");
    expect(slotClass).toContain("group-hover/mate:opacity-0");
    expect(html).toContain('aria-label="More for crm-dev"');
  });

  it("gives a working Mate's time slot a stop, beside its menu", () => {
    expect(row({ ...ACTIONS, stop: () => {} })).toContain(
      'data-zerops-surface="sidebar-mate-stop"',
    );
    expect(row({ ...ACTIONS, stop: () => {} })).toContain('aria-label="Stop crm-dev"');
    expect(row(ACTIONS)).not.toContain("sidebar-mate-stop");
  });

  // Two presses stop a run from its row (the owner, 2026-10-01: "this has confirm, right?"):
  // the ■ arms it — a red "Stop?" in its place, named for the confirm — and only that stops.
  it("stops a run on the second press of its row's stop, never the first", () => {
    const stop = vi.fn();
    const tree = mount(
      <SidebarZeropsTree
        candidates={[CRM_DEV_CONNECTED]}
        complete
        getActivity={() => spoken}
        getMateActions={() => ({ ...ACTIONS, stop })}
        onBrowseProjects={() => {}}
        onSelect={() => {}}
      />,
    );
    press(tree, "sidebar-mate-stop");
    expect(stop).not.toHaveBeenCalled();
    const armed = surface(tree, "sidebar-mate-stop");
    expect(armed.props["aria-label"]).toBe("Confirm stop crm-dev");
    expect(text(armed)).toContain("Stop?");
    press(tree, "sidebar-mate-stop");
    expect(stop).toHaveBeenCalledTimes(1);
    expect(surface(tree, "sidebar-mate-stop").props["aria-label"]).toBe("Stop crm-dev");
  });

  it("lets an armed stop go on Esc, and x on the row arms before it stops", () => {
    const stop = vi.fn();
    const tree = mount(
      <SidebarZeropsTree
        candidates={[CRM_DEV_CONNECTED]}
        complete
        getActivity={() => spoken}
        getMateActions={() => ({ ...ACTIONS, stop })}
        onBrowseProjects={() => {}}
        onSelect={() => {}}
      />,
    );
    const key = (value: string) =>
      act(() => {
        surface(tree, "sidebar-mate").props.onKeyDown({
          key: value,
          metaKey: false,
          ctrlKey: false,
          altKey: false,
          shiftKey: false,
          preventDefault: () => {},
          currentTarget: {},
        });
      });
    key("x");
    expect(stop).not.toHaveBeenCalled();
    expect(surface(tree, "sidebar-mate-stop").props["aria-label"]).toBe("Confirm stop crm-dev");
    // Esc bubbles from the row's button to the row, which lets the stop go.
    act(() => {
      tree.root
        .find(
          (node) =>
            typeof node.type === "string" && node.props["data-zerops-mate-row"] !== undefined,
        )
        .props.onKeyDown({ key: "Escape", preventDefault: () => {} });
    });
    expect(surface(tree, "sidebar-mate-stop").props["aria-label"]).toBe("Stop crm-dev");
    key("x");
    key("x");
    expect(stop).toHaveBeenCalledTimes(1);
  });

  // A tap fires pointerleave before its click: the second tap on "Stop?" must still stop, and
  // Esc lets an armed stop go wherever in the row the focus stands.
  it("stops on a second tap, and lets go on Esc from the Stop? itself", () => {
    const stop = vi.fn();
    const tree = mount(
      <SidebarZeropsTree
        candidates={[CRM_DEV_CONNECTED]}
        complete
        getActivity={() => spoken}
        getMateActions={() => ({ ...ACTIONS, stop })}
        onBrowseProjects={() => {}}
        onSelect={() => {}}
      />,
    );
    const container = () =>
      tree.root.find(
        (node) => typeof node.type === "string" && node.props["data-zerops-mate-row"] !== undefined,
      );
    const tap = () => {
      act(() => {
        container().props.onPointerLeave({ pointerType: "touch" });
      });
      press(tree, "sidebar-mate-stop");
    };
    tap();
    expect(surface(tree, "sidebar-mate-stop").props["aria-label"]).toBe("Confirm stop crm-dev");
    act(() => {
      container().props.onKeyDown({ key: "Escape", preventDefault: () => {} });
    });
    expect(surface(tree, "sidebar-mate-stop").props["aria-label"]).toBe("Stop crm-dev");
    tap();
    tap();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("carries no menu where nobody supplied its verbs", () => {
    expect(row(undefined)).not.toContain("sidebar-mate-actions");
  });

  it("follows a muted Mate's name with a crossed bell, and nothing for one that rings", () => {
    expect(row({ ...ACTIONS, muted: true })).toContain('data-zerops-surface="sidebar-mate-muted"');
    expect(row(ACTIONS)).not.toContain("sidebar-mate-muted");
  });

  it("opens the same menu under a finger held on the row, and the lift does not open the Mate", () => {
    vi.useFakeTimers();
    const onSelect = vi.fn();
    const mounted = mount(
      <SidebarZeropsTree
        candidates={[CRM_DEV_CONNECTED]}
        complete
        getActivity={() => spoken}
        getMateActions={() => ACTIONS}
        onBrowseProjects={() => {}}
        onSelect={onSelect}
      />,
    );
    act(() => {
      surface(mounted, "sidebar-mate-row").props.onPointerDown({ pointerType: "touch" });
    });
    act(() => {
      vi.advanceTimersByTime(480);
    });
    expect(mounted.root.findByType(MateMenu).props.open).toBe(true);
    act(() => {
      surface(mounted, "sidebar-mate").props.onClick();
    });
    expect(onSelect).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("opens the same menu at the pointer on a right-click", () => {
    const mounted = mount(
      <SidebarZeropsTree
        candidates={[CRM_DEV_CONNECTED]}
        complete
        getActivity={() => spoken}
        getMateActions={() => ACTIONS}
        onBrowseProjects={() => {}}
        onSelect={() => {}}
      />,
    );
    expect(mounted.root.findByType(MateMenu).props.open).toBe(false);
    act(() => {
      surface(mounted, "sidebar-mate-row").props.onContextMenu({
        preventDefault: () => {},
        clientX: 120,
        clientY: 340,
      });
    });
    const menu = mounted.root.findByType(MateMenu);
    expect(menu.props.open).toBe(true);
    expect(menu.props.at).toEqual({ x: 120, y: 340 });
  });
});

// The owner, 2026-09-29: "allow setting up crew from more menu in the left
// col". Only on the viewer's own Mate with crew mode on — a crew's turns run
// only as the person who signed its agent in.
describe("a Mate's own menu opens its crew, or sets one up", () => {
  const ACTIONS: MateRowActions = { muted: false, entries: [] };
  const MINE: ZeropsMateOwner = {
    name: "Petra Malá",
    initials: "PM",
    avatarUrl: null,
    isViewer: true,
  };
  const COLLEAGUES: ZeropsMateOwner = {
    name: "Jan Beneš",
    initials: "JB",
    avatarUrl: null,
    isViewer: false,
  };
  const crew = (status: "none" | "applied"): SidebarCrewRead => ({
    status,
    crew: status === "none" ? null : crewDigestOf(crewSnapshotFixture({ status })),
    logins: {},
  });
  const drawn = (options: {
    readonly crew: SidebarCrewRead | undefined;
    readonly owner: ZeropsMateOwner | undefined;
    readonly onOpenCrew?: (candidate: ZeropsCandidate, setUp: boolean) => void;
  }) =>
    mount(
      <SidebarZeropsTree
        candidates={[CRM_DEV_CONNECTED]}
        complete
        getCrew={() => options.crew}
        getMateActions={() => ACTIONS}
        getOwner={() => options.owner}
        onBrowseProjects={() => {}}
        onOpenCrew={options.onOpenCrew ?? (() => {})}
        onSelect={() => {}}
      />,
    );

  it.each([
    { case: "crew mode not read", crew: undefined, owner: MINE, label: undefined },
    {
      case: "crew mode off",
      crew: { ...crew("none"), status: "off" },
      owner: MINE,
      label: undefined,
    },
    {
      case: "the viewer's own, without a crew",
      crew: crew("none"),
      owner: MINE,
      label: "Set up a crew",
    },
    { case: "the viewer's own, with a crew", crew: crew("applied"), owner: MINE, label: "Crew" },
    {
      case: "a colleague's, without a crew",
      crew: crew("none"),
      owner: COLLEAGUES,
      label: undefined,
    },
    {
      case: "a colleague's, with a crew",
      crew: crew("applied"),
      owner: COLLEAGUES,
      label: undefined,
    },
  ] as const)("$case: $label", ({ crew: read, owner, label }) => {
    const tree = drawn({ crew: read, owner });
    expect(tree.root.findByType(MateMenu).props.crew?.label).toBe(label);
  });

  // HQ says each Mate's crew mode (`OverviewCrew`): the menu needs no socket to the Mate to offer it.
  it.each([
    { case: "crew mode on, no crew yet", status: "none", label: "Set up a crew" },
    { case: "a crew applied", status: "applied", label: "Crew" },
    { case: "crew mode off", status: "off", label: undefined },
  ] as const)("reads the crew of a Mate nobody opened from HQ: $case", ({ status, label }) => {
    hqCrews.set("crm-dev", {
      status,
      crew: status === "applied" ? { status, ...crewDigestOf(crewSnapshotFixture()) } : null,
      logins: {},
      current: true,
      environmentId: undefined,
    });
    const tree = mount(
      <SidebarZeropsTree
        candidates={[CRM_DEV]}
        complete
        getMateActions={() => ACTIONS}
        getOwner={() => MINE}
        onBrowseProjects={() => {}}
        onOpenCrew={() => {}}
        onSelect={() => {}}
      />,
    );
    expect(tree.root.findByType(MateMenu).props.crew?.label).toBe(label);
  });

  it("offers nothing where nobody wired the way in", () => {
    const tree = mount(
      <SidebarZeropsTree
        candidates={[CRM_DEV_CONNECTED]}
        complete
        getCrew={() => crew("applied")}
        getMateActions={() => ACTIONS}
        getOwner={() => MINE}
        onBrowseProjects={() => {}}
        onSelect={() => {}}
      />,
    );
    expect(tree.root.findByType(MateMenu).props.crew).toBeUndefined();
  });

  it.each([
    { case: "sets a crew up where it has none", read: crew("none"), setUp: true },
    { case: "opens the crew where it has one", read: crew("applied"), setUp: false },
  ])("closes the menu and $case", ({ read, setUp }) => {
    const onOpenCrew = vi.fn();
    const tree = drawn({ crew: read, owner: MINE, onOpenCrew });
    act(() => {
      surface(tree, "sidebar-mate-row").props.onContextMenu({
        preventDefault: () => {},
        clientX: 120,
        clientY: 340,
      });
    });
    expect(tree.root.findByType(MateMenu).props.open).toBe(true);
    act(() => {
      tree.root.findByType(MateMenu).props.crew.onSelect();
    });
    expect(onOpenCrew).toHaveBeenCalledExactlyOnceWith(CRM_DEV_CONNECTED, setUp);
    expect(tree.root.findByType(MateMenu).props.open).toBe(false);
  });
});

describe("a long list, kept scannable", () => {
  const QUIET_MATE = {
    ...named("crm-old", "Olga", { tags: ["mate"], hq: AAA("mate", true) }),
    group: "connected",
  } as ZeropsCandidate;
  const act = (overrides: Partial<ZeropsAgentActivity> = {}): ZeropsAgentActivity => ({
    threadId: "thread-1" as ZeropsAgentActivity["threadId"],
    kind: "idle",
    status: null,
    face: "idle",
    subject: "Something",
    at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    snippet: undefined,
    unread: false,
    pausedUntil: undefined,
    threadKey: "env:thread",
    task: undefined,
    ...overrides,
  });
  const fortnight = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const activities = (id: string) =>
    id === "crm-old" ? act({ at: fortnight, subject: "Try a new renderer" }) : act();
  const names = (html: string) =>
    [...html.matchAll(/data-zerops-surface="sidebar-mate-name"[^>]*>([^<]+)</gu)].map(
      (match) => match[1],
    );

  it("folds a Mate untouched for a week behind its count at the end of the Mates", () => {
    const html = render([CRM_DEV_CONNECTED, QUIET_MATE, CRM_STAGE], {
      getActivity: (item: ZeropsCandidate) => activities(item.project.id),
    });
    expect(names(html)).toEqual(["crm-dev"]);
    expect(html).toContain(">1 quiet Mate<");
  });

  it("unfolds the quiet Mates under the fold, which stays where it is", () => {
    const tree = mount(
      <SidebarZeropsTree
        candidates={[CRM_DEV_CONNECTED, QUIET_MATE]}
        complete
        getActivity={(item) => activities(item.project.id)}
        onBrowseProjects={() => {}}
        onSelect={() => {}}
      />,
    );
    press(tree, "sidebar-quiet-mates");
    const rendered = tree.root
      .findAll(
        (node) =>
          typeof node.type === "string" && typeof node.props["data-zerops-surface"] === "string",
      )
      .map((node) => node.props["data-zerops-surface"] as string)
      .filter((name) => name === "sidebar-mate" || name === "sidebar-quiet-mates");
    expect(rendered).toEqual(["sidebar-mate", "sidebar-quiet-mates", "sidebar-mate"]);
    expect(surface(tree, "sidebar-quiet-mates").props["aria-expanded"]).toBe(true);
  });

  it("never folds the Mate whose conversation is open", () => {
    const html = render([CRM_DEV_CONNECTED, QUIET_MATE], {
      getActivity: (item: ZeropsCandidate) => activities(item.project.id),
      activeProjectId: "crm-old",
    });
    expect(names(html)).toEqual(["crm-dev", "Olga"]);
    expect(html).not.toContain("quiet Mate");
  });

  it("lists only the Mates the viewer asked for, and leaves out a project where none remains", () => {
    const LINKS_CONNECTED = { ...LINKS_MATE, group: "connected" } as ZeropsCandidate;
    const html = render([CRM_DEV_CONNECTED, LINKS_CONNECTED], {
      getActivity: () => act(),
      shown: (item: ZeropsCandidate) => item.project.id === "links-dev",
    });
    expect(names(html)).toEqual(["dev"]);
    expect(html).not.toContain('data-zerops-group="aaa"');
  });

  it("stops a working Mate with x pressed twice and marks one read or unread with e, from its row", () => {
    const stop = vi.fn();
    const toggleUnread = vi.fn();
    const tree = mount(
      <SidebarZeropsTree
        candidates={[CRM_DEV_CONNECTED]}
        complete
        getActivity={() => act({ kind: "working", face: "working" })}
        getMateActions={() => ({ muted: false, entries: [], stop, toggleUnread })}
        onBrowseProjects={() => {}}
        onSelect={() => {}}
      />,
    );
    const key = (name: string) => {
      act_(() => {
        surface(tree, "sidebar-mate").props.onKeyDown({
          key: name,
          preventDefault: () => {},
          metaKey: false,
          ctrlKey: false,
          altKey: false,
        });
      });
    };
    key("x");
    expect(stop).not.toHaveBeenCalled();
    key("x");
    key("e");
    expect(stop).toHaveBeenCalledTimes(1);
    expect(toggleUnread).toHaveBeenCalledTimes(1);
  });

  it("shows each Mate's number in its time slot while Option is held", () => {
    const LINKS_CONNECTED = { ...LINKS_MATE, group: "connected" } as ZeropsCandidate;
    const tree = mount(
      <SidebarZeropsTree
        candidates={[CRM_DEV_CONNECTED, LINKS_CONNECTED]}
        complete
        getActivity={() => act()}
        onBrowseProjects={() => {}}
        onSelect={() => {}}
      />,
    );
    const chips = () =>
      tree.root
        .findAll(
          (node) =>
            typeof node.type === "string" &&
            node.props["data-zerops-surface"] === "sidebar-mate-number",
        )
        .map((node) => text(node));
    expect(chips()).toEqual([]);
    act_(() => {
      window.dispatchEvent(Object.assign(new Event("keydown"), { key: "Alt" }));
    });
    expect(chips()).toEqual(["1", "2"]);
    act_(() => {
      window.dispatchEvent(Object.assign(new Event("keyup"), { key: "Alt" }));
    });
    expect(chips()).toEqual([]);
  });
});

describe("a surface's ask to show a Mate", () => {
  const tree = () => (
    <SidebarZeropsTree
      candidates={[CRM_DEV_CONNECTED, CRM_STAGE, CRM_PROD]}
      complete
      onBrowseProjects={() => {}}
      onSelect={() => {}}
    />
  );

  it("opens the Mate's collapsed project and answers the ask once", () => {
    stored.collapsed = new Set(["aaa"]);
    const mounted = mount(tree());
    const mateRows = () =>
      mounted.root.findAll(
        (node) =>
          typeof node.type === "string" && node.props["data-zerops-surface"] === "sidebar-mate",
      );
    expect(mateRows()).toHaveLength(0);
    act(() => {
      useSidebarReveal.getState().reveal({ kind: "mate", projectId: "crm-dev" });
    });
    expect(mateRows()).toHaveLength(1);
    // Answered: a menu drawn again later has nothing left to show.
    expect(useSidebarReveal.getState().revealing).toBeNull();
  });

  it("leaves an ask for a Mate it does not hold standing until one does", () => {
    mount(tree());
    act(() => {
      useSidebarReveal.getState().reveal({ kind: "mate", projectId: "elsewhere" });
    });
    expect(useSidebarReveal.getState().revealing?.target).toEqual({
      kind: "mate",
      projectId: "elsewhere",
    });
    act(() => {
      useSidebarReveal.getState().answerReveal(useSidebarReveal.getState().revealing!.seq);
    });
  });
});

describe("what the jump box finds in the menu", () => {
  const linksFlow = (pullRequests: ReadonlyArray<FlowPullRequest>): SidebarProjectFlow => ({
    pullRequests,
    environments: new Map([
      ["links-stage", { ...stageRow, projectId: "links-stage" }],
      ["links-prod", { ...productionRow, projectId: "links-prod" }],
    ]),
    releaseOffered: false,
    onOpenChange: () => {},
    onOpenStop: () => {},
  });
  const OWN = pull(4, { mateProjectId: "links-dev", title: "Add a search box" });
  const GONE = pull(6, { mateProjectId: "gone-dev", title: "Bump the linter" });
  // Its stops' services read, so the heading draws its chip.
  const tree = (props: Record<string, unknown> = {}) => (
    <SidebarZeropsTree
      candidates={[LINKS_MATE, up(LINKS_STAGE), up(LINKS_PROD)]}
      complete
      getFlow={() => linksFlow([OWN, GONE])}
      onBrowseProjects={() => {}}
      onOpenGroup={() => {}}
      onSelect={() => {}}
      {...props}
    />
  );
  const index = () => useSidebarJump.getState().index;

  afterEach(() => {
    useSidebarJump.setState({ index: null, showable: false });
  });

  it("publishes the menu's Mates, projects, changes and stops, each as its row says it", () => {
    const mounted = mount(tree());
    expect(index()?.mates.map((mate) => [mate.projectId, mate.projectName])).toEqual([
      ["links-dev", "Links"],
    ]);
    expect(
      index()?.projects.map((project) => [project.groupId, project.name, project.mates]),
    ).toEqual([["links", "Links", 1]]);
    expect(
      index()?.changes.map((change) => [
        change.key,
        change.label,
        change.mateProjectId,
        change.whose,
      ]),
    ).toEqual([
      ["appdev#4", "#4 Add a search box", "links-dev", index()?.mates[0]?.name],
      ["appdev#6", "#6 Bump the linter", "gone-dev", "gone-dev"],
    ]);
    expect(index()?.stops.map((stop) => [stop.projectId, stop.title])).toEqual([
      ["links-stage", "stage"],
      ["links-prod", "production"],
    ]);
    act_(() => {
      mounted.unmount();
    });
    // A phone's menu put away: what it held stays findable.
    expect(index()?.mates).toHaveLength(1);
  });

  it("finds a collapsed project's rows too: a jump opens the project", () => {
    stored.collapsed = new Set(["links"]);
    mount(tree());
    expect(index()?.mates).toHaveLength(1);
    expect(index()?.changes).toHaveLength(2);
    expect(index()?.stops).toHaveLength(2);
  });

  it("finds nothing the viewer asked not to see, nor a hidden Mate's changes", () => {
    const THEO = named("links-theo", "Links - theo", { tags: ["mate"], hq: IN_LINKS() });
    const theirs = pull(9, { mateProjectId: "links-theo", title: "Theirs" });
    mount(
      tree({
        candidates: [LINKS_MATE, THEO, up(LINKS_STAGE), up(LINKS_PROD)],
        getFlow: () => linksFlow([OWN, theirs]),
        shown: (item: ZeropsCandidate) => item.project.id !== "links-theo",
      }),
    );
    expect(index()?.mates.map((mate) => mate.projectId)).toEqual(["links-dev"]);
    expect(index()?.changes.map((change) => change.key)).toEqual(["appdev#4"]);
  });

  // A stop is found as its chip — and where the heading draws none, a find
  // would land on nothing, and the focus would jump there once one appears.
  it("finds no stop where the heading draws no chip", () => {
    mount(tree({ candidates: [LINKS_MATE, LINKS_STAGE, LINKS_PROD] }));
    expect(index()?.stops).toEqual([]);
  });

  it("leaves a folded project folded when a jump lands on its chip, and answers the ask", () => {
    stored.collapsed = new Set(["links"]);
    const mounted = mount(tree());
    const mateRows = () =>
      mounted.root.findAll(
        (node) =>
          typeof node.type === "string" && node.props["data-zerops-surface"] === "sidebar-mate",
      );
    act_(() => {
      useSidebarReveal
        .getState()
        .reveal({ kind: "stop", groupId: "links", projectId: "links-prod" });
    });
    expect(mateRows()).toHaveLength(0);
    expect(useSidebarReveal.getState().revealing).toBeNull();
  });

  it("opens a collapsed project a jump shows, and answers the ask once", () => {
    stored.collapsed = new Set(["links"]);
    const mounted = mount(tree());
    const mateRows = () =>
      mounted.root.findAll(
        (node) =>
          typeof node.type === "string" && node.props["data-zerops-surface"] === "sidebar-mate",
      );
    expect(mateRows()).toHaveLength(0);
    act_(() => {
      useSidebarReveal.getState().reveal({ kind: "project", groupId: "links" });
    });
    expect(mateRows()).toHaveLength(1);
    expect(useSidebarReveal.getState().revealing).toBeNull();
  });

  it("opens a Mate's folded changes when a jump lands on one of them", () => {
    const many = [1, 2, 3, 4].map((number) => pull(number, { mateProjectId: "links-dev" }));
    const mounted = mount(tree({ getFlow: () => linksFlow(many) }));
    const changeRows = () =>
      mounted.root.findAll(
        (node) =>
          typeof node.type === "string" &&
          node.props["data-zerops-surface"] === "sidebar-pull-request",
      );
    const folded = changeRows().length;
    expect(folded).toBeLessThan(4);
    act_(() => {
      useSidebarReveal.getState().reveal({
        kind: "change",
        groupId: "links",
        key: "appdev#1",
        mateProjectId: "links-dev",
      });
    });
    expect(changeRows()).toHaveLength(4);
    expect(changeRows().map((row) => row.props["data-zerops-change"])).toContain("appdev#1");
  });
});

describe("before HQ and the forge answer", () => {
  const flowOf = (overrides: Partial<SidebarProjectFlow>): SidebarProjectFlow => ({
    pullRequests: [],
    environments: new Map(),
    releaseOffered: false,
    ...overrides,
  });

  it("draws a Mate whose socket is not open with HQ's last words of it — asleep, offering nothing", () => {
    const html = render([CRM_DEV, CRM_PROD], {
      getActivity: () =>
        restingActivity({
          threadId: ThreadId.make("thread-1"),
          kind: "working",
          status: null,
          face: "working",
          subject: "Add a /status page",
          // An hour ago, never a fixed day: past seven days the Mate folds under "quiet".
          at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
          snippet: "The page reads the build number.",
          unread: false,
          pausedUntil: undefined,
          threadKey: "env-crm-dev:thread-1",
          task: "Add a /status page",
        }),
    });
    expect(html).toContain("Add a /status page");
    expect(html).toContain("The page reads the build number.");
    expect(html).toContain('data-mate-face-state="idle"');
    expect(html).not.toContain('data-zerops-surface="sidebar-mate-stop"');
  });

  it("draws no change row until HQ answers", () => {
    const html = render([CRM_DEV, CRM_PROD], { getFlow: () => flowOf({ changesKnown: false }) });
    expect(html).not.toContain('data-zerops-surface="sidebar-pull-request"');
  });

  it("draws HQ's change rows once it answered", () => {
    const html = render([CRM_DEV, CRM_PROD], {
      getFlow: () => flowOf({ changesKnown: true, pullRequests: [pull(15, { title: "Live" })] }),
    });
    expect(html).toContain("#15 Live");
    expect(html).toContain('data-zerops-surface="sidebar-pull-request-review"');
  });
});

// A Mate its person deleted, until the listing lets it go: its row says so
// where its last line stood, offers nothing, and does not open.
describe("a Mate on its way off Zerops", () => {
  afterEach(() => {
    settleDeletingMates(new Set());
  });
  const REMEMBERED = restingActivity({
    threadId: ThreadId.make("thread-crm"),
    kind: "idle",
    status: null,
    face: "idle",
    subject: "Speed up the photo gallery",
    at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    snippet: "Thumbnails load lazily now.",
    unread: false,
    pausedUntil: undefined,
    threadKey: "env-crm-dev:thread-crm",
    task: "Speed up the photo gallery",
  });
  const ACTIONS: MateRowActions = {
    muted: false,
    toggleMute: () => {},
    copyLink: () => {},
    entries: [{ id: "restart", label: "Restart", onSelect: () => {} }],
  };
  /** The platform's word: `DELETING`, its container already gone from the listing. */
  const deleting = (): ZeropsCandidate => ({
    key: "crm-dev",
    group: "unavailable",
    reason: "project is DELETING",
    project: { ...CRM_DEV.project, status: "DELETING" },
  });
  /** This tab's word: the platform said yes, and the listing still says ACTIVE. */
  const asked = (): ZeropsCandidate => {
    markMateDeleting("crm-dev");
    return { ...CRM_DEV, group: "connected", environmentId: EnvironmentId.make("env-crm-dev") };
  };

  it.each([
    { case: "the platform deleting it", item: deleting },
    { case: "this tab having asked", item: asked },
  ])("says Deleting… where its words stood, asleep, with no time: $case", ({ item }) => {
    const html = render([item()], { getActivity: () => REMEMBERED, getMateActions: () => ACTIONS });
    expect(html).toMatch(
      /<span[^>]*data-zerops-surface="sidebar-mate-deleting"[^>]*>Deleting…<\/span>/u,
    );
    // What was asked stays above the line; the Mate's last words gave it their place.
    expect(html).toContain(">Speed up the photo gallery<");
    expect(html).not.toContain("Thumbnails load lazily now.");
    expect(html).toContain('data-mate-face-state="sleep"');
    expect(html).not.toContain("sidebar-mate-actions");
    expect(html).toMatch(
      /<button[^>]*aria-disabled="true"[^>]*data-zerops-surface="sidebar-mate"/u,
    );
  });

  it("takes the sign-in line's place where nothing was asked, so the row keeps its height", () => {
    const html = render([deleting()], { getOwner: () => undefined });
    expect(html).toContain(">Deleting…<");
    expect(html).not.toContain("sidebar-mate-sign-in");
  });

  it("does not open when pressed", () => {
    const opened: string[] = [];
    const mounted = mount(
      <SidebarZeropsTree
        candidates={[asked()]}
        complete
        onBrowseProjects={() => {}}
        onSelect={(item) => {
          opened.push(item.project.id);
        }}
      />,
    );
    act(() => {
      surface(mounted, "sidebar-mate").props.onClick();
    });
    expect(opened).toEqual([]);
  });

  it("lets it go once a complete listing no longer holds it", () => {
    markMateDeleting("crm-dev");
    settleDeletingMates(new Set(["crm-stage"]));
    const html = render([{ ...CRM_DEV, group: "connected" }]);
    expect(html).not.toContain("sidebar-mate-deleting");
  });
});

// Coming up is its owners' word, never its age (H2): what the platform says it is making says so,
// however long ago its project was made.
describe("the menu's coming-up line reads what the platform makes, never how old the project is", () => {
  const madeAt = (ms: number) => new Date(ms).toISOString();
  const lineWords = (html: string) => {
    const at = html.indexOf('data-zerops-surface="sidebar-project-line"');
    return at === -1
      ? undefined
      : html
          .slice(html.indexOf(">", at) + 1, html.indexOf("</div></div></div>", at))
          .replace(/<[^>]+>/gu, "")
          .trim() || undefined;
  };
  it.each([5, 20, 24 * 60])("made %i min ago, its app being made: coming up", (minutes) => {
    const item = up(CRM_STAGE, "CREATING");
    const stage = {
      ...item,
      project: { ...item.project, created: madeAt(Date.now() - minutes * 60_000) },
    } as ZeropsCandidate;
    expect(lineWords(render([CRM_DEV, stage]))).toBe("Stage coming up · adding the app");
  });
});

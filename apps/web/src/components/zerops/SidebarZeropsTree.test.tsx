import { HQ_SLOW } from "@t3tools/client-runtime/data";
import { hqDrops, graceOver } from "@t3tools/client-runtime/data/fixtures";
import { markupDom } from "../../../test/markupDom";
import {
  buildZeropsGroupTree,
  groupFlow,
  type CanonicalEnvironmentRow as EnvironmentRow,
  type FlowPullRequest,
  type GroupNextStepKind,
  type ZeropsPlacedBirth,
} from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import {
  canonicalHqStructureOf,
  placementsOf,
  placedMenuRows,
  placedNames,
  type HqMate,
  type HqPlacement,
} from "@t3tools/client-runtime/zerops/hq";
import { crewSnapshotFixture } from "@t3tools/client-runtime/zerops/crew/testing/fixtures";
import type { CandidatesNotice } from "@t3tools/client-runtime/zerops/projections";
import { act, act as act_, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RegistryContext } from "@effect/atom-react";
import { AtomRegistry } from "effect/reactivity";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  HqEnvironmentId,
  EnvironmentId,
  ProjectId,
  ThreadId,
  type CrewSnapshot,
  type MateAttention,
} from "@t3tools/contracts";
import type { MateLiveView } from "@t3tools/shared/hqMates";
import type { CrewDigest } from "@t3tools/shared/mateLink";

import { DraftId, useComposerDraftStore } from "~/composerDraftStore";
import { getLocalStorageItem, setLocalStorageItem } from "~/hooks/useLocalStorage";
import { useMatesActivity } from "~/zerops/useZeropsAgentActivity";
import { useMateRowActivity } from "~/zerops/useMenuMateReadings";
import {
  restingActivity,
  threadAgentActivity,
  type ZeropsAgentActivity,
} from "~/zerops/agentActivity";
import { markMateDeleting, settleDeletingMates } from "~/zerops/deletingMates";
import type { ZeropsMateOwner } from "~/zerops/useZeropsMateOwners";
import {
  PROJECT_CUSTOM_ORDER_STORAGE_KEY,
  PROJECT_ORDER_STORAGE_KEY,
  ProjectCustomOrderSchema,
  ProjectOrderSchema,
} from "~/zerops/projectOrderPreference";
import { InventoryContext, type Inventory } from "~/zerops/inventoryContext";
import type { ProjectRef } from "@t3tools/client-runtime/zerops/data";

// The projects a person collapsed and the groups they opened, as storage would hand them back, and
// what the tree last asked it to remember of each.
const stored = vi.hoisted(() => ({
  collapsed: new Set<string>(),
  opened: new Set<string>(),
  written: undefined as ReadonlySet<string> | undefined,
  writtenOpened: undefined as ReadonlySet<string> | undefined,
}));
/** What each stop runs, as the platform says it, for the tests that draw it. */
const stops = vi.hoisted(() => ({ deployments: new Map<string, unknown>() }));
vi.mock("~/zerops/projectFlows", async (original) => ({
  ...(await original<typeof import("~/zerops/projectFlows")>()),
  useStopDeploymentsShown: () => stops.deployments,
}));
vi.mock("~/zerops/collapsedProjects", async (original) => ({
  ...(await original<typeof import("~/zerops/collapsedProjects")>()),
  readCollapsedProjects: () => stored.collapsed,
  writeCollapsedProjects: (collapsed: ReadonlySet<string>) => {
    stored.written = collapsed;
  },
  readOpenedProjects: () => stored.opened,
  writeOpenedProjects: (opened: ReadonlySet<string>) => {
    stored.writtenOpened = opened;
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
const session = vi.hoisted(() => ({
  viewer: undefined as string | undefined,
  role: undefined as string | undefined,
}));
vi.mock("~/zerops/ZeropsSessionProvider", async (original) => ({
  ...(await original<typeof import("~/zerops/ZeropsSessionProvider")>()),
  useZeropsSession: () => ({ status: "signed-in", activeOrganization: { id: "org-1" } }),
  useZeropsSessionOptional: () =>
    session.viewer === undefined
      ? null
      : {
          user: { id: session.viewer },
          activeOrganization: { id: "org", roleCode: session.role, status: "ACTIVE" },
        },
}));
// Whom each Mate waits on, as HQ says it (`waitsOnViewer`): the viewer who signed its agent in.
const signerOf = vi.hoisted(() => new Map<string, string>());
// Who HQ says signed each Mate's agent in (`signers`): nobody, unless a test says whom or that HQ
// has not said.
const hqSigners = vi.hoisted(() => ({ said: true }));
// The Mates HQ names an owner of (`ownerUserId`).
const ownedBy = vi.hoisted(() => new Set<string>());
vi.mock("~/zerops/useZeropsMateOwners", async (original) => ({
  ...(await original<typeof import("~/zerops/useZeropsMateOwners")>()),
  useWaitsOnViewer: () => (projectId: string) =>
    session.viewer !== undefined && signerOf.get(projectId) === session.viewer,
  useHqProjectPerson: (projectId: string) => {
    if (!hqSigners.said) return undefined;
    const signer = signerOf.get(projectId);
    const signers = signer === undefined ? {} : { "claude-code": signer };
    return {
      owned: ownedBy.has(projectId),
      owner: null,
      waitsOnViewer: session.viewer !== undefined && signer === session.viewer,
      signedInNow: signers,
      everSignedIn: signers,
    };
  },
}));
// HQ has heard every Mate here: its overview is live, so its row may speak of a sign-in.
vi.mock("~/zerops/useMenuMateReadings", async (original) => ({
  ...(await original<typeof import("~/zerops/useMenuMateReadings")>()),
  useMateOverviewInHq: () => "live",
}));
afterEach(() => {
  stops.deployments = new Map();
  // A tree left mounted would answer the next test's asks of the one menu.
  for (const tree of mountedTrees.splice(0)) {
    act(() => {
      tree.unmount();
    });
  }
  stored.collapsed = new Set();
  stored.opened = new Set();
  stored.written = undefined;
  stored.writtenOpened = undefined;
  session.viewer = undefined;
  session.role = undefined;
  signerOf.clear();
  hqSigners.said = true;
  ownedBy.clear();
  hqCrews.clear();
  demandedStops.clear();
  vi.unstubAllGlobals();
});
import {
  groupFlowInputOf,
  groupMemberFactsOf,
  type GroupFlowReads,
} from "./projects/projectsView.logic";
import { ReviewContext } from "~/zerops/review";
import { useSidebarJump } from "~/zerops/sidebarJump";
import { useSidebarReveal } from "~/zerops/sidebarReveal";
import { zeropsSessionAtom } from "~/state/zerops";
import { organization, project } from "~/zerops/__fixtures__/platformData";
import type { SidebarCrewRead } from "./crew/SidebarCrewMinis.logic";
import { MateMenu, type MateRowActions } from "./SidebarMateMenu";
import { ProjectReviewMarks } from "./SidebarProjectReview";
import { ProjectSites, type ProjectSitesInput } from "./SidebarProjectSites";
import { SidebarSelectedBand } from "./SidebarSelectedBand";
import { reviewItemByline, type ProjectReviewItem } from "./SidebarProjectReview.logic";
import { SidebarHqStatus, SidebarZeropsTree, type SidebarProjectFlow } from "./SidebarZeropsTree";
import { projectHeadingMenu, type HeadingMenuEntry } from "./SidebarZeropsTree.logic";
import { mountHqNavigation } from "~/zerops/__fixtures__/hqNavigation";
import { useDeleteApplicationDialog } from "~/zerops/deleteApplicationDialog";
import { useProjectFlows } from "~/zerops/projectFlows";
import { AccountDataContext, type AccountData } from "~/zerops/ZeropsAccountData";

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

/** The project's review mark as drawn, where one stands: its opening tag. */
const reviewTagOf = (html: string) =>
  /<span[^>]*data-zerops-surface="sidebar-project-review-mark"[^>]*>/u.exec(html)?.[0];

/** What the project's review mark says to somebody who cannot see it, where it stands. */
const reviewTagLabelOf = (html: string) =>
  /aria-label="([^"]*)"/u.exec(reviewTagOf(html) ?? "")?.[1]?.replaceAll("&#x27;", "'");

/**
 * What waits in a project's Review, each as its popover lists it: its title, then who made it,
 * whose Mate that is, its number, and "in review" where it waits on somebody else.
 */
function reviewsOf(tree: ReactTestRenderer): ReadonlyArray<string> {
  return tree.root
    .findAllByType(ProjectReviewMarks)
    .flatMap((tags) => (tags.props.items as ReadonlyArray<ProjectReviewItem>) ?? [])
    .map((item) => {
      const byline = reviewItemByline(item);
      return byline === "" ? item.title : `${item.title} — ${byline}`;
    });
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
    // A project of one Mate is that Mate's row: the project's name, then the Mate's (the owner,
    // 2026-10-12: "one mate = project would look like a mate named with project and name").
    const nameAt = html.indexOf('data-zerops-surface="sidebar-mate-name"');
    const name = html.slice(nameAt, html.indexOf("</span></span>", nameAt));
    expect(name.indexOf("Beviro CRM")).toBeGreaterThan(-1);
    expect(name.indexOf("· crm-dev")).toBeGreaterThan(name.indexOf("Beviro CRM"));
    expect(html).not.toContain('data-zerops-surface="sidebar-project"');

    expect(html.match(/data-zerops-surface="sidebar-mate"/gu)).toHaveLength(1);
    expect(html).toContain('data-zerops-primitive="mate-face"');
    // The Mate is the heaviest thing in its project, so its face is the
    // card's size, not the 20px a name in a row of text gets.
    expect(html).toContain('data-mate-face-size="32"');
    // The state is the face's: a Mate whose container runs is awake though
    // its socket is not open here yet, and no word says "Ready" or "Idle".
    expect(html).toContain('data-mate-face-state="idle"');
    expect(html).not.toContain(">Ready<");
    expect(html).not.toContain(">Idle<");
    // Lit as its unit, which holds its menu too, so it stays lit while the
    // pointer is on that ("a Mate and its crew, one unit in the menu").
    expect(html).toContain('data-zerops-mate-unit="crm-dev"');
  });

  // The owner, 2026-10-12: "one mate = project would look like a mate named with project and
  // name". Listed, or still being created, the project's one Mate is its row; a press opens it.
  it("draws a project of one Mate as that Mate's row, named for the project and then the Mate", () => {
    const words = (html: string, surfaceName: string) =>
      [...markupDom(html).querySelectorAll(`[data-zerops-surface="${surfaceName}"]`)].map((row) =>
        row.textContent?.replaceAll("\u00a0", " "),
      );
    const listed = render([LINKS_MATE, up(LINKS_STAGE)]);
    expect(listed).not.toContain('data-zerops-surface="sidebar-project"');
    expect(words(listed, "sidebar-mate-name")).toEqual(["Links · dev"]);
    const coming = render([], {
      births: [
        {
          projectId: "todo-dev",
          startedAt: Date.now(),
          placement: { groupId: "todo", groupName: "Todo", kind: "mate", displayName: "Vera" },
        },
      ],
    });
    expect(coming).not.toContain('data-zerops-surface="sidebar-project"');
    expect(
      markupDom(coming)
        .querySelector('[data-zerops-surface="sidebar-mate-coming"]')
        ?.textContent?.replaceAll("\u00a0", " "),
    ).toContain("Todo · Vera");
    const opened: Array<string> = [];
    const mounted = mount(
      <SidebarZeropsTree
        candidates={[LINKS_MATE]}
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
    expect(opened).toEqual(["links-dev"]);
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

    expect(row).toContain('data-zerops-avatar="picture"');
    expect(row).toContain('src="https://cdn/jan.png"');

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
  });

  it("gives an owner without a picture their initial on their own hue, and an unnamed one nothing yet", () => {
    const quiet = { name: "Eva Dvořák", initials: "ED", avatarUrl: null };
    const withInitials = render([CRM_DEV], { getOwner: () => quiet });
    expect(withInitials).toContain('data-zerops-avatar="initials"');
    expect(withInitials).toContain('<span aria-hidden="true">E</span>');

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

  // The owner, 2026-10-11: "continue" with nobody's name on it read like a label, not the
  // person's words. A row says what was asked only where its Mate has not answered.
  it.each([
    { whose: "the viewer's own", owner: { isViewer: true }, by: "You" },
    { whose: "a colleague's", owner: { isViewer: false }, by: "Jan" },
  ])("says who asked what it was last asked: $by, on $whose Mate", ({ owner, by }) => {
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
    const html = render([connected], {
      getActivity: () => idle,
      getOwner: () => ({ name: "Jan Novák", initials: "JN", avatarUrl: null, ...owner }),
    });
    expect(html).toMatch(
      new RegExp(`data-zerops-surface="sidebar-mate-asker"[^>]*>${by}:</span>`, "u"),
    );
    expect(html).toContain("Fix the login redirect");
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

  const READING: CandidatesNotice = {
    region: "placeholder",
    message: { text: "Reading your projects…", afterMs: 400, tone: "quiet" },
    affordance: null,
  };

  it('an unread listing renders its placeholder, never nothing and never "none"', () => {
    const html = render([], { complete: false, notice: READING });

    expect(html).toContain("Reading your projects…");
    expect(html).not.toContain("No Mate yet");
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
    expect(html).not.toContain("No Mate yet");
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

  it("shows a plain project's HQ application without a Mate before and after inventory arrives", () => {
    const structure = canonicalHqStructureOf({
      apps: [
        {
          id: "plain-app",
          name: "Plain Git",
          projects: [{ projectId: "plain-project", name: "Plain Git", kind: "plain", mate: null }],
        },
      ],
    })!;
    for (const projects of [[], [{ id: "plain-project", name: "Plain Git", status: "ACTIVE" }]]) {
      const rows = placedMenuRows({
        organizationId: "org",
        placements: placementsOf(structure),
        names: placedNames(structure),
        projects,
        candidates: [],
        gone: new Set<string>(),
      });
      const dom = markupDom(render(rows, { complete: projects.length > 0 }));
      expect(dom.querySelector('[data-zerops-project-row="plain-app"]')?.textContent).toContain(
        "Plain Git",
      );
      expect(dom.querySelector('[data-zerops-surface="sidebar-project"]')?.textContent).toContain(
        "No Mate yet",
      );
      expect(dom.querySelector('[data-zerops-surface="sidebar-mate"]')).toBeNull();
    }
  });

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
    expect(html).not.toContain("No Mate yet");
  });

  it('never says "No Mate yet" while a project\'s presence is unknown', () => {
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
    expect(html).not.toContain("No Mate yet");
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
  // back on every reconnect): a spinner while HQ's first read catches up, and words — in view,
  // not only in a tooltip — once what HQ said is no longer current, it never answered, or it is
  // slow on a connection that holds (a spinner beside those words, and nothing to try again).
  it.each([
    ["syncing", false, null, false],
    ["syncing", true, null, false],
    ["slow", false, HQ_SLOW, false],
    ["slow", true, HQ_SLOW, false],
    ["last-known", false, "HQ is not reachable since 14:05 — showing what it last said.", false],
    ["last-known", true, "HQ is not reachable since 14:05 — showing what it last said.", true],
    ["unavailable", false, "HQ unavailable", false],
    ["unavailable", true, "HQ unavailable", true],
  ] as const)("the header's HQ standing: %s, a retry offered %s", (kind, offered, words, again) => {
    const line =
      kind === "unavailable"
        ? "HQ unavailable"
        : kind === "slow"
          ? HQ_SLOW
          : "HQ is not reachable since 14:05 — showing what it last said.";
    const html = renderToStaticMarkup(
      <SidebarHqStatus kind={kind} line={line} onAgain={offered ? () => {} : undefined} />,
    );
    expect(html).toContain(line);
    const shown = /<span aria-hidden="true"[^>]*>([^<]+)<\/span>/u.exec(html)?.[1] ?? null;
    expect(shown).toBe(words);
    expect(html.includes("<button")).toBe(again);
  });

  it("the header shows HQ's refusal and next action instead of an unreachable status", () => {
    const line = "HQ refused the renewed session. Try again, or sign in to Zerops again.";
    const html = renderToStaticMarkup(
      <SidebarHqStatus kind="refused" line={line} onAgain={() => {}} />,
    );
    expect(html).toContain(line);
    expect(html).not.toContain("HQ is not reachable");
  });

  // One band in the list lights the open Mate's row and slides to the next
  // one opened (M11): the row itself paints nothing for being open, and
  // lights only under the pointer.
  it("lights the open Mate's row with the list's one band, not a fill of its own", () => {
    const html = render([CRM_DEV], { activeProjectId: "crm-dev" });
    expect(html).toContain('aria-current="true"');
    expect(html.match(/data-zerops-surface="sidebar-selected-band"/gu)).toHaveLength(1);
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
      shows: ["sidebar-environments-empty", "No Mate yet", "Set up Mate"],
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
  id: HqEnvironmentId.make("crm-stage"),
  target: { kind: "zerops", projectId: ProjectId.make("crm-stage") },
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
  id: HqEnvironmentId.make("crm-prod"),
  target: { kind: "zerops", projectId: ProjectId.make("crm-prod") },
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
  const KAREL = { name: "Alex Novák", initials: "AN", avatarUrl: null, isViewer: false };

  // Board D1, 2026-09-30: the person who added a Mate reads that it waits on them, with the amber
  // dot of what needs them; anybody else that it waits for a sign-in — never a failure while it
  // is being set up (2026-10-01) — and no dot: it is not waiting on them.
  it.each([
    {
      case: "the viewer added it",
      viewer: "u-petra",
      says: "Waiting for your sign-in",
      yours: true,
    },
    {
      case: "somebody else added it",
      viewer: "u-karel",
      says: "Waiting for sign-in",
      yours: false,
    },
  ])("says whose sign-in it waits for: $case", ({ viewer, says, yours }) => {
    session.viewer = viewer;
    const html = render([mate({ standupRequestedBy: "u-petra" }, { group: "connected" })], {
      getOwner: () => undefined,
    });
    expect(line(html)?.[1]).toBe(says);
    expect(html.includes('data-zerops-sign-in="yours"')).toBe(yours);
  });

  it.each([
    { case: "no task yet", task: null, says: "No tasks yet" },
    {
      case: "on a task",
      task: {
        id: "t1",
        repo: "acme/tea-shop",
        number: 12,
        title: "Fix the checkout total",
        url: "https://github.com/acme/tea-shop/issues/12",
      },
      // At rest on it: HQ keeps it on its task while the task's change waits for review.
      says: "#12 Fix the checkout total · up for review",
    },
  ])(
    "an automated Mate wears its mark, names its task and never asks for a sign-in: $case",
    ({ task, says }) => {
      session.viewer = "u-petra";
      const html = render(
        [mate({ standupRequestedBy: "u-petra", automated: true, task }, { group: "connected" })],
        { getOwner: () => undefined },
      );
      expect(html).toContain('aria-label="Automated — runs on the organization&#x27;s key"');
      expect(
        /<span[^>]*data-zerops-surface="sidebar-mate-task"[^>]*>([^<]*)<\/span>/u.exec(html)?.[1],
      ).toBe(says);
      expect(line(html)).toBeNull();
      expect(html.includes('data-zerops-sign-in="yours"')).toBe(false);
    },
  );

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

  // Whether a Mate is nobody's is HQ's word (`ownerUserId`), never Zerops' project roles.
  it.each([
    {
      case: "HQ names an owner it sends no person of: a neutral seat",
      owned: true,
      seat: undefined,
    },
    { case: "HQ names no owner: the empty seat", owned: false, seat: "nobody" },
  ])("$case", ({ owned, seat: expected }) => {
    const item = mate(null, { group: "connected" });
    if (owned) ownedBy.add(item.project.id);
    expect(seat(render([item], { getOwner: () => undefined }))).toBe(expected);
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

      expect(html).not.toMatch(/<button[^>]*>Sign in<\/button>/u);
      expect(html).not.toContain("sidebar-mate-sign-in-verb");
    },
  );

  // The owner, 2026-10-06: every row said "Nobody has signed in yet" of Mates in use. The line
  // reads HQ's signers of the project: it stands only where HQ names nobody.
  it.each([
    { case: "HQ names a signer", said: true, signer: "u-eva", shown: false },
    { case: "HQ names nobody", said: true, signer: undefined, shown: true },
    { case: "HQ has not said", said: false, signer: undefined, shown: false },
  ])("says nobody has signed in only where HQ names nobody: $case", ({ said, signer, shown }) => {
    hqSigners.said = said;
    const item = mate(null, { group: "connected" });
    if (signer !== undefined) signerOf.set(item.project.id, signer);
    const html = render([item], { getOwner: () => undefined });
    expect(html.includes("Nobody has signed in yet")).toBe(shown);
  });

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
  // With the listed Mate, the one coming makes Beviro CRM a group: opened, its Mates are drawn.
  beforeEach(() => {
    stored.opened = new Set(["aaa"]);
  });

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

  // Eli, 2026-10-13: its tab reloaded mid-setup, and its row wore the slate in place of its pick.
  it("wears the face picked at its Add after a reload, from its open birth at HQ, before HQ records it", () => {
    const registry = AtomRegistry.make();
    registry.set(zeropsSessionAtom, {
      status: "signed-in",
      organizationStatus: "selected",
      activeOrganization: organization,
    });
    mountHqNavigation(registry, organization.organizationId, {
      structure: {
        apps: [
          {
            id: "aaa",
            name: "Beviro CRM",
            projects: [],
            births: [{ id: "b-1", projectId: "vera-dev", face: "rose:seal" }],
          },
        ],
        ungrouped: [],
      },
    });
    const html = renderToStaticMarkup(
      <RegistryContext.Provider value={registry}>
        <SidebarZeropsTree
          candidates={[
            // Placed by its open birth (`placementsOf`): in its application, no record yet.
            candidate(
              "vera-dev",
              {
                tags: ["mate"],
                hq: {
                  appId: "aaa",
                  appName: "Beviro CRM",
                  kind: "mate",
                  mate: null,
                  unregistered: true,
                },
              },
              "ready",
              false,
            ),
          ]}
          complete
          onBrowseProjects={() => {}}
          onSelect={() => {}}
        />
      </RegistryContext.Provider>,
    );
    expect(
      Object.fromEntries(
        [...html.matchAll(/data-mate-face-(tint|shape)="([a-z]+)"/gu)].map((m) => [m[1], m[2]]),
      ),
    ).toEqual({ tint: "rose", shape: "seal" });
    registry.dispose();
  });

  it("says a creation that stopped in its line, in red", () => {
    const html = render([CRM_DEV], { births: [{ ...birth(), failed: true }] });
    const at = html.indexOf('data-zerops-surface="sidebar-mate-coming"');
    const row = html.slice(html.lastIndexOf("<button", at), html.indexOf("</button>", at));
    expect(row).toContain('data-mate-face-state="sleep"');
    expect(row).toContain(">Setting up stopped<");
    expect(row).toContain('data-zerops-coming-tone="attention"');
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
    expect(html).not.toContain("No Mate yet");
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
      tone: "attention",
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
    // Its project's own verbs stay on its row's ···; none of the Mate's join them.
    expect(html).not.toContain('data-zerops-surface="sidebar-mate-more"');
    expect(html).toContain('data-zerops-surface="sidebar-project-more"');
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
    at: new Date().toISOString(),
    snippet: undefined,
    awaitingWords: true,
    unread: false,
    pausedUntil: undefined,
    threadKey: "env:thread-1",
    task: "Add a size guide to the product page",
  };
  const faceOf = (html: string) =>
    /data-mate-face-state="([a-z]+)"/u.exec(
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
      case: "a running Mate with HQ's recent last word at rest, its socket not open yet",
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
    // Its row says it holds no Mate now, and its Review still holds the change.
    expect(html).toContain("No Mate yet");
    expect(reviewTagLabelOf(html)).toBe("Review Change 7");
    expect(html).not.toContain("No Zerops projects yet");
    registry.dispose();
  });

  // Karel 2026-10-22 (app-lifecycle.md): a project whose Mate was deleted outside Mate cannot ask
  // anyone; its row offers both ways on.
  const MOVES = [
    "Start a Mate",
    "Open project",
    "—",
    "Move up (off)",
    "Move down (off)",
    "—",
  ] as const;
  it.each([
    {
      may: true,
      items: [...MOVES, "All projects", "—", "Delete Beviro CRM…"],
    },
    { may: false, items: [...MOVES, "All projects"] },
  ])(
    "A project without a Mate offers Start a Mate, and its Delete to whoever may delete it (may: $may)",
    ({ may, items }) => {
      const registry = AtomRegistry.make();
      registry.set(zeropsSessionAtom, {
        status: "signed-in",
        organizationStatus: "selected",
        activeOrganization: organization,
      });
      mountHqNavigation(registry, organization.organizationId, {
        structure: {
          can: {
            delete_app: may ? { allow: true } : { allow: false, reason: "not_structure_writer" },
          },
          apps: [
            {
              id: "aaa",
              name: "Beviro CRM",
              projects: [],
              can: { add_mate: { allow: true } },
            },
          ],
          ungrouped: [],
        },
      });
      useDeleteApplicationDialog.getState().close();
      const mounted = mount(
        <RegistryContext.Provider value={registry}>
          <SidebarZeropsTree
            candidates={[CRM_STAGE, CRM_PROD]}
            complete
            onAddMate={() => {}}
            onBrowseProjects={() => {}}
            onSelect={() => {}}
          />
        </RegistryContext.Provider>,
      );
      const menu = mounted.root.findAll(
        (node) => node.props.groupId === "aaa" && Array.isArray(node.props.menu),
      )[0]!.props.menu as ReadonlyArray<HeadingMenuEntry>;
      expect(
        menu.map((entry) =>
          entry.kind === "separator" ? "—" : `${entry.label}${entry.disabled ? " (off)" : ""}`,
        ),
      ).toEqual(items);
      const remove = menu.find(
        (entry) => entry.kind === "item" && entry.label.startsWith("Delete"),
      );
      if (remove?.kind === "item") act(() => remove.act());
      expect(useDeleteApplicationDialog.getState().request?.target).toEqual(
        may
          ? {
              appId: "aaa",
              name: "Beviro CRM",
              stages: [{ projectId: CRM_STAGE.project.id, name: CRM_STAGE.project.name }],
              productions: [{ name: CRM_PROD.project.name }],
            }
          : undefined,
      );
      registry.dispose();
    },
  );

  // Stress run 3 (+16:58.9): a reload painted every project as its "Review" row alone, then the
  // Mates' menu replaced it.
  it("A reload paints no project of change rows alone before its Mates are read", () => {
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
          complete={false}
          reading
          onBrowseProjects={() => {}}
          onSelect={() => {}}
          getFlow={() => ({
            pullRequests: [pull(57, { mateProjectId: "beviro-dev" })],
            environments: new Map(),
            releaseOffered: false,
          })}
        />
      </RegistryContext.Provider>,
    );
    expect(html).not.toContain("Beviro CRM");
    expect(html).not.toContain("#57");
    expect(html).toContain('data-zerops-surface="sidebar-environments-skeleton"');
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
  /** What the project's Review holds, each item as its popover says it. */
  const reviewing = (
    candidates: ReadonlyArray<ZeropsCandidate>,
    state = flow(),
    props: Record<string, unknown> = {},
  ) =>
    reviewsOf(
      mount(
        <SidebarZeropsTree
          candidates={candidates}
          complete
          getFlow={() => state}
          onBrowseProjects={() => {}}
          onSelect={() => {}}
          {...props}
        />,
      ),
    );
  /** The viewer's own Mate: its change waits on them. */
  const own = () => {
    session.viewer = SIGNER;
    return mine(CRM_DEV);
  };

  it("hangs the Mate's open pull requests under it", () => {
    const html = withFlow([own(), CRM_STAGE, CRM_PROD]);
    // On its own row, after its name: the project's review mark; its Review is the conversation
    // header's (2026-10-12).
    expect(reviewTagLabelOf(html)).toBe("Review Change 4");
    expect(html.indexOf('data-zerops-surface="sidebar-mate-name"')).toBeLessThan(
      html.indexOf('data-zerops-surface="sidebar-project-review-mark"'),
    );
    expect(reviewing([own(), CRM_STAGE, CRM_PROD])).toEqual(["Change 4 — crm-dev · #4"]);
    // Nothing here opens a forge, and the verdict lives in the review: no check dot on the row.
    expect(html).not.toContain("gitea.example");
    expect(html).not.toContain('aria-label="Passing"');
  });

  // The one door to merging is the review (R1), and it is the conversation header's (the owner,
  // 2026-10-12: "in the left menu, just add some clear indication without the ability to merge"):
  // every change is marked on its row, and nothing there opens, merges, asks or grades it.
  it("marks every change on its row, and never offers Review, Merge, Ask or a status dot there", () => {
    for (const change of [
      pull(4),
      pull(4, { mergeability: "conflicting" }),
      pull(4, { mergeability: "checking" }),
    ]) {
      const html = withFlow([own(), CRM_STAGE], flow({ pullRequests: [change] }));
      expect(reviewTagLabelOf(html)).toBe("Review Change 4");
      expect(html).not.toContain('data-zerops-surface="sidebar-project-review"');
      expect(html).not.toContain('data-zerops-primary-action="Merge"');
      expect(html).not.toContain('data-zerops-primary-action="Ask"');
      expect(html).not.toContain("sidebar-pull-request-blocked");
      expect(html).not.toContain('data-dot=""');
    }
  });

  // A change asks for review only once its Mate described it at its head: a draft asks nothing —
  // and rides no row.
  it.each([
    { case: "a change described at its head, its Mate at rest", ready: true, busy: false },
    { case: "a draft", ready: false, busy: false },
  ])("puts $case on its Mate's row only once it asks for review", ({ ready, busy }) => {
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
    const html = render([own(), CRM_STAGE], {
      getFlow: () => flow({ pullRequests: [pull(4, { ready })] }),
      ...(busy ? { getActivity: () => atWork } : {}),
    });
    const asks = ready && !busy;
    expect(reviewTagLabelOf(html)).toBe(asks ? "Review Change 4" : undefined);
  });

  // While its Mate works, a described change asks for no review (D7) — but it stays on the row,
  // quieter, so it is always findable (Eli, 2026-10-14: "why is MR not showing up anywhere").
  it("keeps a described change its Mate still works on marked on its row, in progress, offering no Review until it rests", () => {
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
    const html = render([own(), CRM_STAGE], {
      getFlow: () => flow({ pullRequests: [pull(4)] }),
      getActivity: () => atWork,
    });
    expect(reviewTagLabelOf(html)).toBe("In progress: Change 4");
    const rested = render([own(), CRM_STAGE], {
      getFlow: () => flow({ pullRequests: [pull(4)] }),
      getActivity: () => restingActivity(atWork),
    });
    expect(reviewTagLabelOf(rested)).toBe("Review Change 4");
  });

  // The owner, 2026-10-12: "I still don't understand why rosa has a different looking merge
  // request" — a Review solid only on their own Mate's change, nothing saying why.
  it("says a colleague's open change is in review, its Review the same as on the viewer's own", () => {
    const karlos = { name: "Karlos Lee", initials: "KL", avatarUrl: null, isViewer: false };
    expect(
      reviewing([mine(CRM_DEV_CONNECTED, "u-karlos"), CRM_STAGE], flow(), {
        getOwner: () => karlos,
      }),
    ).toEqual(["Change 4 — crm-dev · Karlos's · #4 · in review"]);
    const theirs = render([mine(CRM_DEV_CONNECTED, "u-karlos"), CRM_STAGE], {
      getFlow: () => flow(),
      getOwner: () => karlos,
    });
    const ours = withFlow([own(), CRM_STAGE]);
    // Its Review as drawn, attributes and all.
    expect(reviewTagOf(theirs)).toBeDefined();
    expect(reviewTagOf(theirs)).toEqual(reviewTagOf(ours));
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

  // Production and stage leave the list (M1): the chip on the heading
  // carries them, so no stop is ever a row among the Mates.
  it("draws no row for a stop, and with nothing read no change, dot or verb", () => {
    const html = render([CRM_DEV, CRM_STAGE, CRM_PROD]);
    expect(html).not.toContain('sidebar-environment"');
    expect(html).not.toContain("sidebar-stop");
    expect(html).not.toContain("sidebar-pull-request");
    expect(html).not.toContain("data-dot");
    expect(html).not.toContain("Release");
  });

  it("keeps a missing Mate's open change in its project's Review, by its number", () => {
    const missing = pull(7, { mateProjectId: "gone-mate" });
    const html = withFlow([CRM_DEV, CRM_STAGE], flow({ pullRequests: [missing] }));
    expect(reviewTagLabelOf(html)).toBe("Review Change 7");
    expect(reviewing([CRM_DEV, CRM_STAGE], flow({ pullRequests: [missing] }))).toEqual([
      "Change 7 — #7",
    ]);
    expect(html).not.toContain("sidebar-pull-request");
  });

  it("keeps the recipe change counted by the Overview under its Mate", () => {
    const recipe = flow({ pullRequests: [pull(4, { repository: "group", kind: "recipe" })] });
    expect(reviewTagLabelOf(withFlow([own(), CRM_STAGE], recipe))).toBe("Review Change 4");
    expect(reviewing([own(), CRM_STAGE], recipe)).toEqual(["Change 4 — crm-dev · #4"]);
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

  /**
   * The fixture's crew as its Mate's overview carries it, every crewmate on Ada's Claude Code
   * login: its first ask waiting on the viewer where `waiting`, task 13 ready for their Land
   * where `ready`.
   */
  const waitingCrew = (input: { readonly waiting?: boolean; readonly ready?: boolean }) => {
    const fixture = crewSnapshotFixture();
    return {
      status: "applied",
      crew: {
        ...crewDigestOf(fixture),
        crewmates: crewDigestOf(fixture).crewmates.map((mate) => ({
          ...mate,
          threadKind: "idle" as const,
          loginKey: "claude-code",
        })),
        attention:
          input.waiting === true
            ? fixture.attention.slice(0, 1).map(({ id, kind, handle }) => ({ id, kind, handle }))
            : [],
        readyTasks: input.ready === true ? [{ id: "task-13", owner: "frontend" }] : [],
      },
      logins: { "claude-code": { signedInBy: "ada", present: true, token: false } },
      environmentId: EnvironmentId.make("env-crew"),
    } satisfies SidebarCrewRead;
  };
  const withCrew = (read: SidebarCrewRead) => {
    session.viewer = "ada";
    return mount(
      <SidebarZeropsTree
        candidates={[mine(CRM_DEV_CONNECTED, "ada")]}
        complete
        getCrew={() => read}
        onBrowseProjects={() => {}}
        onSelect={() => {}}
      />,
    );
  };

  // The crew's line under its Mate went into the Mate's own line (2026-10-12): who needs the
  // viewer stands there, in the words' ink, and no Review is offered for an ask.
  it("says who needs you, in the words' second ink, with no Review", () => {
    const tree = withCrew(waitingCrew({ waiting: true }));
    expect(text(surface(tree, "sidebar-mate-crew-need"))).toBe("Erik needs you");
    expect(reviewsOf(tree)).toEqual([]);
  });

  it("offers Review where a task waits for your Land, opening that task's review", () => {
    const tree = withCrew(waitingCrew({ ready: true }));
    expect(reviewsOf(tree)).toEqual(["Frontend's work is ready — Frontend, in crm-dev's crew"]);
    const [item] = tree.root
      .findAllByType(ProjectReviewMarks)
      .flatMap((marks) => marks.props.items as ReadonlyArray<ProjectReviewItem>);
    expect(item?.target).toEqual({
      kind: "crew-task",
      environmentId: EnvironmentId.make("env-crew"),
      taskId: "task-13",
    });
  });
});

// An HQ is open, so its releases are coming — but it has not answered them.
const HQ_OPEN = {
  deployments: new Map<string, unknown>([
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
};

// Production and its stages are the project's places (M2, M1; the owner, 2026-10-12: "the pop
// with open addresses should cover all links in all mates and prod etc"): behind its globe, each
// with its state, and on its row only while one is not calm — the environment tag.
describe("production and the stages are the project's places, behind its globe", () => {
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
  const tree = (candidates: ReadonlyArray<ZeropsCandidate>, props: Record<string, unknown> = {}) =>
    mount(
      <SidebarZeropsTree
        candidates={candidates}
        complete
        onBrowseProjects={() => {}}
        onSelect={() => {}}
        {...props}
      />,
    );
  /** Each place the globe's popover lists: its name, its word and its ink. */
  const placesOf = (mounted: ReactTestRenderer) =>
    mounted.root.findAllByType(ProjectSites).flatMap((sites) => {
      const input = sites.props as ProjectSitesInput;
      return [...(input.production?.(0).stops ?? []), ...(input.stages?.(0).stops ?? [])].map(
        (stop) => ({ name: stop.name, word: stop.word, tone: stop.tone }),
      );
    });
  /** The environment tag on the project's row, where a place is not calm. */
  const envTagOf = (html: string) => {
    const match =
      /<button([^>]*data-zerops-surface="sidebar-project-env-tag"[^>]*)>(.*?)<\/button>/u.exec(
        html,
      );
    if (match === null) return undefined;
    return {
      word: match[2]!.replace(/<[^>]+>/gu, ""),
      tone: /data-tone="([^"]*)"/u.exec(match[1]!)?.[1],
      sentence: /aria-label="([^"]*)"/u.exec(match[1]!)?.[1],
    };
  };
  /** What the jump box finds of each place: the whole state in words, and its dot. */
  const foundStops = () =>
    useSidebarJump
      .getState()
      .index?.stops.map(({ projectId, word, dot }) => ({ projectId, word, dot }));
  /** The release mark's words to somebody who cannot see it, where it stands. */
  const releaseTagOf = (html: string) =>
    /<span[^>]*aria-label="([^"]*)"[^>]*data-zerops-surface="sidebar-project-release-mark"/u.exec(
      html,
    )?.[1];
  /** A second Mate in Beviro CRM: the project becomes a group, folded until its person opens it. */
  const CRM_BO = named("crm-bo", "Bo", { tags: ["mate"], hq: AAA("mate", true) });

  it("never calls production healthy where what a service runs cannot be told", () => {
    const mounted = tree([CRM_DEV, up(CRM_PROD)], {
      getFlow: () =>
        flow({ environments: new Map([["crm-prod", released("v2.4.0")]]), releaseUntold: ["api"] }),
    });
    expect(placesOf(mounted)).toEqual([
      { name: "production", word: "Can't tell what api runs", tone: "muted" },
    ]);
    expect(foundStops()).toEqual([
      { projectId: "crm-prod", word: "Production v2.4.0, can't tell what api runs", dot: "off" },
    ]);
  });

  it("lists the stage and production behind its globe, each with its state", () => {
    const mounted = tree([CRM_DEV, up(CRM_STAGE), up(CRM_PROD)], { getFlow: () => flow() });
    expect(placesOf(mounted)).toEqual([
      { name: "production", word: "Healthy", tone: "muted" },
      { name: "crm-stage", word: "Deployed", tone: "muted" },
    ]);
    const html = render([CRM_DEV, up(CRM_STAGE), up(CRM_PROD)], { getFlow: () => flow() });
    expect(html).toContain('data-zerops-surface="sidebar-project-sites"');
    // No place is a row of the menu, and calm places say nothing on the row.
    expect(html).not.toContain('sidebar-environment"');
    expect(envTagOf(html)).toBeUndefined();
  });

  // HQ declares which project is the stage and which production, and their releases: while its
  // link is paused, what is said of them is what it last said, never current.
  it.each([
    [true, ""],
    [false, "Last known: "],
  ])("with HQ answering %s, its places say %j before their state", (live, prefix) => {
    const registry = AtomRegistry.make();
    registry.set(zeropsSessionAtom, {
      status: "signed-in",
      organizationStatus: "selected",
      activeOrganization: organization,
    });
    mountHqNavigation(registry, organization.organizationId, {
      structure: { apps: [], ungrouped: [] },
      live,
    });
    const mounted = mount(
      <RegistryContext.Provider value={registry}>
        <SidebarZeropsTree
          candidates={[CRM_DEV, up(CRM_STAGE), up(CRM_PROD)]}
          complete
          onBrowseProjects={() => {}}
          onSelect={() => {}}
          getFlow={() => flow()}
        />
      </RegistryContext.Provider>,
    );
    expect(placesOf(mounted).map(({ word }) => word)).toEqual([
      `${prefix}Healthy`,
      `${prefix}Deployed`,
    ]);
    expect(foundStops()?.map(({ word }) => word)).toEqual([
      `${prefix}Stage main, healthy`,
      `${prefix}Production v2.4.0, healthy`,
    ]);
    registry.dispose();
  });

  it("says what waits for production on its Release tag alone: production stays healthy and calm", () => {
    const waiting = flow({
      environments: new Map([["crm-prod", released("v2.4.0")]]),
      releaseOffered: true,
      releaseContents: [
        compared([
          { sha: "a", subject: "Search box" },
          { sha: "b", subject: "Cart badge" },
        ]),
      ],
    });
    const mounted = tree([CRM_DEV, up(CRM_PROD)], { getFlow: () => waiting });
    expect(placesOf(mounted)).toEqual([{ name: "production", word: "Healthy", tone: "muted" }]);
    const html = render([CRM_DEV, up(CRM_PROD)], { getFlow: () => waiting });
    expect(envTagOf(html)).toBeUndefined();
    expect(releaseTagOf(html)).toBe("Release: 2 changes wait for production");
  });

  it.each([
    {
      case: "changes waiting, the release offered: Release, saying what waits",
      flow: {
        releaseOffered: true,
        releaseContents: [
          compared([
            { sha: "a", subject: "Search box" },
            { sha: "b", subject: "Cart badge" },
          ]),
        ],
      },
      release: "Release: 2 changes wait for production",
    },
    {
      case: "changes waiting, the release not offered: no Release",
      flow: {
        releaseContents: [
          compared([
            { sha: "a", subject: "Search box" },
            { sha: "b", subject: "Cart badge" },
          ]),
        ],
      },
      release: undefined,
    },
    { case: "nothing waiting: no Release", flow: {}, release: undefined },
  ])("tags its row with $case", ({ flow: over, release }) => {
    const html = render([CRM_DEV, up(CRM_STAGE), up(CRM_PROD)], { getFlow: () => flow(over) });
    expect(releaseTagOf(html)).toBe(release);
  });

  // The release is the project's, not one Mate's (the owner, 2026-10-18: "it should be accessible
  // from the left menu"): its mark after the project's name opens it; the rest of the row is the
  // row's.
  it("opens what waits for production from its row's release mark, and the row stays unpressed", () => {
    const opened: Array<unknown> = [];
    let selected = 0;
    const mounted = mount(
      <ReviewContext value={(target) => opened.push(target)}>
        <SidebarZeropsTree
          candidates={[CRM_DEV, up(CRM_STAGE), up(CRM_PROD)]}
          complete
          getFlow={() =>
            flow({
              releaseOffered: true,
              releaseContents: [compared([{ sha: "a", subject: "x" }])],
            })
          }
          onBrowseProjects={() => {}}
          onSelect={() => {
            selected += 1;
          }}
        />
      </ReviewContext>,
    );
    const [mark] = mounted.root.findAll(
      (node) =>
        node.props["data-zerops-surface"] === "sidebar-project-release-mark" &&
        typeof node.props["onClick"] === "function",
    );
    expect(mark).toBeDefined();
    let stopped = false;
    act(() => {
      mark!.props["onClick"]({
        currentTarget: {},
        stopPropagation: () => {
          stopped = true;
        },
      });
    });
    expect(opened).toMatchObject([{ kind: "release" }]);
    expect(stopped).toBe(true);
    expect(selected).toBe(0);
  });

  it("wears no environment tag while every place is calm, on a solo row or a folded group", () => {
    expect(envTagOf(render([CRM_DEV, up(CRM_PROD)], { getFlow: () => flow() }))).toBeUndefined();
    const folded = render([CRM_DEV, CRM_BO, up(CRM_PROD)], {
      getFlow: () =>
        flow({
          releaseOffered: true,
          releaseContents: [compared([{ sha: "a", subject: "x" }])],
        }),
    });
    expect(folded).not.toContain("sidebar-project-rows");
    expect(envTagOf(folded)).toBeUndefined();
  });

  it("keeps its tags and its globe on a folded group's row", () => {
    const html = render([CRM_DEV, CRM_BO, up(CRM_STAGE), up(CRM_PROD)], {
      getFlow: () =>
        flow({
          releaseOffered: true,
          releaseContents: [compared([{ sha: "a", subject: "x" }])],
        }),
    });
    expect(html).not.toContain("sidebar-project-rows");
    expect(releaseTagOf(html)).toBe("Release: 1 change waits for production");
    expect(html).toContain('data-zerops-surface="sidebar-project-sites"');
  });

  it("turns prod amber when the newest release did not go through, while the old one serves", () => {
    const failed = flow({
      environments: new Map([["crm-prod", released("v2.4.0")]]),
      releaseFailure: {
        tag: "v2.5.0",
        kind: "deploy-failed",
        at: undefined,
        error: undefined,
        services: ["app"],
      },
    });
    expect(envTagOf(render([CRM_DEV, up(CRM_PROD)], { getFlow: () => failed }))).toEqual({
      word: "Release failed",
      tone: "amber",
      sentence: "Release failed · still runs v2.4.0",
    });
    expect(placesOf(tree([CRM_DEV, up(CRM_PROD)], { getFlow: () => failed }))).toEqual([
      { name: "production", word: "Release failed", tone: "amber" },
    ]);
  });

  it("turns production red at once where the platform marks a service failed, whatever is unread", () => {
    const html = render([CRM_DEV, up(CRM_PROD, "CONTAINER_FAILED")]);
    expect(envTagOf(html)).toEqual({ word: "Down", tone: "red", sentence: "Production is down" });
  });

  it("says a stage in trouble behind its globe alone, production calm", () => {
    const mounted = tree([CRM_DEV, up(CRM_STAGE, "CONTAINER_FAILED"), up(CRM_PROD)], {
      getFlow: () => flow(),
    });
    expect(placesOf(mounted).map((place) => [place.name, place.tone])).toEqual([
      ["production", "muted"],
      ["crm-stage", "red"],
    ]);
  });

  it("lists only the stage behind its globe where there is no production", () => {
    const mounted = tree([CRM_DEV, up(CRM_STAGE)], {
      getFlow: () => flow({ environments: new Map([["crm-stage", stageRow]]) }),
    });
    expect(placesOf(mounted)).toEqual([{ name: "crm-stage", word: "Deployed", tone: "muted" }]);
  });

  it("lists no place behind its globe where there is neither a production nor a stage", () => {
    expect(placesOf(tree([CRM_DEV], { getFlow: () => flow({ environments: new Map() }) }))).toEqual(
      [],
    );
  });

  it("says nothing of production while what decides it is unread", () => {
    // The platform has not said how the stops' services stand.
    const html = render([CRM_DEV, CRM_STAGE, CRM_PROD], { getFlow: () => flow() });
    expect(envTagOf(html)).toBeUndefined();
    const mounted = tree([CRM_DEV, CRM_STAGE, CRM_PROD], { getFlow: () => flow() });
    expect(placesOf(mounted).map(({ name }) => name)).not.toContain("production");
    expect(foundStops()).toEqual([]);
  });

  it("demands its stops from a cold load with nothing remembered, and lists them once they answer", () => {
    const refOf = (projectId: string) =>
      ({ kind: "project", projectId, organization: { kind: "organization" } }) as ProjectRef;
    const inventory = {
      projectRefs: new Map(["crm-stage", "crm-prod"].map((id) => [id, refOf(id)])),
    } as unknown as Inventory;
    const drawn = (candidates: ReadonlyArray<ZeropsCandidate>) => (
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
    // The stops' services are unread and nothing is remembered: the menu holds their demand.
    const mounted = mount(drawn([CRM_DEV, CRM_STAGE, CRM_PROD]));
    expect(foundStops()).toEqual([]);
    expect([...demandedStops].toSorted()).toEqual(["crm-prod", "crm-stage"]);
    act(() => {
      mounted.update(drawn([CRM_DEV, up(CRM_STAGE), up(CRM_PROD)]));
    });
    expect(foundStops()?.map(({ word }) => word)).toEqual([
      "Stage main, healthy",
      "Production v2.4.0, healthy",
    ]);
    expect(placesOf(mounted).map(({ word }) => word)).toEqual(["Healthy", "Deployed"]);
  });

  it("draws what the platform alone says while HQ has not answered the releases", () => {
    stops.deployments = HQ_OPEN.deployments;
    const mounted = tree([CRM_DEV, up(CRM_PROD)]);
    expect(foundStops()?.map(({ word }) => word)).toEqual(["Production v2.4.0, healthy"]);
    expect(placesOf(mounted)).toEqual([{ name: "production", word: "Healthy", tone: "muted" }]);
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

  it("carries its stops behind its project's globe, where a find on one lands", () => {
    tree([CRM_DEV, up(CRM_STAGE), up(CRM_PROD)], { getFlow: () => flow() });
    expect(useSidebarJump.getState().index?.stops.map(({ groupId }) => groupId)).toEqual([
      "aaa",
      "aaa",
    ]);
    const html = render([CRM_DEV, up(CRM_STAGE), up(CRM_PROD)], { getFlow: () => flow() });
    const group = html.slice(html.indexOf('data-zerops-group="aaa"'));
    expect(group).toContain('data-zerops-surface="sidebar-project-sites"');
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
});

// A project of two or more Mates is one row, its Mates folded under it until its person opens it
// (the owner, 2026-10-12: "when more it would be project and it would expand instead of going to
// detail (or expanding and going to detail if only one of the mates is yours)").
describe("a group of Mates folded to its row", () => {
  const CRM_BO = named("crm-bo", "Bo", { tags: ["mate"], hq: AAA("mate", true) });
  const GROUP = [CRM_DEV, CRM_BO, CRM_STAGE, CRM_PROD];
  const tree = (props: Record<string, unknown> = {}) => (
    <SidebarZeropsTree
      candidates={GROUP}
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
  const expanded = (mounted: ReactTestRenderer) =>
    surface(mounted, "sidebar-project").props["aria-expanded"];
  /** What a Mate's chat last said, `kind` and `face` as given, `minutes` ago. */
  const said = (
    id: string,
    kind: ZeropsAgentActivity["kind"],
    face: ZeropsAgentActivity["face"],
    minutes = 0,
    subject = "Something",
  ): ZeropsAgentActivity => ({
    threadId: `thread-${id}` as ZeropsAgentActivity["threadId"],
    kind,
    status: null,
    face,
    subject,
    at: new Date(Date.now() - minutes * 60_000).toISOString(),
    snippet: undefined,
    unread: false,
    pausedUntil: undefined,
    threadKey: `env:${id}`,
    task: undefined,
  });
  /**
   * The faces the group's row clusters, the lead first: each Mate's id and state. They are drawn
   * in one order whatever leads — by id, so a new lead travels — and placed by `data-place`.
   */
  const clusterOf = (mounted: ReactTestRenderer, ids = ["crm-bo", "crm-dev"]) =>
    surface(mounted, "sidebar-project-faces")
      .findAll((node) => typeof node.type === "string" && node.props["data-place"] !== undefined)
      .map((place, index) => {
        const face = place.find(
          (node) =>
            typeof node.type === "string" && node.props["data-zerops-primitive"] === "mate-face",
        );
        return {
          place: Number(place.props["data-place"]),
          state: face.props["data-mate-face-state"] as string,
          moment: face.props["data-mate-face-moment"] as string | undefined,
          key: ids.toSorted()[index],
        };
      })
      .toSorted((left, right) => left.place - right.place);
  /** The group row's line: whose words, then the words. */
  const lineOf = (mounted: ReactTestRenderer) => text(surface(mounted, "sidebar-project-line"));

  it("stands folded until its person opens it, and remembers it; another press folds it again", () => {
    const mounted = mount(tree());
    expect(expanded(mounted)).toBe(false);
    expect(mates(mounted)).toHaveLength(0);
    press(mounted, "sidebar-project");
    expect(expanded(mounted)).toBe(true);
    expect(mates(mounted)).toHaveLength(2);
    expect(stored.writtenOpened).toEqual(new Set(["aaa"]));
    press(mounted, "sidebar-project");
    expect(expanded(mounted)).toBe(false);
    expect(mates(mounted)).toHaveLength(0);
    expect(stored.writtenOpened).toEqual(new Set());
  });

  it.each([
    { case: "where exactly one of them is the viewer's, that Mate with it", mine: ["crm-dev"] },
    { case: "where both are the viewer's, no Mate", mine: ["crm-dev", "crm-bo"] },
    { case: "where none is the viewer's, no Mate", mine: [] },
  ])("opens on a press, $case", ({ mine: theirs }) => {
    const selected: Array<string> = [];
    const mounted = mount(
      tree({
        getOwner: (item: ZeropsCandidate) =>
          theirs.includes(item.project.id)
            ? { name: "Ada Lovelace", initials: "AL", avatarUrl: null, isViewer: true }
            : { name: "Jan Novák", initials: "JN", avatarUrl: null, isViewer: false },
        onSelect: (item: ZeropsCandidate) => {
          selected.push(item.project.id);
        },
      }),
    );
    press(mounted, "sidebar-project");
    expect(expanded(mounted)).toBe(true);
    expect(selected).toEqual(theirs.length === 1 ? theirs : []);
    // Folding it again opens nothing.
    press(mounted, "sidebar-project");
    expect(selected).toEqual(theirs.length === 1 ? theirs : []);
  });

  // HQ names a Mate's owner a colleague while the pointer is over the list: its row would drop
  // below the viewer's Mates, under a pointer aimed at it.
  const owners = (theirs: ReadonlyArray<string>) => (item: ZeropsCandidate) =>
    theirs.includes(item.project.id)
      ? { name: "Jan Novák", initials: "JN", avatarUrl: null, isViewer: false }
      : { name: "Ada Lovelace", initials: "AL", avatarUrl: null, isViewer: true };
  const rowOrder = (mounted: ReactTestRenderer) =>
    mounted.root
      .findAll(
        (node) => typeof node.type === "string" && node.props["data-zerops-mate-row"] !== undefined,
      )
      .map((node) => node.props["data-zerops-mate-row"] as string);
  const pointer = (mounted: ReactTestRenderer, event: "onPointerEnter" | "onPointerLeave") => {
    act(() => {
      surface(mounted, "sidebar-environments").props[event]({ pointerType: "mouse" });
    });
  };
  /** The group opened, its Mates' order as drawn, and the pointer over the list. */
  const openUnderPointer = () => {
    const mounted = mount(tree({ getOwner: owners([]) }));
    press(mounted, "sidebar-project");
    const before = rowOrder(mounted);
    expect(before).toHaveLength(2);
    pointer(mounted, "onPointerEnter");
    return { mounted, before };
  };
  const reSort = (mounted: ReactTestRenderer, colleague: string) => {
    act(() => {
      mounted.update(tree({ getOwner: owners([colleague]) }));
    });
  };

  it("a Mate's row stays put under the pointer while its list re-sorts", () => {
    const { mounted, before } = openUnderPointer();
    reSort(mounted, before[0]!);
    expect(rowOrder(mounted)).toEqual(before);
    // The pointer gone, the list takes its order.
    pointer(mounted, "onPointerLeave");
    expect(rowOrder(mounted)).toEqual([before[1], before[0]]);
  });

  it("a Mate's number is the place its row is drawn at, while the list holds its order", () => {
    const { mounted, before } = openUnderPointer();
    reSort(mounted, before[0]!);
    act(() => {
      window.dispatchEvent(Object.assign(new Event("keydown"), { key: "Alt" }));
    });
    const numbered = mounted.root
      .findAll(
        (node) => typeof node.type === "string" && node.props["data-zerops-mate-row"] !== undefined,
      )
      .map((row) => [
        row.props["data-zerops-mate-row"] as string,
        text(
          row.find(
            (node) =>
              typeof node.type === "string" &&
              node.props["data-zerops-surface"] === "sidebar-mate-number",
          ),
        ),
      ]);
    expect(numbered).toEqual([
      [before[0], "1"],
      [before[1], "2"],
    ]);
    // "The next one that waits" walks the rows as drawn too.
    expect(useSidebarReveal.getState().mateOrder.filter((id) => before.includes(id))).toEqual(
      before,
    );
    act(() => {
      window.dispatchEvent(Object.assign(new Event("keyup"), { key: "Alt" }));
    });
  });

  it("opens a folded project's Mates in their order now, not the order they were folded in", () => {
    const { mounted, before } = openUnderPointer();
    press(mounted, "sidebar-project");
    reSort(mounted, before[0]!);
    press(mounted, "sidebar-project");
    expect(rowOrder(mounted)).toEqual([before[1], before[0]]);
  });

  // A row's menu or the Sites popover is the list's own, drawn elsewhere: closed by a click
  // outside the list, the list never hears the pointer leave it.
  it("lets the rows take their order once the pointer is seen outside the list, unheard leaving", () => {
    const { mounted, before } = openUnderPointer();
    reSort(mounted, before[0]!);
    expect(rowOrder(mounted)).toEqual(before);
    act(() => {
      window.dispatchEvent(new Event("pointerover"));
    });
    expect(rowOrder(mounted)).toEqual([before[1], before[0]]);
  });

  it("draws only its row while folded: no Mate, no change row under it", () => {
    const html = renderToStaticMarkup(
      tree({
        getFlow: (): SidebarProjectFlow => ({
          pullRequests: [pull(4)],
          environments: new Map([["crm-prod", productionRow]]),
          releaseOffered: true,
        }),
      }),
    );
    expect(html).toMatch(
      /<button[^>]*aria-expanded="false"[^>]*data-zerops-surface="sidebar-project"/u,
    );
    for (const gone of ["sidebar-mate", "sidebar-pull-request", "sidebar-project-rows"])
      expect(html).not.toContain(`data-zerops-surface="${gone}"`);
  });

  it("names the project on its row and clusters its Mates' faces in the face's place", () => {
    const html = render([CRM_DEV, CRM_BO]);
    expect(html).toMatch(/data-zerops-surface="sidebar-project-name"[^>]*>Beviro CRM</u);
    expect(html).toContain('data-zerops-surface="sidebar-project-faces"');
    expect(html.match(/data-zerops-primitive="mate-face"/gu)).toHaveLength(2);
    expect(
      markupDom(html).querySelector('[data-zerops-surface="sidebar-project"]')?.textContent,
    ).toMatch(/^Beviro CRM, 2 Mates/u);
  });

  // What needs the viewer rises to the project's row: the asking face leads, the line says the ask.
  it("leads its faces and its line with the Mate that asks the viewer, then the one at work", () => {
    const MATES = [
      named("crm-a", "Ada", { tags: ["mate"], hq: AAA("mate", true) }),
      named("crm-b", "Bo", { tags: ["mate"], hq: AAA("mate", true) }),
      named("crm-c", "Cy", { tags: ["mate"], hq: AAA("mate", true) }),
    ].map((item) => mine({ ...item, group: "connected" }) as ZeropsCandidate);
    session.viewer = "u-ada";
    const activity = (item: ZeropsCandidate) =>
      item.project.id === "crm-a"
        ? said("crm-a", "working", "working")
        : item.project.id === "crm-b"
          ? said("crm-b", "input", "needs", 5, "Which colour?")
          : said("crm-c", "idle", "idle", 1);
    const mounted = mount(
      <SidebarZeropsTree
        candidates={MATES}
        complete
        getActivity={activity}
        onBrowseProjects={() => {}}
        onSelect={() => {}}
      />,
    );
    const ids = ["crm-a", "crm-b", "crm-c"];
    expect(clusterOf(mounted, ids).map(({ key, state }) => [key, state])).toEqual([
      ["crm-b", "needs"],
      ["crm-a", "working"],
      ["crm-c", "idle"],
    ]);
    expect(text(surface(mounted, "sidebar-project-lead"))).toBe("Bo asks: ");
    expect(text(surface(mounted, "sidebar-project"))).toMatch(/^Beviro CRM, 3 Mates.*Bo asks: /u);
  });

  it("says the oldest ask on its line, and how many more wait behind it", () => {
    const MATES = [
      named("crm-a", "Ada", { tags: ["mate"], hq: AAA("mate", true) }),
      named("crm-b", "Bo", { tags: ["mate"], hq: AAA("mate", true) }),
      named("crm-c", "Cy", { tags: ["mate"], hq: AAA("mate", true) }),
    ].map((item) => mine({ ...item, group: "connected" }) as ZeropsCandidate);
    session.viewer = "u-ada";
    const activity = (item: ZeropsCandidate) =>
      item.project.id === "crm-a"
        ? said("crm-a", "input", "needs", 2, "Newer ask")
        : item.project.id === "crm-b"
          ? said("crm-b", "approval", "needs", 9, "Older ask")
          : said("crm-c", "input", "needs", 4, "Middle ask");
    const mounted = mount(
      <SidebarZeropsTree
        candidates={MATES}
        complete
        getActivity={activity}
        onBrowseProjects={() => {}}
        onSelect={() => {}}
      />,
    );
    expect(text(surface(mounted, "sidebar-project-lead"))).toBe("Bo asks: ");
    expect(lineOf(mounted)).toMatch(/ · 2 more$/u);
    expect(clusterOf(mounted, ["crm-a", "crm-b", "crm-c"])[0]?.key).toBe("crm-b");
  });

  it("says its lead's own words where nobody asks the viewer anything", () => {
    const mounted = mount(
      tree({
        getActivity: (item: ZeropsCandidate) =>
          item.project.id === "crm-bo"
            ? said("crm-bo", "idle", "idle", 1, "Newest words")
            : said("crm-dev", "idle", "idle", 30),
      }),
    );
    expect(text(surface(mounted, "sidebar-project-lead"))).toMatch(/^Bo(: | · )$/u);
    expect(lineOf(mounted)).not.toContain("more");
    expect(clusterOf(mounted)[0]?.key).toBe("crm-bo");
  });

  it("never leads with an automated Mate waiting for a task over a person's Mate's words", () => {
    const MATES = [
      named("crm-a", "Ada", { tags: ["mate"], hq: AAA("mate", true) }),
      named("crm-r", "Raya", {
        tags: ["mate"],
        hq: recorded(AAA("mate", true), { automated: true, task: null }),
      }),
    ].map((item) => mine({ ...item, group: "connected" }) as ZeropsCandidate);
    session.viewer = "u-ada";
    const mounted = mount(
      <SidebarZeropsTree
        candidates={MATES}
        complete
        getActivity={(item: ZeropsCandidate) =>
          item.project.id === "crm-r"
            ? said("crm-r", "idle", "idle", 1, "Ready for tasks")
            : said("crm-a", "idle", "idle", 60, "Your preview is up")
        }
        onBrowseProjects={() => {}}
        onSelect={() => {}}
      />,
    );
    expect(text(surface(mounted, "sidebar-project-lead"))).toMatch(/^Ada(: | · )$/u);
    expect(clusterOf(mounted, ["crm-a", "crm-r"])[0]?.key).toBe("crm-a");
  });

  // A Mate whose own change waits for the person's review needs them, as the composer's top says
  // (`mateNextStep`): folded, its face among its group's says so (the owner, 2026-09-30: a folded
  // project read only its name while its Mate's #2 waited for Review); open, its row wears the
  // same face.
  it("shows a Mate whose change waits for review among its folded group's faces, and its row wears the same face", () => {
    const props = {
      getActivity: (item: ZeropsCandidate) => said(item.project.id, "idle", "idle"),
      getFlow: (): SidebarProjectFlow => ({
        pullRequests: [pull(2)],
        environments: new Map(),
        releaseOffered: false,
      }),
    };
    session.viewer = "u-ada";
    const candidates = [mine(CRM_DEV_CONNECTED), CRM_BO];
    const folded = mount(
      <SidebarZeropsTree
        candidates={candidates}
        complete
        onBrowseProjects={() => {}}
        onSelect={() => {}}
        {...props}
      />,
    );
    expect(clusterOf(folded).find(({ key }) => key === "crm-dev")?.state).toBe("needs");
    stored.opened = new Set(["aaa"]);
    const open = render(candidates, props);
    expect(open).toMatch(/data-zerops-mate-row="crm-dev"[\s\S]*?data-mate-face-state="needs"/u);
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
  // for me, it waits for karlos"): no needs face, no amber, nothing rising to its group's row —
  // and its change keeps its Review, for anybody with write on the group to merge.
  it("claims nothing of the viewer for another's Mate whose change waits, and keeps its Review", () => {
    session.viewer = "u-ada";
    const theirs = mine(CRM_DEV_CONNECTED, "u-karlos");
    const props = {
      getActivity: (item: ZeropsCandidate) => said(item.project.id, "idle", "idle"),
      getFlow: (): SidebarProjectFlow => ({
        pullRequests: [pull(2)],
        environments: new Map(),
        releaseOffered: false,
      }),
    };
    // Folded, its face stands among its group's at rest, and the line says no ask.
    const folded = render([theirs, CRM_BO], props);
    expect(folded).toContain('data-zerops-surface="sidebar-project-faces"');
    expect(folded).not.toContain('data-mate-face-state="needs"');
    expect(folded).not.toContain(" asks: ");
    expect(reviewTagLabelOf(folded)).toBe("Review Change 2");
    stored.opened = new Set(["aaa"]);
    const open = render([theirs, CRM_BO], props);
    expect(open).not.toContain('data-mate-face-state="needs"');
    expect(open).not.toContain('data-zerops-surface="sidebar-mate-dot"');
    expect(reviewTagLabelOf(open)).toBe("Review Change 2");
  });

  // A folded group's face is its Mate's row's (`mateRowView`): a Mate stopped on an error stands
  // still, as it does in the list — and what the row opened onto is simply there: nothing greets
  // on a paint.
  it("wears each Mate's row face — still where it stopped on an error — and scales no dot in on a paint", () => {
    const failed: ZeropsAgentActivity = {
      ...said("crm-dev", "failed", "needs"),
      errorLine: "The type check stopped at 2 errors",
    };
    const props = {
      getActivity: (item: ZeropsCandidate) =>
        item.project.id === "crm-dev" ? failed : said("crm-bo", "idle", "idle", 60),
    };
    const folded = mount(tree(props));
    const face = clusterOf(folded).find(({ key }) => key === "crm-dev");
    stored.opened = new Set(["aaa"]);
    const open = render(GROUP, props);
    const rowFace = /data-zerops-mate-row="crm-dev"[\s\S]*?data-mate-face-state="([a-z]+)"/u.exec(
      open,
    )?.[1];
    expect(face?.state).toBe(rowFace);
    expect(face?.state).not.toBe("needs");
    expect(face?.moment).toBeUndefined();
  });

  it("greets nothing its folded group's faces only stood in for until the Mate's state was read", () => {
    const told: ZeropsAgentActivity = {
      ...said("crm-dev", "idle", "idle"),
      at: "2026-09-27T10:00:00.000Z",
      unread: true,
    };
    const { remembered: _stoodIn, ...read } = restingActivity(told);
    const drawn = (item: ZeropsCandidate, activity: ZeropsAgentActivity) => (
      <SidebarZeropsTree
        candidates={[item, CRM_BO]}
        complete
        getActivity={(candidate: ZeropsCandidate) =>
          candidate.project.id === "crm-dev" ? activity : undefined
        }
        onBrowseProjects={() => {}}
        onSelect={() => {}}
      />
    );
    const mounted = mount(drawn(CRM_DEV, restingActivity(told)));
    session.viewer = "u-ada";
    act(() => {
      mounted.update(drawn(mine(CRM_DEV_CONNECTED), { ...read, kind: "input", face: "needs" }));
    });
    const face = clusterOf(mounted).find(({ key }) => key === "crm-dev");
    expect(face?.state).toBe("needs");
    expect(face?.moment).toBeUndefined();
  });

  // The owner, 2026-09-29: the + "leaves the conversation". Its ··· asks for the New Mate dialog
  // over whatever is on screen, and goes nowhere.
  it.each(["Add a Mate"])("asks for a Mate in place from its %s, going nowhere", () => {
    const asked: Array<string> = [];
    let browsed = 0;
    const entry = projectHeadingMenu({
      collapsed: false,
      onToggle: () => {},
      onAddMate: () => {
        asked.push("aaa");
      },
      onOpen: () => {
        browsed += 1;
      },
      reorder: undefined,
      setUp: [],
      onBrowseProjects: () => {
        browsed += 1;
      },
    }).find((item) => item.kind === "item" && item.label === "Add a project Mate");
    if (entry?.kind === "item") entry.act();
    expect(asked).toEqual(["aaa"]);
    expect(browsed).toBe(0);
  });

  it.each([
    {
      sentence: "A project whose setup is not ready shows Add a project Mate off, the reason on it",
      why: "Nova is still setting Shop Front up. New Mates can join once it's done.",
      shown: {
        disabled: true,
        why: "Nova is still setting Shop Front up. New Mates can join once it's done.",
      },
    },
    {
      sentence: "A project that takes a Mate shows Add a project Mate on, with nothing to explain",
      why: null,
      shown: { disabled: false, why: undefined },
    },
  ])("$sentence", ({ why, shown }) => {
    const entry = projectHeadingMenu({
      collapsed: false,
      onToggle: () => {},
      onAddMate: () => {},
      addMateWhy: why,
      onOpen: () => {},
      reorder: undefined,
      setUp: [],
      onBrowseProjects: () => {},
    }).find((item) => item.kind === "item" && item.label === "Add a project Mate");
    expect(entry?.kind === "item" ? { disabled: entry.disabled, why: entry.why } : null).toEqual(
      shown,
    );
  });

  it("collapses rather than opens the project from its name; the page is the menu's to open", () => {
    let opened = 0;
    const mounted = mount(
      tree({
        onOpenGroup: () => {
          opened += 1;
        },
      }),
    );
    expect(expanded(mounted)).toBe(false);
    press(mounted, "sidebar-project");
    expect(expanded(mounted)).toBe(true);
    press(mounted, "sidebar-project");
    expect(expanded(mounted)).toBe(false);
    expect(opened).toBe(0);
    // Mates in no project are no project's: nothing over them folds or opens.
    const html = renderToStaticMarkup(
      <SidebarZeropsTree
        candidates={[CRM_DEV, CRM_BO, named("solo", "Cy", { tags: ["mate"] })]}
        complete
        onBrowseProjects={() => {}}
        onSelect={() => {}}
      />,
    );
    expect(html).toContain("Ungrouped");
    expect(html.match(/data-zerops-surface="sidebar-project"/gu) ?? []).toHaveLength(1);
  });

  it("opens a project with no Mate from its row: the page is where it lives", () => {
    const opened: Array<string> = [];
    const mounted = mount(
      <SidebarZeropsTree
        candidates={[CRM_STAGE, CRM_PROD]}
        complete
        onBrowseProjects={() => {}}
        onOpenGroup={(groupId: string) => {
          opened.push(groupId);
        }}
        onSelect={() => {}}
      />,
    );
    expect(text(surface(mounted, "sidebar-project"))).toContain("No Mate yet");
    expect(surface(mounted, "sidebar-project").props["aria-expanded"]).toBeUndefined();
    press(mounted, "sidebar-project");
    expect(opened).toEqual(["aaa"]);
  });

  it("opens a collapsed project when one of its Mates' conversations opens, and lets it collapse again", () => {
    const mounted = mount(tree({ activeProjectId: null, activeConversation: null }));
    expect(mates(mounted)).toHaveLength(0);
    // Its conversation opens: the route names it, and its Mate is the one open.
    const opened = { activeProjectId: "crm-dev", activeConversation: "env:crm-dev/thread" };
    act(() => {
      mounted.update(tree(opened));
    });
    expect(mates(mounted)).toHaveLength(2);
    expect(stored.writtenOpened).toEqual(new Set(["aaa"]));
    press(mounted, "sidebar-project");
    act(() => {
      mounted.update(tree(opened));
    });
    expect(mates(mounted)).toHaveLength(0);
  });

  it("leaves a project folded when the Mate of the conversation a reload opened on is found after the menu drew it", () => {
    const reloaded = { activeConversation: "env:crm-dev/thread" };
    const mounted = mount(tree({ ...reloaded, activeProjectId: null }));
    expect(mates(mounted)).toHaveLength(0);
    act(() => {
      mounted.update(tree({ ...reloaded, activeProjectId: "crm-dev" }));
    });
    expect(mates(mounted)).toHaveLength(0);
    expect(surface(mounted, "sidebar-project").props["aria-current"]).toBe("true");
  });

  it("opens a collapsed project whose Mate's conversation is already open when the menu mounts", () => {
    const mounted = mount(tree({ activeProjectId: "crm-dev" }));
    expect(mates(mounted)).toHaveLength(2);
    expect(stored.writtenOpened).toEqual(new Set(["aaa"]));
  });

  // Opening a Mate's view from anywhere opens its group — a Mate still being created too, whose
  // own view is where it comes up.
  it("opens a collapsed project whose Mate still being created has its view open", () => {
    const html = render([CRM_DEV], {
      activeProjectId: "vera-dev",
      births: [
        {
          projectId: "vera-dev",
          startedAt: Date.now(),
          placement: { groupId: "aaa", groupName: "Beviro CRM", kind: "mate", displayName: "Vera" },
        },
      ],
    });
    expect(html).toMatch(
      /<button[^>]*aria-expanded="true"[^>]*data-zerops-surface="sidebar-project"/u,
    );
    expect(html).toMatch(
      /<button[^>]*aria-current="true"[^>]*data-zerops-surface="sidebar-mate-coming"/u,
    );
  });

  // A Mate made here is the viewer's from its press: its row stands among theirs, before a
  // colleague's, where its listed row will stand — never at the end, to leap up once it is listed.
  it("puts a Mate the viewer is making after their own Mates and before a colleague's", () => {
    const mounted = mount(
      tree({
        activeProjectId: "vera-dev",
        getOwner: (item: ZeropsCandidate) =>
          item.project.id === "crm-bo"
            ? { name: "Ada Lovelace", initials: "AL", avatarUrl: null, isViewer: true }
            : { name: "Jan Novák", initials: "JN", avatarUrl: null, isViewer: false },
        births: [
          {
            projectId: "vera-dev",
            startedAt: Date.now(),
            placement: {
              groupId: "aaa",
              groupName: "Beviro CRM",
              kind: "mate",
              displayName: "Vera",
            },
          },
        ],
      }),
    );
    const units = mounted.root
      .findAll(
        (node) =>
          typeof node.type === "string" && node.props["data-zerops-mate-unit"] !== undefined,
      )
      .map((node) => node.props["data-zerops-mate-unit"] as string)
      .filter((unit) => !unit.startsWith("group:"));
    expect(units).toEqual(["crm-bo", "vera-dev", "crm-dev"]);
  });

  // Folding the group you are in leaves the conversation open; its row stands for it.
  it("wears the list's band on its row while folded around the open conversation", () => {
    const band = (mounted: ReactTestRenderer) =>
      mounted.root.findByType(SidebarSelectedBand).props.current as string | null | undefined;
    const mounted = mount(tree({ activeProjectId: "crm-dev" }));
    expect(band(mounted)).toBe("crm-dev");
    expect(surface(mounted, "sidebar-project").props["aria-current"]).toBeUndefined();
    press(mounted, "sidebar-project");
    expect(band(mounted)).toBe("group:aaa");
    expect(surface(mounted, "sidebar-project").props["aria-current"]).toBe("true");
    expect(
      mounted.root.findAll(
        (node) =>
          typeof node.type === "string" && node.props["data-zerops-mate-unit"] === "group:aaa",
      ),
    ).toHaveLength(1);
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
      environments: new Map(groupReads.environments.map((row) => [row.id, row])),
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

  // The heading's grip went with the heading (2026-10-12): a project moves from its row's ···,
  // whatever order stood, and in the Custom order its row itself is pulled.
  it.each(["name", "custom"] as const)(
    "moves a project up from its row's ··· in the %s order, writing the Custom order on screen with it moved",
    (mode) => {
      setLocalStorageItem(PROJECT_ORDER_STORAGE_KEY, mode, ProjectOrderSchema);
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
      const menuOf = (project: string) =>
        mounted.root
          .findAll(
            (node) => node.props.project === project && node.props.projectMenu !== undefined,
          )[0]!
          .props.projectMenu() as ReadonlyArray<HeadingMenuEntry>;
      const verb = (project: string, label: string) =>
        menuOf(project).find((entry) => entry.kind === "item" && entry.label === label);
      // The first can go nowhere up, the last nowhere down.
      expect(verb("Links", "Move up")).toMatchObject({ disabled: true });
      expect(verb("Shop", "Move down")).toMatchObject({ disabled: true });
      act(() => {
        const up = verb("Shop", "Move up");
        if (up?.kind === "item") up.act();
      });
      expect(getLocalStorageItem(PROJECT_ORDER_STORAGE_KEY, ProjectOrderSchema)).toBe("custom");
      expect(
        getLocalStorageItem(PROJECT_CUSTOM_ORDER_STORAGE_KEY, ProjectCustomOrderSchema),
      ).toEqual(["shop", "links"]);
      const spoken = mounted.root.find(
        (node) =>
          typeof node.type === "string" &&
          node.props.role === "status" &&
          node.props["aria-live"] === "polite",
      );
      expect(text(spoken)).toBe("Shop moved to 1 of 2.");
    },
  );
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

  it("rings no working face", () => {
    expect(row(working())).not.toContain("plan-ring");
  });

  // A running clock is not something to click, so it is not blue (S3): it
  // counts up in ink where the age was.
  it("counts up how long it has been working, where its age was", () => {
    const time = slot(row(working()));
    expect(time).toContain("3m 12s");
    expect(slot(row(live()))).toContain(">2h<");
  });

  // Work left running in the background wears the working face and offers
  // Stop: its slot counts it up as any working face's does, never a grey age
  // beside a working face (the approved menu; the 2026-09-28 audit's gap).
  it("counts up work left running in the background, as it counts a run", () => {
    const time = slot(row(working({ kind: "monitoring" })));
    expect(time).toContain("3m 12s");
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

  // The plan's table (M7), as the row draws it: the face and the line under
  // the name say the state, and no word does — nor any dot (round 5).
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
      third: 'data-zerops-reply-tone="ink"',
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
    expect(html).not.toContain("sidebar-mate-dot");
    // What its dot said, its row still says in words to a reader.
    if (dot !== undefined) expect(html).toMatch(/<button[^>]*aria-label="[^"]+, [^"]+"/u);
    expect(html).toContain(third);
    for (const word of ["Idle", "Working", "Needs you", "Done", "Failed", "Unread"]) {
      expect(html).not.toContain(`>${word}<`);
    }
  });

  // The owner, 2026-10-15: "unread is not highlighted at all".
  it.each([
    { case: "finished, not seen", activity: live({ face: "done", unread: true }), dot: true },
    {
      case: "stopped on an error not seen",
      activity: live({ kind: "failed", face: "needs", errorLine: "Build broke", unread: true }),
      dot: true,
    },
    { case: "seen", activity: live(), dot: false },
    { case: "at work", activity: working({ unread: true }), dot: false },
  ])("An unread Mate shows its dot beside the time: $case", ({ activity, dot }) => {
    const time = slot(row(activity));
    expect(time).not.toBe("");
    expect(time.includes('data-zerops-surface="sidebar-mate-unread"')).toBe(dot);
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

    it("gives the line back to the ask once it is cleared", () => {
      useComposerDraftStore.getState().setPrompt(ref, "also check the thumbnails");
      const tree = drawn(live({ snippet: undefined }));
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
    expect(row(undefined)).not.toContain("sidebar-mate-more");
    // A Mate in no project has no project's verbs either: nothing at all stands in its slot.
    expect(render([LOOSE], { getActivity: () => spoken })).not.toContain("sidebar-mate-actions");
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
    [...markupDom(html).querySelectorAll('[data-zerops-surface="sidebar-mate-name"]')].map((name) =>
      name.textContent?.replaceAll("\u00a0", " "),
    );

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
    expect(names(html)).toEqual(["Links · dev"]);
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
  // Two Mates make Beviro CRM a group, folded until its person opens it.
  const CRM_BO = named("crm-bo", "Bo", { tags: ["mate"], hq: AAA("mate", true) });
  const tree = () => (
    <SidebarZeropsTree
      candidates={[CRM_DEV_CONNECTED, CRM_BO, CRM_STAGE, CRM_PROD]}
      complete
      onBrowseProjects={() => {}}
      onSelect={() => {}}
    />
  );

  it("opens the Mate's collapsed project and answers the ask once", () => {
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
    expect(mateRows()).toHaveLength(2);
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
      [
        "links-stage",
        {
          ...stageRow,
          id: HqEnvironmentId.make("links-stage"),
          target: { kind: "zerops", projectId: ProjectId.make("links-stage") },
        },
      ],
      [
        "links-prod",
        {
          ...productionRow,
          id: HqEnvironmentId.make("links-prod"),
          target: { kind: "zerops", projectId: ProjectId.make("links-prod") },
        },
      ],
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

  // A stop is found as its place — and where nothing of it is read, a find would land on nothing,
  // and the focus would jump there once it is.
  it("finds no stop where nothing says how it stands", () => {
    mount(tree({ candidates: [LINKS_MATE, LINKS_STAGE, LINKS_PROD] }));
    expect(index()?.stops).toEqual([]);
  });

  it("leaves a folded group folded when a jump lands on its globe, and answers the ask", () => {
    const THEO = named("links-theo", "Links - theo", { tags: ["mate"], hq: IN_LINKS() });
    const mounted = mount(
      tree({ candidates: [LINKS_MATE, THEO, up(LINKS_STAGE), up(LINKS_PROD)] }),
    );
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
    const THEO = named("links-theo", "Links - theo", { tags: ["mate"], hq: IN_LINKS() });
    const mounted = mount(
      tree({ candidates: [LINKS_MATE, THEO, up(LINKS_STAGE), up(LINKS_PROD)] }),
    );
    const mateRows = () =>
      mounted.root.findAll(
        (node) =>
          typeof node.type === "string" && node.props["data-zerops-surface"] === "sidebar-mate",
      );
    expect(mateRows()).toHaveLength(0);
    act_(() => {
      useSidebarReveal.getState().reveal({ kind: "project", groupId: "links" });
    });
    expect(mateRows()).toHaveLength(2);
    expect(useSidebarReveal.getState().revealing).toBeNull();
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
    expect(html).toContain("The page reads the build number.");
    expect(html).toContain('data-mate-face-state="idle"');
    expect(html).not.toContain('data-zerops-surface="sidebar-mate-stop"');
  });

  it("offers no Review until HQ answers its changes", () => {
    session.viewer = SIGNER;
    const html = render([mine(CRM_DEV), CRM_PROD], {
      getFlow: () => flowOf({ changesKnown: false, pullRequests: [pull(15, { title: "Live" })] }),
    });
    expect(reviewTagOf(html)).toBeUndefined();
  });

  it("offers HQ's changes in Review once it answered", () => {
    session.viewer = SIGNER;
    const html = render([mine(CRM_DEV), CRM_PROD], {
      getFlow: () => flowOf({ changesKnown: true, pullRequests: [pull(15, { title: "Live" })] }),
    });
    expect(reviewTagLabelOf(html)).toBe("Review Live");
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
    // The Mate's last words gave it their place.
    expect(html).not.toContain("Thumbnails load lazily now.");
    expect(html).toContain('data-mate-face-state="sleep"');
    // Nothing of the Mate's: only its project's own verbs stay on the row's ···.
    expect(html).not.toContain("sidebar-mate-more");
    expect(html).not.toContain("sidebar-mate-stop");
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
  /** The environment tag's word and the whole sentence it says, where it stands. */
  const tagOf = (html: string) => {
    const match =
      /<button([^>]*data-zerops-surface="sidebar-project-env-tag"[^>]*)>(.*?)<\/button>/u.exec(
        html,
      );
    return match === null
      ? undefined
      : {
          word: match[2]!.replace(/<[^>]+>/gu, ""),
          sentence: /aria-label="([^"]*)"/u.exec(match[1]!)?.[1],
        };
  };
  it.each([5, 20, 24 * 60])("made %i min ago, its app being made: coming up", (minutes) => {
    const item = up(CRM_STAGE, "CREATING");
    const stage = {
      ...item,
      project: { ...item.project, created: madeAt(Date.now() - minutes * 60_000) },
    } as ZeropsCandidate;
    expect(tagOf(render([CRM_DEV, stage]))).toEqual({
      word: "Coming up",
      sentence: "Stage coming up · adding the app",
    });
  });
});

describe("the menu's release offer", () => {
  it("after a merge reaches stage, the menu offers a release when production exists", () => {
    const registry = AtomRegistry.make();
    registry.set(zeropsSessionAtom, {
      status: "signed-in",
      organizationStatus: "selected",
      activeOrganization: organization,
    });
    const { store } = mountHqNavigation(registry, organization.organizationId, {
      structure: {
        apps: [
          {
            id: "aaa",
            name: "Beviro CRM",
            projects: [
              { projectId: "crm-dev", name: "Ada", kind: "mate", mate: { face: "" } },
              { projectId: "crm-stage", name: "Stage", kind: "stage", mate: null },
              { projectId: "crm-prod", name: "Production", kind: "production", mate: null },
            ],
            environments: [
              {
                name: "stage",
                tier: "stage",
                projectId: "crm-stage",
                sources: ["main"],
                order: 1,
                jobs: [],
                keyHeld: true,
                keyInvalid: false,
              },
              {
                name: "production",
                tier: "production",
                projectId: "crm-prod",
                sources: ["release"],
                order: 2,
                jobs: [],
                keyHeld: true,
                keyInvalid: false,
              },
            ],
          },
        ],
        ungrouped: [],
      },
      // HQ compared the merged main with the older code production still runs.
      releaseOffers: {
        aaa: {
          head: "a".repeat(40),
          suggestion: "v2.4.1",
          gate: { allow: true },
          inFlight: null,
          summary: { total: 1, more: 0, subjects: ["Quicker checkout"], atLeast: false },
        },
      },
    });
    stops.deployments = new Map([
      [
        "crm-stage",
        {
          state: "known",
          freshness: "current",
          value: { kind: "running", version: { label: "main", commit: "a".repeat(40) } },
        },
      ],
      [
        "crm-prod",
        {
          state: "known",
          freshness: "current",
          value: { kind: "running", version: { label: "v2.4.0", commit: "b".repeat(40) } },
        },
      ],
    ]);
    const inventory: Inventory = {
      projects: [CRM_DEV.project, CRM_STAGE.project, CRM_PROD.project],
      projectRefs: new Map(["crm-dev", "crm-stage", "crm-prod"].map((id) => [id, project(id)])),
      authority: new Map(),
      lost: new Set(),
      deleted: [],
      isLoading: false,
      error: null,
    };
    const unexpectedRead = () => {
      throw new Error("The menu must not read detail for a release offer.");
    };
    const accountData: AccountData = {
      data: store.data,
      orgId: organization.organizationId,
      logs: null,
      demandDetail: unexpectedRead,
      renewHeld: unexpectedRead,
      retry: unexpectedRead,
      showHq: unexpectedRead,
      moveOffers: unexpectedRead,
      handoverCandidates: unexpectedRead,
      readDetail: unexpectedRead,
      revalidate: unexpectedRead,
      retryDetail: unexpectedRead,
      compare: unexpectedRead,
    };
    function Menu() {
      const { flows } = useProjectFlows("every");
      return (
        <SidebarZeropsTree
          candidates={[CRM_DEV, up(CRM_STAGE), up(CRM_PROD)]}
          complete
          onBrowseProjects={() => {}}
          onSelect={() => {}}
          getFlow={(id) => {
            const flow = flows.get(id);
            return flow === undefined
              ? undefined
              : {
                  pullRequests: flow.pullRequests,
                  environments: new Map(flow.environments.map((row) => [row.id, row])),
                  releaseOffered: flow.release.gate.allowed,
                  releaseSummary: flow.release.summary,
                  releaseTag: flow.release.suggestion,
                };
          }}
        />
      );
    }
    try {
      const html = renderToStaticMarkup(
        <RegistryContext.Provider value={registry}>
          <AccountDataContext.Provider value={accountData}>
            <InventoryContext.Provider value={inventory}>
              <Menu />
            </InventoryContext.Provider>
          </AccountDataContext.Provider>
        </RegistryContext.Provider>,
      );
      expect(html).toMatch(
        /<span[^>]*aria-label="Release: 1 change waits for production"[^>]*data-zerops-surface="sidebar-project-release-mark"/u,
      );
      expect(html).toContain('data-zerops-surface="sidebar-project-sites"');
      expect([...store.state().streams.keys()].some((key) => key.includes("hq-app-detail"))).toBe(
        false,
      );
    } finally {
      registry.dispose();
    }
  });
});

it("the tree retains its order on a timestamp-only delivery and each row reads only its own Mate", () => {
  const registry = AtomRegistry.make();
  const at = "2026-10-07T00:00:00Z";
  const overview = (id: string, words: string, updatedAt = at) => ({
    presence: { online: true, since: at, overview: "live" as const },
    identity: {
      environmentId: EnvironmentId.make(`env-${id}`),
      serverVersion: "0.14.35",
      update: null,
    },
    main: {
      id: ThreadId.make(`chat-${id}`),
      title: "Task",
      hasPendingApprovals: false,
      hasPendingUserInput: false,
      hasActionableProposedPlan: false,
      interactionMode: "default" as const,
      backgroundLiveness: null,
      session: null,
      latestTurn: null,
      latestUserMessageAt: at,
      updatedAt,
      latestMessagePreview: { role: "assistant" as const, text: words },
      latestUserMessagePreview: { text: "Task" },
      planProgress: null,
      pendingQuestion: null,
      usagePause: null,
      liveStep: null,
    },
  });
  const a = candidate("a", { tags: ["mate"], hq: AAA() });
  const b = candidate("b", { tags: ["mate"], hq: AAA() });
  const candidates = [a, b];
  // Their group opened, so each Mate is a row of its own.
  stored.opened = new Set(["aaa"]);
  let mates = { a: overview("a", "First"), b: overview("b", "First") };
  const hq = mountHqNavigation(registry, "org", { mates });
  const onSelect = vi.fn();
  function Menu() {
    const activity = useMatesActivity(true);
    const getActivity = useMateRowActivity(activity);
    return (
      <SidebarZeropsTree
        candidates={candidates}
        complete
        keyedReadings
        getActivity={getActivity}
        onSelect={onSelect}
        onBrowseProjects={onSelect}
      />
    );
  }
  const tree = mount(
    <RegistryContext.Provider value={registry}>
      <Menu />
    </RegistryContext.Provider>,
  );
  const rows = () =>
    tree.root.findAll(
      (node) => node.type === "button" && node.props["data-zerops-surface"] === "sidebar-mate",
    );
  const root = () => surface(tree, "sidebar-environments");
  const before = rows().map((row) => row.props);
  const treeBefore = root().props;
  const deliver = (next: typeof mates.a) => {
    mates = { ...mates, a: next };
    act(() => hq.seed({ mates }));
  };
  deliver(overview("a", "Second"));
  expect(rows().filter((row, i) => row.props !== before[i])).toHaveLength(1);
  expect(root().props).toBe(treeBefore);
  expect(text(rows()[0]!)).toContain("Second");
  const messageRows = rows().map((row) => row.props);
  deliver(overview("a", "Second", "2026-10-07T00:00:01Z"));
  expect(rows().filter((row, i) => row.props !== messageRows[i])).toHaveLength(0);
  expect(root().props).toBe(treeBefore);
  // Click selection still use the candidate the row actually represents.
  act(() => rows()[1]!.props.onClick());
  expect(onSelect).toHaveBeenLastCalledWith(b);
});

it("HQ's outage header exposes its source time", () => {
  const html = renderToStaticMarkup(
    <SidebarHqStatus
      kind="last-known"
      line="HQ is not reachable since 10:36 — showing what it last said."
      onAgain={() => {}}
    />,
  );
  expect(html).toContain("since 10:36");
});

it("a retained Mate line keeps its row clickable and offers Zerops separately", () => {
  const activity: ZeropsAgentActivity = {
    threadId: ThreadId.make("thread-retained"),
    subject: undefined,
    snippet: undefined,
    pausedUntil: undefined,
    task: undefined,
    kind: "idle",
    status: null,
    face: "sleep",
    at: "2026-10-08T08:20:00Z",
    unread: false,
    threadKey: "env:thread-retained",
    remembered: true,
    lastKnown: { kind: "working", at: "2026-10-08T08:20:00Z", pausedUntil: undefined },
  };
  const html = render([CRM_DEV], { getActivity: () => activity });
  expect(html).toContain("Last known");
  expect(html).toContain("was working");
  expect(html).toMatch(/<button[^>]*>(?:(?!<\/button>)[\s\S])*Last known/);
  expect(html).toContain('href="https://app.zerops.io/project/crm-dev"');
  expect(html).toContain("Open in Zerops");
  expect(html).not.toMatch(/<button[^>]*>(?:(?!<\/button>)[\s\S])*<a/);
});

describe("one project order, the person's", () => {
  const now = Date.parse("2026-10-09T12:00:00Z");
  const week = 7 * 24 * 60 * 60 * 1000;
  const rows = [LINKS_MATE, CRM_DEV];
  const activity = (at: number, untouched = false) =>
    threadAgentActivity(
      {
        id: ThreadId.make("work"),
        environmentId: EnvironmentId.make("env"),
        title: "Work",
        hasPendingApprovals: false,
        hasPendingUserInput: false,
        hasActionableProposedPlan: false,
        interactionMode: "default",
        backgroundLiveness: null,
        session: null,
        latestTurn: null,
        latestUserMessageAt: untouched ? null : new Date(at).toISOString(),
        updatedAt: new Date(at).toISOString(),
      },
      undefined,
      now,
    );
  const read = (at: number, overrides: Partial<ZeropsAgentActivity> = {}) => ({
    ...activity(at),
    ...overrides,
  });
  const ids = (html: string) =>
    [...html.matchAll(/data-zerops-group="([^"]+)"/gu)].map((match) => match[1]);
  const mountedIds = (tree: ReactTestRenderer) =>
    tree.root
      .findAll((node) => node.type === "section" && node.props["data-zerops-group"] !== undefined)
      .map((node) => node.props["data-zerops-group"]);
  const menu = (getActivity: (candidate: ZeropsCandidate) => ZeropsAgentActivity | undefined) => (
    <SidebarZeropsTree
      candidates={rows}
      complete
      getActivity={getActivity}
      onBrowseProjects={() => {}}
      onSelect={() => {}}
    />
  );
  afterEach(() => {
    vi.restoreAllMocks();
    setLocalStorageItem(PROJECT_ORDER_STORAGE_KEY, "newest", ProjectOrderSchema);
    setLocalStorageItem(PROJECT_CUSTOM_ORDER_STORAGE_KEY, [], ProjectCustomOrderSchema);
  });

  it("Unread, untouched chats and remembered running state do not falsely promote projects.", () => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    setLocalStorageItem(PROJECT_ORDER_STORAGE_KEY, "name", ProjectOrderSchema);
    for (const held of [
      read(now - week - 1, { unread: true }),
      activity(now, true),
      restingActivity(read(now - week - 1, { kind: "working", face: "working" })),
    ]) {
      const html = render(rows, {
        getActivity: (candidate: ZeropsCandidate) => (candidate === LINKS_MATE ? held : undefined),
      });
      expect(ids(html)).toEqual(["aaa", "links"]);
      expect(html).not.toContain("sidebar-other-projects-fold");
    }
  });

  it("Background arrivals and expiry never move navigation during an opening.", () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    setLocalStorageItem(PROJECT_ORDER_STORAGE_KEY, "name", ProjectOrderSchema);
    const tree = mount(menu((candidate) => read(candidate === LINKS_MATE ? now : now - week - 1)));
    expect(mountedIds(tree)).toEqual(["aaa", "links"]);
    clock.mockReturnValue(now + week + 1);
    act(() => tree.update(menu((candidate) => read(candidate === CRM_DEV ? now + week + 1 : now))));
    expect(mountedIds(tree)).toEqual(["aaa", "links"]);
  });

  // The owner (2026-10-11), of the "N other projects" fold: "I'd get rid of" it.
  it("lists every project in the person's order, whatever its Mates did and whoever waits", () => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    setLocalStorageItem(PROJECT_ORDER_STORAGE_KEY, "name", ProjectOrderSchema);
    session.viewer = "viewer";
    signerOf.set(LINKS_MATE.project.id, "viewer");
    const getFlow = (): SidebarProjectFlow => ({
      pullRequests: [{ ...pull(2), mateProjectId: LINKS_MATE.project.id }],
      environments: new Map(),
      releaseOffered: false,
    });
    for (const html of [
      render(rows, {
        getActivity: (candidate: ZeropsCandidate) =>
          read(candidate === LINKS_MATE ? now : now - week - 1, { kind: "working" }),
      }),
      render(rows, { getFlow, getActivity: () => read(now - week - 1) }),
      render(rows, { activeProjectId: LINKS_MATE.project.id }),
    ]) {
      expect(ids(html)).toEqual(["aaa", "links"]);
      expect(html).not.toContain("data-zerops-project-section");
    }
  });

  it("Multiple active Mates produce one project section; empty groups add no heading.", () => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    const second = { ...CRM_DEV, key: "second", project: { ...CRM_DEV.project, id: "second" } };
    const html = render([CRM_DEV, second], { getActivity: () => read(now) });
    expect(ids(html)).toEqual(["aaa"]);
    expect(html).not.toContain("sidebar-other-projects-fold");
    expect(render([])).not.toContain("sidebar-other-projects-fold");
  });

  it("says how many Mates Mine leaves out, and lists everyone again from there", () => {
    let everyone = 0;
    const tree = mount(
      <SidebarZeropsTree
        candidates={rows}
        complete
        onBrowseProjects={() => {}}
        onSelect={() => {}}
        onShowEveryone={() => {
          everyone += 1;
        }}
        shown={(candidate) => candidate === LINKS_MATE}
      />,
    );
    expect(text(surface(tree, "sidebar-hidden-mates"))).toContain("1 Mate hidden");
    press(tree, "sidebar-show-everyone");
    expect(everyone).toBe(1);
  });
});

describe("menu liveness through HQ records", () => {
  const at = "2026-10-06T12:00:00.000Z";
  const overview = (patch: Partial<NonNullable<MateLiveView["main"]>> = {}): MateLiveView => ({
    presence: { online: true, since: at, overview: "live" },
    identity: {
      environmentId: EnvironmentId.make("env-Ada"),
      serverVersion: "0.14.35",
      update: null,
    },
    main: {
      id: ThreadId.make("chat-Ada"),
      title: "Inspect the checkout",
      hasPendingApprovals: false,
      hasPendingUserInput: false,
      hasActionableProposedPlan: false,
      interactionMode: "default",
      backgroundLiveness: null,
      session: null,
      latestTurn: null,
      latestUserMessageAt: at,
      updatedAt: at,
      latestMessagePreview: null,
      latestUserMessagePreview: { text: "Inspect the checkout" },
      planProgress: null,
      pendingQuestion: null,
      usagePause: null,
      liveStep: null,
      ...patch,
    },
  });
  const working = () =>
    overview({
      session: { status: "running", lastError: null },
      liveStep: { kind: "thinking", since: at },
      planProgress: { step: "Inspecting the checkout" },
    });
  const attention = (patch: Partial<MateAttention> = {}): MateAttention => ({
    source: {
      environmentId: EnvironmentId.make("env-Ada"),
      epoch: 1,
      incarnation: "before",
      revision: 1,
    },
    mainThreadId: ThreadId.make("chat-Ada"),
    lastThreadId: ThreadId.make("chat-Ada"),
    working: 1,
    waiting: 0,
    results: [],
    questions: [],
    truncated: false,
    ...patch,
  });
  function menu() {
    session.viewer = SIGNER;
    signerOf.set("Ada", SIGNER);
    const registry = AtomRegistry.make();
    const hq = mountHqNavigation(registry, "org", { mates: { Ada: overview() } });
    function Menu() {
      const activity = useMatesActivity(true);
      const getActivity = useMateRowActivity(activity);
      return (
        <SidebarZeropsTree
          candidates={[
            candidate("Ada", {
              tags: ["mate"],
              hq: { appId: null, appName: null, kind: "mate", mate: { face: "" } },
            }),
          ]}
          complete
          keyedReadings
          getActivity={getActivity}
          onSelect={() => {}}
          onBrowseProjects={() => {}}
        />
      );
    }
    const tree = mount(
      <RegistryContext.Provider value={registry}>
        <Menu />
      </RegistryContext.Provider>,
    );
    const deliver = (record: MateLiveView, word?: MateAttention) =>
      act(() =>
        hq.seed({
          mates: { Ada: record },
          ...(word === undefined ? {} : { attention: { Ada: word } }),
        }),
      );
    const line = (name: string) => text(surface(tree, name));
    const lacks = (name: string) =>
      expect(
        tree.root.findAll(
          (node) => typeof node.type === "string" && node.props["data-zerops-surface"] === name,
        ),
      ).toHaveLength(0);
    return { registry, tree, deliver, line, lacks };
  }

  it("an agent starts working and its row shows the live step", () => {
    const s = menu();
    try {
      s.lacks("sidebar-mate-live-step");
      s.deliver(working());
      expect(s.line("sidebar-mate-live-step")).toContain("Thinking");
    } finally {
      s.registry.dispose();
    }
  });
  it("an agent waiting for input shows its question in the row", () => {
    const s = menu();
    try {
      s.deliver(working());
      expect(s.line("sidebar-mate-live-step")).toContain("Thinking");
      s.deliver(
        overview({ hasPendingUserInput: true, pendingQuestion: "Which branch should I use?" }),
      );
      expect(s.line("sidebar-mate-snippet")).toBe("Which branch should I use?");
      s.lacks("sidebar-mate-live-step");
    } finally {
      s.registry.dispose();
    }
  });
  it("an agent finishes and its row shows the answer", () => {
    const s = menu();
    try {
      s.deliver(working());
      expect(s.line("sidebar-mate-live-step")).toContain("Thinking");
      s.deliver(
        overview({ latestMessagePreview: { role: "assistant", text: "Checkout is ready" } }),
      );
      expect(s.line("sidebar-mate-snippet")).toBe("Checkout is ready");
      s.lacks("sidebar-mate-live-step");
    } finally {
      s.registry.dispose();
    }
  });
  it("a new chat replaces the old request in the row", () => {
    const s = menu();
    try {
      expect(s.line("sidebar-mate-subject")).toBe("Inspect the checkout");
      s.deliver(
        overview({
          id: ThreadId.make("new-chat"),
          title: "Fresh task",
          latestUserMessagePreview: { text: "Review the new API" },
        }),
      );
      expect(s.line("sidebar-mate-subject")).toBe("Review the new API");
      expect(text(surface(s.tree, "sidebar-mate"))).not.toContain("Inspect the checkout");
    } finally {
      s.registry.dispose();
    }
  });
  it("a Mate's attention that it stopped clears its working row within two seconds", () => {
    const s = menu();
    try {
      const word = attention();
      s.deliver(working(), word);
      expect(s.line("sidebar-mate-live-step")).toContain("Thinking");
      const start = performance.now();
      s.deliver(working(), { ...word, source: { ...word.source, revision: 2 }, working: 0 });
      s.lacks("sidebar-mate-live-step");
      expect(performance.now() - start).toBeLessThanOrEqual(2_000);
    } finally {
      s.registry.dispose();
    }
  });
  it("a restarted Mate's attention, HQ relaying it alone, replaces its run before within two seconds, and the run before's late word never wins", () => {
    vi.useFakeTimers();
    const s = menu();
    try {
      const old = attention();
      s.deliver(working(), old);
      expect(s.line("sidebar-mate-live-step")).toContain("Thinking");
      const start = performance.now();
      s.deliver(working(), {
        ...old,
        source: { ...old.source, epoch: 2, incarnation: "after", revision: 0 },
        working: 0,
      });
      s.lacks("sidebar-mate-live-step");
      expect(performance.now() - start).toBeLessThanOrEqual(2_000);
      // Observe after the stale report has actually entered the reducer, through the original window.
      s.deliver(working(), { ...old, source: { ...old.source, revision: 99 } });
      s.lacks("sidebar-mate-live-step");
      act(() => vi.advanceTimersByTime(2_000));
      s.lacks("sidebar-mate-live-step");
    } finally {
      s.registry.dispose();
      vi.useRealTimers();
    }
  });
  it("a new chat HQ relays the attention of alone reaches its row within two seconds", () => {
    const s = menu();
    try {
      expect(s.line("sidebar-mate-subject")).toBe("Inspect the checkout");
      const word = attention();
      const start = performance.now();
      s.deliver(overview(), {
        ...word,
        mainThreadId: ThreadId.make("new-chat"),
        lastThreadId: ThreadId.make("new-chat"),
        working: 0,
        waiting: 1,
        questions: [{ threadId: ThreadId.make("new-chat"), kind: "approval", turnId: null }],
      });
      expect(surface(s.tree, "sidebar-mate").props["aria-label"]).toBe("Ada, Waiting for you");
      s.lacks("sidebar-mate-subject");
      expect(performance.now() - start).toBeLessThanOrEqual(2_000);
    } finally {
      s.registry.dispose();
    }
  });
  it("folding and expanding restores the application's Mate rows", () => {
    stored.opened = new Set(["aaa"]);
    const tree = mount(
      <SidebarZeropsTree
        candidates={[
          candidate("Ada", { tags: ["mate"], hq: AAA() }),
          candidate("Bea", { tags: ["mate"], hq: AAA() }),
        ]}
        complete
        onBrowseProjects={() => {}}
        onSelect={() => {}}
      />,
    );
    const names = () =>
      tree.root
        .findAll(
          (node) =>
            typeof node.type === "string" &&
            node.props["data-zerops-surface"] === "sidebar-mate-name",
        )
        .map(text);
    expect(names()).toEqual(["Ada", "Bea"]);
    press(tree, "sidebar-project");
    expect(names()).toEqual([]);
    press(tree, "sidebar-project");
    expect(names()).toEqual(["Ada", "Bea"]);
  });
});

it("a reader sees the protocol notice without an update action", () => {
  session.viewer = "reader";
  session.role = "READ_ONLY";
  const registry = AtomRegistry.make();
  const { store } = mountHqNavigation(registry, "org", {
    structure: { apps: [], ungrouped: [{ projectId: "Ada", name: "Ada", mate: { face: "" } }] },
    person: {
      role: "READER",
      mayWrite: false,
      mine: false,
      ownerUserId: null,
      waitsOnViewer: false,
      unseen: null,
    },
  });
  store.dispatch({
    kind: "delivery",
    via: "hq-stream",
    reset: true,
    scopes: [{ scope: "hq:org:hq-protocol", generation: 0 }],
    rows: [
      {
        family: "hqProtocol",
        id: "org",
        revision: { kind: "hq", incarnation: "core", revision: 1 },
        value: { build: "old" },
      },
    ],
    removals: [],
  });
  try {
    const tree = mount(
      <RegistryContext.Provider value={registry}>
        <SidebarZeropsTree
          candidates={[
            candidate("Ada", {
              tags: ["mate"],
              hq: { appId: null, appName: null, kind: "mate", mate: { face: "" } },
            }),
          ]}
          complete
          onSelect={() => {}}
          onBrowseProjects={() => {}}
        />
      </RegistryContext.Provider>,
    );
    expect(text(surface(tree, "sidebar-environments"))).toContain(
      "HQ needs an update to show all navigation facts.",
    );
    expect(text(surface(tree, "sidebar-mate-name"))).toContain("Ada");
    expect(text(surface(tree, "sidebar-environments"))).not.toContain("Update HQ");
  } finally {
    registry.dispose();
  }
});

it("HQ down retains a known Not in this HQ row", () => {
  const registry = AtomRegistry.make();
  registry.set(zeropsSessionAtom, {
    status: "signed-in",
    organizationStatus: "selected",
    activeOrganization: organization,
  });
  const { store } = mountHqNavigation(registry, organization.organizationId, {
    structure: { apps: [], ungrouped: [] },
  });
  const foreign = candidate("Wren", { tags: ["mate"] });
  const draw = () =>
    renderToStaticMarkup(
      <RegistryContext.Provider value={registry}>
        <SidebarZeropsTree
          candidates={[foreign]}
          complete
          onBrowseProjects={() => {}}
          onSelect={() => {}}
        />
      </RegistryContext.Provider>,
    );
  try {
    expect(draw()).toContain("Not in this HQ");
    hqDrops(store, organization.organizationId, 100_000);
    for (const input of graceOver(store.state())) store.dispatch(input);
    expect(draw()).toContain("Not in this HQ");
    expect(draw()).not.toContain("Nobody has signed in yet");
  } finally {
    registry.dispose();
  }
});

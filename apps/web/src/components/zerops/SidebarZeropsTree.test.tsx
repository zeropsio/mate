// @effect-diagnostics nodeBuiltinImport:off -- The heading's band is checked against the stylesheet that draws it.
import {
  buildZeropsGroupTree,
  groupFlow,
  type EnvironmentRow,
  type FlowPullRequest,
  type GroupNextStepKind,
  type MissingEnvironmentRow,
  type ZeropsPlacedBirth,
} from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { crewSnapshotFixture } from "@t3tools/client-runtime/zerops/crew/testing/fixtures";
import type { Deployment } from "@t3tools/client-runtime/zerops/flow";
import type { Shown } from "@t3tools/client-runtime/zerops/knowledge";
import type { CandidatesNotice } from "@t3tools/client-runtime/zerops/projections";
import { deriveCrewView } from "@t3tools/client-runtime/zerops/projections/crew";
import type { ZeropsContainerHealth } from "@t3tools/client-runtime/zerops/provisioning";
import * as NodeFS from "node:fs";
import { act, act as act_, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";

import { useComposerDraftStore } from "~/composerDraftStore";
import { getLocalStorageItem, setLocalStorageItem } from "~/hooks/useLocalStorage";
import type { ZeropsAgentActivity } from "~/zerops/agentActivity";
import { activityFromMemory } from "~/zerops/menuMemory";
import type { ZeropsMateOwner } from "~/zerops/useZeropsMateOwners";
import {
  PROJECT_CUSTOM_ORDER_STORAGE_KEY,
  PROJECT_ORDER_STORAGE_KEY,
  ProjectCustomOrderSchema,
  ProjectOrderSchema,
} from "~/zerops/projectOrderPreference";
import { ZeropsProjectFlowContext, type ZeropsProjectFlowValue } from "~/zerops/projectFlowContext";

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
afterEach(() => {
  // A tree left mounted would answer the next test's asks of the one menu.
  for (const tree of mountedTrees.splice(0)) {
    act(() => {
      tree.unmount();
    });
  }
  stored.collapsed = new Set();
  stored.written = undefined;
  vi.unstubAllGlobals();
});
import {
  groupFlowInputOf,
  groupMemberFactsOf,
  productionAddable,
  type GroupFlowReads,
} from "./projects/projectsView.logic";
import { useSidebarJump } from "~/zerops/sidebarJump";
import { useSidebarReveal } from "~/zerops/sidebarReveal";
import type { SidebarCrewRead } from "./crew/SidebarCrewLine";
import { MateMenu, type MateRowActions } from "./SidebarMateMenu";
import {
  ProjectHeader,
  SidebarNewProject,
  SidebarZeropsTree,
  type SidebarDrawn,
  type SidebarProjectFlow,
} from "./SidebarZeropsTree";
import { groupAddsOffered } from "./ZeropsProjectRow.logic";

function candidate(
  id: string,
  tagList: ReadonlyArray<string>,
  group: ZeropsCandidate["group"] = "ready",
  withContainer = true,
): ZeropsCandidate {
  const base = {
    key: `${id}:zcp`,
    project: { id, name: id, status: "ACTIVE", tagList },
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

/** D6's record of who signed a Mate's agent in: its person, somebody signed in. */
const SIGNER = "mate:signer:claude-code:u-ada";

const CRM_DEV = candidate("crm-dev", [
  "mate",
  "mate:g:aaa",
  "mate:role:dev",
  "mate:name:Beviro CRM",
]);
const CRM_STAGE = candidate("crm-stage", ["mate:g:aaa", "mate:role:stage"], "ready", false);
const CRM_PROD = candidate(
  "crm-prod",
  ["mate:g:aaa", "mate:role:prod", "mate:name:Beviro CRM"],
  "ready",
  false,
);
const LOOSE = candidate("loose", ["mate"]);
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
function named(id: string, name: string, tags: ReadonlyArray<string>, withContainer = true) {
  const base = candidate(id, tags, "ready", withContainer);
  return { ...base, project: { ...base.project, name } } as ZeropsCandidate;
}

const LINKS_TAGS = ["mate:g:links", "mate:name:Links"];
const LINKS_MATE = named("links-dev", "Links - dev", ["mate", ...LINKS_TAGS, "mate:role:dev"]);
const LINKS_STAGE = named(
  "links-stage",
  "Links - stage",
  [...LINKS_TAGS, "mate:role:stage"],
  false,
);
const LINKS_PROD = named(
  "links-prod",
  "Links - production",
  [...LINKS_TAGS, "mate:role:prod"],
  false,
);

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
    // The state is the face's: a Mate whose socket is down sleeps, and no
    // word says "Ready" or "Idle" beside it.
    expect(html).toContain('data-mate-face-state="sleep"');
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

  it("puts the owner's picture before the Mate's name, off its face", () => {
    const jan = { name: "Jan Novák", initials: "JN", avatarUrl: "https://cdn/jan.png" };
    const html = render([CRM_DEV], { getOwner: () => jan });
    const rowAt = html.indexOf('data-zerops-surface="sidebar-mate"');
    const row = html.slice(rowAt, html.indexOf("</button>", rowAt));
    const ownerAt = row.indexOf('data-zerops-surface="sidebar-mate-owner"');
    // On the name's line, right before the name — and nothing on the face's
    // corner any more: its shape stays whole.
    expect(ownerAt).toBeGreaterThan(row.indexOf("</svg>"));
    expect(ownerAt).toBeLessThan(row.indexOf('data-zerops-surface="sidebar-mate-name"'));
    expect(row).toContain('data-zerops-avatar="picture"');
    expect(row).toContain('src="https://cdn/jan.png"');
    expect(row).toContain('class="menu-owner"');
    // The picture is decoration; whose Mate it is is still said.
    expect(row).toContain("Jan Novák&#x27;s Mate");
  });

  it("gives an owner without a picture their initial on their own hue, and an unknown one a plain disc", () => {
    const quiet = { name: "Eva Dvořák", initials: "ED", avatarUrl: null };
    const withInitials = render([CRM_DEV], { getOwner: () => quiet });
    expect(withInitials).toContain('data-zerops-avatar="initials"');
    expect(withInitials).toContain('<span aria-hidden="true">E</span>');
    expect(withInitials).toMatch(/--menu-owner-hue:\d+/u);

    // Somebody its records name, whom the member list has not named: the mark
    // keeps its place, so the name starts where every other one does.
    const signed = candidate("crm-dev", [...CRM_DEV.project.tagList!, SIGNER]);
    const unnamed = render([signed], { getOwner: () => undefined });
    expect(unnamed).toContain('data-zerops-avatar="none"');
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
    // Three inks on one leading, and only the name at full strength: what the
    // Mate was asked in the words' second ink, what it said back muted, both
    // 13/18 with no gap between the lines.
    const subject = html.slice(html.lastIndexOf("<span", subjectAt), subjectAt);
    const snippet = html.slice(html.lastIndexOf("<span", snippetAt), snippetAt);
    expect(subject).toContain("menu-ink-2");
    expect(subject).toContain("text-line leading-4.5");
    expect(subject).not.toContain("mt-");
    expect(snippet).toContain("text-muted-foreground");
    expect(html).toContain('class="grid min-w-0 text-line leading-4.5"');
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
    expect(render([CRM_STAGE], { complete: true })).toContain("sidebar-environments-empty");
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
    expect(html).not.toContain("No environment has Mate yet");
  });

  it('never says "No environment has Mate yet" while a project\'s presence is unknown', () => {
    // The project is listed, but whether a container runs in it is not read yet.
    const html = render([CRM_STAGE], {
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
    const prodWithContainer = candidate("crm-prod", ["mate:g:aaa", "mate:role:prod"], "connected");
    const html = render([CRM_DEV, prodWithContainer]);
    expect(html.match(/data-zerops-surface="sidebar-mate"/gu)).toHaveLength(1);
  });

  it("gives two Mates two colours", () => {
    const html = render([CRM_DEV, LOOSE]);
    const tints = [...html.matchAll(/data-mate-face-tint="([a-z]+)"/gu)].map((match) => match[1]);
    expect(new Set(tints).size).toBe(2);
  });

  it("leaves out a project nobody lives in", () => {
    const html = render([
      CRM_DEV,
      candidate("other", ["mate:g:bbb", "mate:role:dev"], "ready", false),
    ]);
    expect(html).toContain('data-zerops-group="aaa"');
    expect(html).not.toContain('data-zerops-group="bbb"');
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
    const declared = candidate("crm-dev", ["mate", "mate:g:aaa", "mate:role:dev"], "ready", false);
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
      candidates: [CRM_STAGE],
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
    const html = render([CRM_STAGE]);
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
  author: "mate-crm-dev",
  url: `https://gitea.example/crm/appdev/pulls/${number}`,
  checks: "passing",
  checkWord: "Passing",
  mergeability: "mergeable",
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
    tags: ReadonlyArray<string>,
    options: {
      readonly group?: ZeropsCandidate["group"];
      readonly userRoles?: ReadonlyArray<{ clientUserId: string; roleCode: string }>;
    } = {},
  ): ZeropsCandidate => {
    const base = candidate("crm-dev", [...CRM_DEV.project.tagList!, ...tags], options.group);
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

  it("seats nobody's Mate on a dashed ring, and says so in words, never as a person", () => {
    const html = render([mate([], { group: "connected" })], { getOwner: () => undefined });
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
      const html = render([mate([], { group, userRoles: roles.map((id) => OWNER_ROLE(id)) })], {
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

  it("says nothing of signing in once somebody has, or once it was asked something", () => {
    const signed = render([mate([SIGNER], { group: "connected" })], { getOwner: () => KAREL });
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
    const html = render([mate([], { group: "connected" })], {
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
        candidates={[mate([], { group: "connected" })]}
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
      step: "harden",
      overdue: false,
    };
  };
  const comingRows = (html: string) =>
    html.match(/data-zerops-surface="sidebar-mate-coming"/gu) ?? [];

  it("draws a Mate being created after the listed ones: asleep, named, how far it has got, still", () => {
    const html = render([CRM_DEV], { births: [birth()] });
    expect(comingRows(html)).toHaveLength(1);
    const at = html.indexOf('data-zerops-surface="sidebar-mate-coming"');
    expect(html.indexOf('data-zerops-surface="sidebar-mate"')).toBeLessThan(at);
    const row = html.slice(html.lastIndexOf("<div", at));
    expect(row).toContain('aria-busy="true"');
    expect(row).toContain('data-mate-face-state="sleep"');
    expect(row).toContain(">Vera<");
    expect(row).toContain(">Coming up. A few minutes.<");
    expect(row.slice(0, row.indexOf("</div>"))).not.toContain("<button");
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

  it("draws a first project being created in an account with no Mate listed yet", () => {
    const html = render([], { births: [birth({ groupId: "new", groupName: "Todo" })] });
    expect(html).toContain('data-zerops-group="new"');
    expect(comingRows(html)).toHaveLength(1);
    expect(html).not.toContain("No environment has Mate yet");
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
    // Nothing here opens Gitea: the app holds the only token, so every one of
    // its pages is a sign-in page for the person reading this menu. The title
    // opens the change's own page, and the verdict lives in the review: no
    // check dot on the row.
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
  it("offers Review on every change, and never Merge, Ask or a check dot from the row", () => {
    for (const change of [
      pull(4),
      pull(4, { mergeability: "conflicting" }),
      pull(4, { mergeability: "conflicting", checks: "failing", checkWord: "Failing" }),
      pull(4, { mergeability: "conflicting", checks: "pending", checkWord: "Pending" }),
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

  // One meaning per colour (S3): the mark is red where the checks fail,
  // amber where the change fell behind main, and its own grey otherwise.
  it.each([
    { case: "that merges", change: pull(4), tone: undefined, ink: "text-muted-foreground" },
    {
      case: "that fell behind main",
      change: pull(4, { mergeability: "conflicting" }),
      tone: "attention",
      ink: "text-status-attention-text",
    },
    {
      case: "whose checks fail",
      change: pull(4, { mergeability: "conflicting", checks: "failing" }),
      tone: "failed",
      ink: "text-status-failed-text",
    },
  ])("tints only the mark of a change $case", ({ change, tone, ink }) => {
    const html = withFlow([CRM_DEV, CRM_STAGE], flow({ pullRequests: [change] }));
    const row = html.slice(html.indexOf('data-zerops-surface="sidebar-pull-request"') - 400);
    if (tone === undefined) expect(html).not.toContain("data-zerops-change-tone");
    else expect(html).toContain(`data-zerops-change-tone="${tone}"`);
    expect(row).toMatch(new RegExp(`<span class="flex justify-center ${ink}"><svg`, "u"));
  });

  it("offers to set up a stop the recipe has, in the project's menu rather than as a row", () => {
    const html = withFlow(
      [CRM_DEV],
      flow({
        missing: [
          {
            kind: "missing-environment",
            tier: "production",
            name: "Production",
            line: "not set up yet",
          },
        ],
      }),
    );
    // Not every project wants one, and a permanent row asking for something
    // optional reads as a fault (the owner, 2026-09-19).
    expect(html).not.toContain('data-zerops-surface="sidebar-environment-missing"');
    expect(html).toContain('data-zerops-surface="sidebar-project-more"');
  });

  it("says nothing about missing stops when the recipe offers none", () => {
    expect(withFlow([CRM_DEV])).not.toContain('data-zerops-surface="sidebar-environment-missing"');
  });

  // A project needs no production (the owner, 2026-09-28: "production not
  // required, this shouldn't be there"): the page may offer it, the menu
  // never marks it as something waiting.
  it("never dots a project for the production it does not have", () => {
    const missing = [
      {
        kind: "missing-environment" as const,
        tier: "production" as const,
        name: "Production",
        line: "not set up yet",
      },
    ];
    // The Mate has been spoken to, so an empty flow asks for no first task —
    // isolating *Add production* as the only thing that could put a dot on
    // the heading.
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
    const getActivity = () => activity;
    const withMergedCode = flow({ pullRequests: [], merged: [pull(4, { merged: true })], missing });
    // Neither half alone is enough: without `merged` this tree never sees
    // main's code, and without `mayCreate` it never offers what it cannot
    // check the person may create — the page's own gate, wired here too
    // rather than only there.
    expect(
      render([CRM_DEV_CONNECTED], {
        mayCreate: true,
        getActivity,
        getFlow: () => flow({ pullRequests: [], missing }),
      }),
    ).not.toContain("main has code, no production yet");
    expect(
      render([CRM_DEV_CONNECTED], { getActivity, getFlow: () => withMergedCode }),
    ).not.toContain("main has code, no production yet");
    const html = render([CRM_DEV_CONNECTED], {
      mayCreate: true,
      getActivity,
      getFlow: () => withMergedCode,
    });
    expect(html).not.toContain('data-zerops-surface="sidebar-project-next-step"');
    expect(html).not.toContain("main has code, no production yet");
  });

  it("folds a Mate's pull requests behind a count once there are more than three", () => {
    const html = withFlow(
      [CRM_DEV, CRM_STAGE],
      flow({ pullRequests: [pull(1), pull(2), pull(3), pull(4)] }),
    );
    expect(html).toContain("4 pull requests");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('data-zerops-surface="sidebar-pull-request"');
    // Three read at a glance.
    const three = withFlow(
      [CRM_DEV, CRM_STAGE],
      flow({ pullRequests: [pull(1), pull(2), pull(3)] }),
    );
    expect(three).not.toContain("pull requests");
    expect(three.match(/data-zerops-surface="sidebar-pull-request"/gu)).toHaveLength(3);
  });

  it("lists a person's own pull request after the Mates, never under one", () => {
    const html = withFlow(
      [CRM_DEV, CRM_STAGE],
      flow({
        pullRequests: [
          pull(7, { mateProjectId: undefined, author: "ada", line: "appdev #7 · ada" }),
        ],
      }),
    );
    expect(html).toContain('data-zerops-surface="sidebar-other-pull-requests"');
    expect(html).toContain("#7 Change 7 · ada");
    expect(html).not.toContain('data-zerops-surface="sidebar-pull-requests"');
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

  it("keeps a recipe change out of the Mate's own pull-request list — only code moves through the shared flow", () => {
    // The `fsadfdasfsa`-class bug is two surfaces reading the pull requests
    // two different ways; this tree now reads them the one way `groupFlow`
    // does, which counts a recipe change as the group repo's, not a Mate's.
    const html = withFlow(
      [CRM_DEV, CRM_STAGE],
      flow({ pullRequests: [pull(4, { kind: "recipe" })] }),
    );
    expect(html).not.toContain('data-zerops-surface="sidebar-pull-request"');
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
  const crew = (): SidebarCrewRead => {
    const fixture = crewSnapshotFixture();
    const view = deriveCrewView(fixture, [], () => {
      throw new Error("no shells here");
    });
    return { status: "applied", view, attention: [] };
  };
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

// Signed in, so Gitea is coming — but none of its reads has answered.
const SIGNED_IN = {
  deployments: new Map([
    [
      "crm-prod",
      {
        state: "known",
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
  signedIn: true,
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

  it("says what waits for production in words, and stays neutral: nothing is wrong", () => {
    const html = render([CRM_DEV, up(CRM_PROD)], {
      getFlow: () =>
        flow({
          releaseOffered: true,
          releaseContents: [
            {
              commits: [
                { sha: "a", subject: "Search box" },
                { sha: "b", subject: "Cart badge" },
              ],
            },
          ],
        }),
    });
    expect(chipsOf(html)).toEqual([
      { word: "prod", tone: "neutral", words: "Production v2.4.0, 2 changes waiting" },
    ]);
  });

  it("turns production amber when the newest release did not go through, the old one serving", () => {
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
      { word: "prod", tone: "amber", words: "Production v2.4.0, the last release failed" },
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

  it("draws the chips it remembers while what decides them is unread, and else nothing", () => {
    const remembering = {
      changes: () => undefined,
      chips: () => ({
        prod: { label: "prod", state: "failed", version: "v2.3.0" },
        stage: { label: "stage", state: "ok", version: "main" },
      }),
    };
    // The platform has not said how the stops' services stand.
    const unread = render([CRM_DEV, CRM_STAGE, CRM_PROD], {
      getFlow: () => flow(),
      remembered: remembering,
    });
    expect(chipsOf(unread).map((chip) => [chip.word, chip.tone])).toEqual([
      ["stage", "neutral"],
      ["prod", "amber"],
    ]);
    expect(render([CRM_DEV, CRM_STAGE, CRM_PROD], { getFlow: () => flow() })).not.toContain(
      "sidebar-production-chip",
    );
  });

  it("draws what the platform alone says while Gitea keeps not answering, and never keeps it", () => {
    const drawn: SidebarDrawn[] = [];
    const tree = mount(
      <ZeropsProjectFlowContext.Provider value={SIGNED_IN}>
        <SidebarZeropsTree
          candidates={[CRM_DEV, up(CRM_PROD)]}
          complete
          onBrowseProjects={() => {}}
          onDrawn={(next: SidebarDrawn) => drawn.push(next)}
          onSelect={() => {}}
        />
      </ZeropsProjectFlowContext.Provider>,
    );
    const chips = tree.root.findAll(
      (node) =>
        node.type === "button" && node.props["data-zerops-surface"] === "sidebar-production-chip",
    );
    expect(chips.map((chip) => chip.props["aria-label"])).toEqual(["Production v2.4.0, healthy"]);
    // Production is unknown, not learned; there is no stage, which is.
    expect(drawn.at(-1)?.chips).toEqual({ aaa: { stage: null } });
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
    const notes = named("notes-dev", "Notes - dev", [
      "mate",
      "mate:g:notes",
      "mate:name:Notes",
      "mate:role:dev",
    ]);
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
    const notes = named("notes-dev", "Notes - dev", [
      "mate",
      "mate:g:notes",
      "mate:name:Notes",
      "mate:role:dev",
    ]);
    const two = { ...named("crm-b", "CRM - b", ["mate", "mate:g:aaa", "mate:role:dev"]) };
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
    const notes = named("notes-dev", "Notes - dev", [
      "mate",
      "mate:g:notes",
      "mate:name:Notes",
      "mate:role:dev",
    ]);
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
      { ...named("crm-a", "CRM - a", ["mate", "mate:g:aaa", "mate:role:dev", "mate:bot:Ada"]) },
      { ...named("crm-b", "CRM - b", ["mate", "mate:g:aaa", "mate:role:dev", "mate:bot:Bo"]) },
      { ...named("crm-c", "CRM - c", ["mate", "mate:g:aaa", "mate:role:dev", "mate:bot:Cy"]) },
    ].map((item) => ({ ...item, group: "connected" }) as ZeropsCandidate);
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
    const { remembered: _stoodIn, ...read } = activityFromMemory({
      subject: "Something",
      at: "2026-09-27T10:00:00.000Z",
      unread: true,
      threadId: "thread-1",
      threadKey: "env-crm-dev:thread-1",
    });
    const tree = (item: ZeropsCandidate, activity: ZeropsAgentActivity) => (
      <SidebarZeropsTree
        candidates={[item]}
        complete
        getActivity={() => activity}
        onBrowseProjects={() => {}}
        onSelect={() => {}}
      />
    );
    const mounted = mount(
      tree(
        CRM_DEV,
        activityFromMemory({
          subject: "Something",
          at: "2026-09-27T10:00:00.000Z",
          unread: true,
          threadId: "thread-1",
          threadKey: "env-crm-dev:thread-1",
        }),
      ),
    );
    act(() => {
      mounted.update(tree(CRM_DEV_CONNECTED, { ...read, kind: "input", face: "needs" }));
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
  const NAMED = candidate("crm-dev", [
    "mate",
    "mate:g:aaa",
    "mate:role:dev",
    "mate:name:Beviro CRM",
    "mate:bot:Ada",
  ]);
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

  it("is asleep for a container nobody has connected to", () => {
    const html = render([NAMED]);
    expect(html).toContain('data-mate-face-state="sleep"');
    expect(html).not.toContain(">Ready<");
  });

  it("stays asleep while a registered environment's socket comes up — the face wakes with the socket", () => {
    const connecting: ZeropsCandidate & {
      readonly connection: { phase: "connecting"; error: null; traceId: null };
    } = { ...NAMED, connection: { phase: "connecting", error: null, traceId: null } };
    const html = render([connecting]);
    expect(html).toContain('data-mate-face-state="sleep"');
    expect(html).not.toContain(">Connecting<");
  });
});

describe("the sidebar and the projects page read one group the same way", () => {
  const PRODUCTION_MISSING: ReadonlyArray<MissingEnvironmentRow> = [
    { kind: "missing-environment", tier: "production", name: "Production", line: "not set up yet" },
  ];
  const reads = (over: Partial<GroupFlowReads> = {}): GroupFlowReads => ({
    environments: [],
    pullRequests: [],
    merged: [],
    missing: [],
    release: {
      gate: { allowed: false, reason: "Nothing to release." },
      suggestion: "",
      contents: [],
    },
    ...over,
  });
  const UP = new Map<string, ZeropsContainerHealth>([[CRM_DEV.key, "ready"]]);
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly candidates: ReadonlyArray<ZeropsCandidate>;
    readonly reads: GroupFlowReads;
    readonly health: ReadonlyMap<string, ZeropsContainerHealth>;
    readonly mayCreate: boolean;
    readonly expected: GroupNextStepKind;
  }> = [
    {
      name: "a mergeable change asks for the merge",
      candidates: [CRM_DEV],
      reads: reads({ pullRequests: [pull(4)] }),
      health: UP,
      mayCreate: true,
      expected: "merge",
    },
    {
      name: "merged code with no production, a Mate up, offers Add production",
      candidates: [CRM_DEV],
      reads: reads({ merged: [pull(4, { merged: true })], missing: PRODUCTION_MISSING }),
      health: UP,
      mayCreate: true,
      expected: "add-production",
    },
    {
      name: "the same with no Mate up offers nothing yet",
      candidates: [CRM_DEV],
      reads: reads({ merged: [pull(4, { merged: true })], missing: PRODUCTION_MISSING }),
      health: new Map(),
      mayCreate: true,
      expected: "none",
    },
    {
      name: "the same for a viewer who may not create offers nothing",
      candidates: [CRM_DEV],
      reads: reads({ merged: [pull(4, { merged: true })], missing: PRODUCTION_MISSING }),
      health: UP,
      mayCreate: false,
      expected: "none",
    },
    {
      name: "a production the recipe does not declare is not added twice",
      candidates: [CRM_DEV, CRM_PROD],
      reads: reads({ merged: [pull(4, { merged: true })], missing: PRODUCTION_MISSING }),
      health: UP,
      mayCreate: true,
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
          contents: [{ commits: [{ sha: "a".repeat(40), subject: "Add a field" }] }],
        },
      }),
      health: UP,
      mayCreate: true,
      expected: "release",
    },
  ];

  it.each(cases)("$name", ({ candidates, reads: groupReads, health, mayCreate, expected }) => {
    const group = buildZeropsGroupTree(candidates, { order: "name" }).groups[0]!;
    const page = groupFlow(
      groupFlowInputOf({
        groupId: group.group.groupId,
        members: groupMemberFactsOf(
          group.environments,
          () => undefined,
          () => false,
        ),
        flow: groupReads,
        deployments: new Map(),
        productionAddable: productionAddable({
          group: group.group,
          mayCreate,
          addsOffered: groupAddsOffered(group.environments, health),
        }),
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
      missing: groupReads.missing,
      releaseTag: groupReads.release.suggestion,
    };
    // The heading carries no step of its own any more (M15): its rows, its
    // faces and its production chip say what waits, each where it is.
    const html = render(candidates, { getFlow: () => sidebar, health, mayCreate });
    expect(html).not.toContain("sidebar-project-next-step");
  });
});

describe("arranging the projects by hand", () => {
  /** The stylesheet the heading's band is drawn by, without its comments. */
  const STYLESHEET = NodeFS.readFileSync(
    new URL("../../index.css", import.meta.url),
    "utf8",
  ).replace(/\/\*[\s\S]*?\*\//gu, "");
  const SHOP_MATE = named("shop-dev", "Shop - dev", [
    "mate",
    "mate:g:shop",
    "mate:name:Shop",
    "mate:role:dev",
  ]);
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
    /<span[^>]*data-zerops-surface="sidebar-mate-time"[^>]*>(.*?)<\/span>/u.exec(html)?.[0] ?? "";

  // The working face turns and glances, and its step is the row's third
  // line: no ring around it repeats the step as a count in blue (S3).
  it("rings no working face", () => {
    expect(row(working())).not.toContain("plan-ring");
  });

  // A running clock is not something to click, so it is not blue (S3): it
  // counts up in ink where the age was.
  it("counts up how long it has been working, in ink, where its age was", () => {
    const time = slot(row(working()));
    expect(time).toContain("3:12");
    expect(time).toContain("text-sidebar-foreground");
    expect(time).not.toContain("text-status-busy-text");
    expect(slot(row(live()))).toContain(">2h<");
  });

  // Work left running in the background wears the working face and offers
  // Stop: its slot counts it up as any working face's does, never a grey age
  // beside a working face (the approved menu; the 2026-09-28 audit's gap).
  it("counts up work left running in the background, as it counts a run", () => {
    const time = slot(row(working({ kind: "monitoring" })));
    expect(time).toContain("3:12");
    expect(time).toContain("text-sidebar-foreground");
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
      activity: working({ liveStep: { words: "Compile the gallery", code: "npm run compile" } }),
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
      activity: working({ liveStep: { words: "Compile the gallery", code: "npm run compile" } }),
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
    const html = row(activity);
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

  it("writes the live step's command in mono under the sweep", () => {
    const html = row(
      working({ liveStep: { words: "Compile the gallery", code: "npm run compile" } }),
    );
    expect(html).toContain('data-run-shimmer=""');
    expect(html).toContain('Compile the gallery · <span class="font-mono">npm run compile</span>');
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
    afterEach(() => {
      useComposerDraftStore.getState().setPrompt(ref, "");
    });

    it("leads the last line with Draft:, in place of the last words", () => {
      useComposerDraftStore.getState().setPrompt(ref, "also check the thumbnails");
      // Mounted, not drawn once: a store read on the server answers with its
      // first state, never the draft written since.
      const mounted = mount(
        <SidebarZeropsTree
          candidates={[CRM_DEV_CONNECTED]}
          complete
          getActivity={() => live()}
          onBrowseProjects={() => {}}
          onSelect={() => {}}
        />,
      );
      const snippet = text(surface(mounted, "sidebar-mate-snippet"));
      expect(snippet).toBe("Draft: also check the thumbnails");
    });

    // Where the last line waits for the Mate's words, an unsent draft is the
    // more pressing thing to say there: the face and the clock say it works.
    it("stands in the line kept for words still to come", () => {
      useComposerDraftStore.getState().setPrompt(ref, "also check the thumbnails");
      const mounted = mount(
        <SidebarZeropsTree
          candidates={[CRM_DEV_CONNECTED]}
          complete
          getActivity={() => working({ snippet: undefined })}
          onBrowseProjects={() => {}}
          onSelect={() => {}}
        />,
      );
      expect(text(surface(mounted, "sidebar-mate-snippet"))).toBe(
        "Draft: also check the thumbnails",
      );
    });

    it("never grows a row that has no last words: the composer holds the draft", () => {
      useComposerDraftStore.getState().setPrompt(ref, "also check the thumbnails");
      const html = row(live({ snippet: undefined }));
      expect(html).not.toContain("sidebar-mate-snippet");
      expect(html).not.toContain("Draft:");
    });
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
  const crew = (status: "none" | "applied"): SidebarCrewRead => {
    const fixture = crewSnapshotFixture({ status });
    return {
      status,
      view:
        status === "none"
          ? null
          : deriveCrewView(fixture, [], () => {
              throw new Error("no shells here");
            }),
      attention: [],
    };
  };
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
    ...named("crm-old", "CRM - old", ["mate", "mate:g:aaa", "mate:role:dev", "mate:bot:Olga"]),
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
    expect(names(html)).toEqual(["Olga", "crm-dev"]);
    expect(html).not.toContain("quiet Mate");
  });

  it("lists only the Mates the viewer asked for, and leaves out a project where none remains", () => {
    const LINKS_CONNECTED = { ...LINKS_MATE, group: "connected" } as ZeropsCandidate;
    const html = render([CRM_DEV_CONNECTED, LINKS_CONNECTED], {
      getActivity: () => act(),
      shown: (item: ZeropsCandidate) => item.project.id === "links-dev",
    });
    expect(names(html)).toEqual(["Links - dev"]);
    expect(html).not.toContain('data-zerops-group="aaa"');
  });

  it("stops a working Mate with x and marks one read or unread with e, from its row", () => {
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
  const ADAS = pull(6, { mateProjectId: undefined, author: "ada", title: "Bump the linter" });
  // Its stops' services read, so the heading draws its chip.
  const tree = (props: Record<string, unknown> = {}) => (
    <SidebarZeropsTree
      candidates={[LINKS_MATE, up(LINKS_STAGE), up(LINKS_PROD)]}
      complete
      getFlow={() => linksFlow([OWN, ADAS])}
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
      ["appdev#6", "#6 Bump the linter · ada", undefined, "ada"],
    ]);
    expect(index()?.stops.map((stop) => [stop.projectId, stop.title])).toEqual([
      ["links-stage", "Links stage"],
      ["links-prod", "Links production"],
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
    const THEO = named("links-theo", "Links - theo", ["mate", ...LINKS_TAGS, "mate:role:dev"]);
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

describe("a reload paints what the menu last drew (menuMemory)", () => {
  const known = (label: string): Shown<Deployment> => ({
    state: "known",
    value: {
      kind: "running",
      activatedAt: null,
      version: {
        name: label,
        commit: "3f9c1b2",
        sha: "3f9c1b2000000000000000000000000000000000",
        taggedBy: undefined,
        label,
      },
    },
    asOf: { ordinal: 1, atMs: 0 },
    coverage: "complete",
    freshness: { kind: "live" },
  });
  const flowOf = (overrides: Partial<SidebarProjectFlow>): SidebarProjectFlow => ({
    pullRequests: [],
    environments: new Map(),
    releaseOffered: false,
    ...overrides,
  });
  const remembering = (changes: ReadonlyArray<FlowPullRequest> | undefined) => ({
    changes: () => changes,
    chips: () => undefined,
  });
  const running = (label: string) =>
    ({
      deployments: new Map([["crm-prod", known(label)]]),
      flows: new Map(),
    }) as unknown as ZeropsProjectFlowValue;
  const RUNS_V250 = running("v2.5.0");

  it("draws a Mate whose socket is not open with the words this browser remembers — asleep, offering nothing", () => {
    const html = render([CRM_DEV, CRM_PROD], {
      getActivity: () =>
        activityFromMemory({
          subject: "Add a /status page",
          snippet: "The page reads the build number.",
          at: "2026-09-27T10:00:00.000Z",
          unread: false,
          threadId: "thread-1",
          threadKey: "env-crm-dev:thread-1",
        }),
    });
    expect(html).toContain("Add a /status page");
    expect(html).toContain("The page reads the build number.");
    expect(html).toContain('data-mate-face-state="sleep"');
    expect(html).not.toContain('data-zerops-surface="sidebar-mate-stop"');
  });

  it("still draws nothing it heard through a socket that is not open now", () => {
    const html = render([CRM_DEV, CRM_PROD], {
      getActivity: (): ZeropsAgentActivity => ({
        ...activityFromMemory({
          subject: "Add a /status page",
          at: "2026-09-27T10:00:00.000Z",
          unread: false,
          threadId: "thread-1",
          threadKey: "env-crm-dev:thread-1",
        }),
        remembered: undefined as never,
      }),
    });
    expect(html).not.toContain("Add a /status page");
  });

  it("draws the change rows it remembers until Gitea answers: their titles, and no verb", () => {
    const html = render([CRM_DEV, CRM_PROD], {
      getFlow: () => flowOf({ changesKnown: false }),
      remembered: remembering([pull(14, { title: "Add a /status page" })]),
    });
    expect(html).toContain("#14 Add a /status page");
    // No verdict it may no longer have: the mark is untinted, and the title
    // opens nothing until Gitea answers. *Review* stands, so nothing appears
    // on the row when the answer comes.
    expect(html).not.toContain("data-zerops-change-tone");
    expect(html).not.toContain("sidebar-pull-request-open");
    expect(html).toContain('data-zerops-surface="sidebar-pull-request-review"');
  });

  it("draws Gitea's change rows once it answered, and never the remembered ones", () => {
    const html = render([CRM_DEV, CRM_PROD], {
      getFlow: () => flowOf({ changesKnown: true, pullRequests: [pull(15, { title: "Live" })] }),
      remembered: remembering([pull(14, { title: "Remembered" })]),
    });
    expect(html).toContain("#15 Live");
    expect(html).not.toContain("Remembered");
    expect(html).toContain('data-zerops-surface="sidebar-pull-request-review"');
  });

  it("reports what it drew of what it read, for the memory to keep", () => {
    const drawn: SidebarDrawn[] = [];
    const change = pull(4);
    mount(
      <ZeropsProjectFlowContext.Provider value={RUNS_V250}>
        <SidebarZeropsTree
          candidates={[CRM_DEV, up(CRM_PROD)]}
          complete
          getFlow={() => flowOf({ changesKnown: true, pullRequests: [change] })}
          onBrowseProjects={() => {}}
          onDrawn={(next: SidebarDrawn) => drawn.push(next)}
          onSelect={() => {}}
        />
      </ZeropsProjectFlowContext.Provider>,
    );
    expect(drawn.at(-1)).toEqual({
      changes: { aaa: [change] },
      chips: { aaa: { prod: { label: "prod", state: "ok", version: "v2.5.0" }, stage: null } },
    });
  });
});

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
import type { Deployment } from "@t3tools/client-runtime/zerops/flow";
import type { Shown } from "@t3tools/client-runtime/zerops/knowledge";
import type { CandidatesNotice } from "@t3tools/client-runtime/zerops/projections";
import type { ZeropsContainerHealth } from "@t3tools/client-runtime/zerops/provisioning";
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
  nextStepAwaitsSomebody,
  nextStepTone,
  productionAddable,
  type GroupFlowReads,
} from "./projects/projectsView.logic";
import { PortalGate } from "../ui/portal-gate";
import { useSidebarJump } from "~/zerops/sidebarJump";
import { useSidebarPeek } from "~/zerops/sidebarPeek";
import { MateMenu, type MateRowActions } from "./SidebarMateMenu";
import {
  ProjectHeader,
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

/** One stop's row, from its project id to the end of its own line item. */
const stop = (html: string, id: string) =>
  html.slice(html.indexOf(`data-zerops-project="${id}"`)).split("</li>")[0]!;

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
    // The Mate is the heaviest node on the spine, so its face is the card's
    // size, not the 20px a name in a row of text gets.
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
    expect(row).toContain("rounded-md");
    // Lit from its row, so it stays lit while the pointer is on its menu.
    expect(row).toContain("group-hover/mate:bg-sidebar-row-hover");
    expect(row).not.toContain("border");
  });

  it("pins the owner's picture to the corner of the Mate's face", () => {
    const jan = { name: "Jan Novák", initials: "JN", avatarUrl: "https://cdn/jan.png" };
    const html = render([CRM_DEV], { getOwner: () => jan });
    const rowAt = html.indexOf('data-zerops-surface="sidebar-mate"');
    const row = html.slice(rowAt, html.indexOf("</button>", rowAt));
    const ownerAt = row.indexOf('data-zerops-surface="sidebar-mate-owner"');
    // In the Mate's own row, after the face, so it is painted on top of it.
    expect(ownerAt).toBeGreaterThan(row.indexOf('data-zerops-primitive="mate-face"'));
    expect(row).toContain('data-zerops-avatar="picture"');
    expect(row).toContain('src="https://cdn/jan.png"');
    // The picture is decoration; whose Mate it is is still said.
    expect(row).toContain("Jan Novák&#x27;s Mate");
  });

  it("gives an owner without a picture their initials, and a Mate without one no badge", () => {
    const quiet = { name: "Eva Dvořák", initials: "ED", avatarUrl: null };
    const withInitials = render([CRM_DEV], { getOwner: () => quiet });
    expect(withInitials).toContain('data-zerops-avatar="initials"');
    expect(withInitials).toContain(">ED<");

    const nobody = render([CRM_DEV], { getOwner: () => undefined });
    expect(nobody).not.toContain('data-zerops-surface="sidebar-mate-owner"');
    expect(nobody).not.toContain('data-zerops-primitive="avatar"');
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
      progress: undefined,
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
      progress: undefined,
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
    // Three tones, and only the name is at full strength: what the Mate was
    // asked and what it said back are both previews and both recede.
    const subject = html.slice(html.lastIndexOf("<span", subjectAt), subjectAt);
    const snippet = html.slice(html.lastIndexOf("<span", snippetAt), snippetAt);
    expect(subject).toContain('text-sidebar-muted-foreground"');
    expect(snippet).toContain("text-sidebar-muted-foreground/70");
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

  it("lights the open Mate's row the way the menu lights its open thread", () => {
    const html = render([CRM_DEV], { activeProjectId: "crm-dev" });
    expect(html).toContain('aria-current="true"');
    expect(html).toContain("bg-sidebar-row-active");
  });

  it("lists the stage then production after the Mates, one row each, the Mate's own left out", () => {
    const html = render([CRM_DEV, CRM_STAGE, CRM_PROD]);
    expect(html).toContain('data-zerops-surface="sidebar-environment-rows"');
    // One stop, one row: the stage is the same row production is (the owner,
    // 2026-09-25), not a muted line of its own.
    expect(html.match(/data-zerops-surface="sidebar-environment"/gu)).toHaveLength(2);
    expect(html).not.toContain("sidebar-group-stage");
    // The order the code travels: the Mate, the stage, then production.
    expect(html.indexOf('data-zerops-surface="sidebar-mate"')).toBeLessThan(
      html.indexOf('data-zerops-project="crm-stage"'),
    );
    expect(html.indexOf('data-zerops-project="crm-stage"')).toBeLessThan(
      html.indexOf('data-zerops-project="crm-prod"'),
    );
    // Nothing folds the stops away: a project collapses as a whole instead.
    expect(html).not.toContain("sidebar-stops-fold");
    expect(html).not.toContain("Hide the production");
    // A project whose only environment is its Mate's has no stops to list.
    expect(render([CRM_DEV])).not.toContain("sidebar-environment-rows");
  });

  it("never draws a stage row where the group has none — no empty or add slot", () => {
    const html = render([CRM_DEV, CRM_PROD]);
    expect(html).not.toContain('data-zerops-project="crm-stage"');
    expect(html.match(/data-zerops-surface="sidebar-environment"/gu)).toHaveLength(1);
  });

  it("draws every group stage before production, each by its own name", () => {
    const secondStage = named(
      "links-stage-2",
      "Links - stage 2",
      [...LINKS_TAGS, "mate:role:stage"],
      false,
    );
    const html = render([LINKS_MATE, LINKS_STAGE, secondStage, LINKS_PROD]);
    const prodAt = html.indexOf('data-zerops-project="links-prod"');
    const stage1At = html.indexOf('data-zerops-project="links-stage"');
    const stage2At = html.indexOf('data-zerops-project="links-stage-2"');
    expect(stage1At).toBeLessThan(stage2At);
    expect(stage2At).toBeLessThan(prodAt);
    expect(html).toContain(">stage<");
    expect(html).toContain(">stage 2<");
  });

  it("says a stop by its role, not the project's name a third time", () => {
    const html = render([LINKS_MATE, LINKS_STAGE, LINKS_PROD]);
    // The heading already says Links; the pill says what tells them apart.
    expect(stop(html, "links-stage")).toContain(">stage<");
    expect(stop(html, "links-prod")).toContain(">prod<");
    expect(html).not.toContain("Links - stage");
    expect(html).not.toContain(">Links - production<");
  });

  it("drops the name where it only says the role the pill already says", () => {
    const html = render([LINKS_MATE, LINKS_STAGE, LINKS_PROD]);
    const production = stop(html, "links-prod");
    expect(production).toContain('data-zerops-surface="role-tag"');
    expect(production).not.toContain(">production<");
  });

  it("keeps the role pill where a chosen name says nothing about the role", () => {
    const euWest = named("links-eu", "Links - eu-west", [...LINKS_TAGS, "mate:role:prod"], false);
    const html = render([LINKS_MATE, euWest]);
    expect(html).toContain(">eu-west<");
    expect(html).toContain(String.raw`data-zerops-surface="role-tag"`);
  });

  it("hangs the stops off the project rather than off the Mate above them", () => {
    const html = render([LINKS_MATE, LINKS_STAGE, LINKS_PROD]);
    const list = html.slice(html.indexOf('data-zerops-surface="sidebar-environment-rows"') - 200);
    // The project's own left edge, and the spine running down through it: the
    // stops are the project's, whichever Mate happens to be listed last. A
    // rule across the list used to say so and cut the spine doing it.
    expect(list).toContain("px-2.5");
    expect(list).not.toContain("border-t");
    // Each stop is a node on the same line the Mates hang on.
    expect(list).toContain("self-stretch");
  });

  it("never makes production a Mate, whatever runs in it", () => {
    const prodWithContainer = candidate("crm-prod", ["mate:g:aaa", "mate:role:prod"], "connected");
    const html = render([CRM_DEV, prodWithContainer]);
    expect(html.match(/data-zerops-surface="sidebar-mate"/gu)).toHaveLength(1);
    expect(html.match(/data-zerops-surface="sidebar-environment"/gu)).toHaveLength(1);
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

  it("draws a production being created as setting up, busy, after the stage, with nothing to press", () => {
    const html = render([CRM_DEV, CRM_STAGE], {
      births: [birth({ projectId: "crm-prod-new", kind: "production", displayName: "production" })],
    });
    const at = html.indexOf('data-zerops-project="crm-prod-new"');
    expect(at).toBeGreaterThan(html.indexOf('data-zerops-project="crm-stage"'));
    const row = html.slice(html.lastIndexOf("<li", at)).split("</li>")[0]!;
    expect(row).toContain('aria-busy="true"');
    expect(row).toContain('data-zerops-status-tone="pending"');
    expect(row).toContain(">prod<");
    expect(row).toContain(">Setting up production…<");
    expect(row).not.toContain("<button");
    expect(comingRows(html)).toHaveLength(0);
  });

  it("draws a stage being created in the row production's creation wears, before production", () => {
    const html = render([CRM_DEV, CRM_PROD], {
      births: [birth({ projectId: "crm-stage-new", kind: "stage", displayName: "stage" })],
    });
    const at = html.indexOf('data-zerops-project="crm-stage-new"');
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(html.indexOf('data-zerops-project="crm-prod"'));
    const row = html.slice(html.lastIndexOf("<li", at)).split("</li>")[0]!;
    expect(row).toContain('aria-busy="true"');
    expect(row).toContain('data-zerops-status-tone="pending"');
    expect(row).toContain(">stage<");
    expect(row).toContain(">Setting up a stage…<");
    expect(row).not.toContain("↳");
    expect(row).not.toContain("<button");
  });

  it("draws a stop being created on one line: its badge, its role pill and its word", () => {
    const html = render([CRM_DEV], {
      births: [
        birth({ projectId: "crm-prod-new", kind: "production", displayName: "production" }),
        birth({ projectId: "crm-qa-new", kind: "stage", displayName: "qa" }),
      ],
    });
    const row = (id: string) => {
      const at = html.indexOf(`data-zerops-project="${id}"`);
      return html.slice(html.lastIndexOf("<li", at)).split("</li>")[0]!;
    };
    const production = row("crm-prod-new");
    expect(/^<li[^>]*>/u.exec(production)?.[0]).toContain("h-8");
    expect(production).toContain('data-zerops-surface="role-tag"');
    expect(production).toContain(">prod<");
    // The name says the role the pill already says, so only the pill does.
    expect(production).not.toContain(">production<");
    expect(production.indexOf(">Setting up production…<")).toBeGreaterThan(
      production.indexOf(">prod<"),
    );
    // A stage named for something else keeps its name after the pill.
    const qa = row("crm-qa-new");
    expect(qa.indexOf(">qa<")).toBeGreaterThan(qa.indexOf(">stage<"));
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
    merging: () => false,
    releasing: false,
    onMerge: () => {},
    onRelease: () => {},
    ...overrides,
  });
  const withFlow = (candidates: ReadonlyArray<ZeropsCandidate>, state = flow()) =>
    render(candidates, { getFlow: () => state });

  it("hangs the Mate's open pull requests under it, before the environments", () => {
    const html = withFlow([CRM_DEV, CRM_STAGE, CRM_PROD]);
    expect(html).toContain('data-zerops-surface="sidebar-pull-request"');
    expect(html).toContain("#4 Change 4");
    expect(html.indexOf('data-zerops-surface="sidebar-mate"')).toBeLessThan(
      html.indexOf("#4 Change 4"),
    );
    expect(html.indexOf("#4 Change 4")).toBeLessThan(html.indexOf("crm-stage"));
    // Nothing here opens Gitea: the app holds the only token, so every one of
    // its pages is a sign-in page for the person reading this menu. The title
    // opens the change's own page. The checks are a dot, not a word.
    expect(html).not.toContain("gitea.example");
    expect(html).toContain('aria-label="Passing"');
    expect(html).not.toContain(">Passing</span>");
  });

  // The menu has one text column (the owner, 2026-09-25: "everything jumps
  // around differently"): a Mate's name, a change's title and a stop's pill
  // start on it. A change's cell is wider — the spine, its branch and dot —
  // so its gap is narrower: at the Mates' gap its title stood 4 px right of
  // the column (57 against 53 px, measured 2026-09-28).
  it("starts a change's title on the menu's one text column, as a Mate's name and a stop's pill", () => {
    const html = withFlow([CRM_DEV, CRM_STAGE, CRM_PROD]);
    const PX: Record<string, number> = {
      "w-5": 20,
      "w-7": 28,
      "gap-1.5": 6,
      "gap-2.5": 10,
      "gap-3.5": 14,
    };
    const inset = (tag: string | undefined, cell: string | undefined) => {
      const gap = /\bgap-[\d.]+\b/u.exec(tag ?? "")?.[0] ?? "";
      const width = /\bw-[57]\b/u.exec(cell ?? "")?.[0] ?? "";
      return (PX[width] ?? Number.NaN) + (PX[gap] ?? Number.NaN);
    };
    const mate =
      /<button class="([^"]*)"[^>]*data-zerops-surface="sidebar-mate"[^>]*><span class="([^"]*)"/u.exec(
        html,
      );
    const change =
      /<li class="([^"]*)"[^>]*data-zerops-surface="sidebar-pull-request"[^>]*><span class="([^"]*)"/u.exec(
        html,
      );
    const stop =
      /<li class="([^"]*)"[^>]*data-zerops-surface="sidebar-environment"[^>]*><span class="([^"]*)"/u.exec(
        html,
      );
    expect(inset(mate?.[1], mate?.[2])).toBe(34);
    expect(inset(stop?.[1], stop?.[2])).toBe(34);
    expect(inset(change?.[1], change?.[2])).toBe(34);
  });

  it("hands a change nobody here can fix back to the Mate that wrote it", () => {
    const stale = flow({
      pullRequests: [pull(4, { mergeability: "conflicting" })],
      onAsk: () => {},
    });
    const html = withFlow([CRM_DEV, CRM_STAGE], stale);
    // The words that name the problem are the way to hand it over: a rebase
    // happens in the Mate's checkout, not in this menu.
    expect(html).toContain('data-zerops-primary-action="Ask"');
    // One casing down the column: it sat beside `Release` reading `needs a
    // rebase`, two verbs in the same list opening differently.
    expect(html).toContain("Needs a rebase");
    // And it wears what it is about, so a rebase and a failed check are not
    // the same grey pill.
    expect(html).toContain("--zerops-status-attention-surface");
    expect(html).toContain("Rebase it on main");
    // Without a way to ask, the state stays a label rather than becoming a
    // verb that goes nowhere.
    expect(
      withFlow(
        [CRM_DEV, CRM_STAGE],
        flow({ pullRequests: [pull(4, { mergeability: "conflicting" })] }),
      ),
    ).not.toContain('data-zerops-primary-action="Ask"');
    // Checks still running are the one refusal with nothing to ask for.
    expect(
      withFlow(
        [CRM_DEV, CRM_STAGE],
        flow({
          pullRequests: [
            pull(4, { mergeability: "conflicting", checks: "pending", checkWord: "Pending" }),
          ],
          onAsk: () => {},
        }),
      ),
    ).not.toContain('data-zerops-primary-action="Ask"');
  });

  it("offers Merge only where Gitea said the branch merges", () => {
    expect(withFlow([CRM_DEV, CRM_STAGE])).toContain('data-zerops-primary-action="Merge"');
    expect(
      withFlow(
        [CRM_DEV, CRM_STAGE],
        flow({ pullRequests: [pull(4, { mergeability: "conflicting" })] }),
      ),
    ).not.toContain('data-zerops-primary-action="Merge"');
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
      progress: undefined,
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

  it("says what Release would put in front of people, in the words they asked for", () => {
    const html = withFlow(
      [CRM_DEV, CRM_STAGE, CRM_PROD],
      flow({
        releaseContents: [
          {
            commits: [
              { sha: "a", subject: "Add a search box above the list" },
              { sha: "b", subject: "Rename the app in the page title" },
            ],
          },
        ],
      }),
    );
    // The button's own name carries it, so a keyboard and a screen reader
    // reach the answer without opening anything.
    expect(html).toContain("Release: puts 2 changes live");
    expect(html).toContain("Add a search box above the list");
    expect(html).toContain("Rename the app in the page title");
  });

  it("says moving, not blocked, where a production is carrying work nobody can see", () => {
    const html = withFlow(
      [CRM_DEV, CRM_STAGE, CRM_PROD],
      flow({
        releaseTag: "v0.3.0",
        releaseContents: [{ commits: [{ sha: "a", subject: "Add a search box above the list" }] }],
      }),
    );
    const verb =
      /<button[^>]*data-zerops-primary-action="Release"[^>]*>(.*?)<\/button>/u.exec(html) ?? [];
    // Just the word: how many is the distance chip's to say, right beside it.
    expect(verb[1]).toBe("Release");
    expect(html).not.toContain('data-zerops-surface="verb-count"');
    // The tag and what it carries are in its name, for a keyboard and a reader.
    expect(verb[0]).toContain('aria-label="Release: v0.3.0, puts 1 change live');
    // It is *moving*, not stuck: blue, never the amber a change that cannot land wears.
    expect(verb[0]).toContain("--zerops-status-busy");
    expect(verb[0]).not.toContain("--zerops-status-attention");
  });

  it("keeps the verb bare where nothing said what a release carries", () => {
    const html = withFlow([CRM_DEV, CRM_STAGE, CRM_PROD]);
    expect(html).toContain('data-zerops-primary-action="Release"');
    expect(html).not.toContain("puts");
  });

  it("says why a pull request offers no Merge rather than leaving a dead end", () => {
    const running = withFlow(
      [CRM_DEV, CRM_STAGE],
      flow({ pullRequests: [pull(4, { mergeability: "conflicting", checks: "pending" })] }),
    );
    expect(running).toContain('data-zerops-surface="sidebar-pull-request-blocked"');
    expect(running).toContain("checks running");

    const stale = withFlow(
      [CRM_DEV, CRM_STAGE],
      flow({ pullRequests: [pull(4, { mergeability: "conflicting", checks: "passing" })] }),
    );
    expect(stale).toContain("needs a rebase");

    // A red dot with no word beside it is the row going quiet at the moment it
    // has most to say: every refusal is written out, the red one included.
    const failed = withFlow(
      [CRM_DEV, CRM_STAGE],
      flow({
        pullRequests: [
          pull(4, { mergeability: "conflicting", checks: "failing", checkWord: "Failing" }),
        ],
      }),
    );
    expect(failed).toContain('data-zerops-surface="sidebar-pull-request-blocked"');
    expect(failed).toContain("checks failed");

    // Nothing is added where the verb speaks for itself.
    expect(withFlow([CRM_DEV, CRM_STAGE])).not.toContain(
      'data-zerops-surface="sidebar-pull-request-blocked"',
    );
  });

  it("says a verb is running where it was pressed, and takes no second click", () => {
    const html = withFlow(
      [CRM_DEV, CRM_STAGE, CRM_PROD],
      flow({ merging: () => true, releasing: true }),
    );
    expect(html).toContain('data-zerops-primary-action="Merging…" disabled=""');
    expect(html).toContain('data-zerops-primary-action="Releasing…" disabled=""');
    expect(html).not.toContain('data-zerops-primary-action="Merge"');
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

  it("gives every stop its last deploy as a badge and a menu; only production offers Release", () => {
    const html = withFlow([CRM_DEV, CRM_STAGE, CRM_PROD]);
    const stage = stop(html, "crm-stage");
    const production = stop(html, "crm-prod");
    for (const row of [stage, production]) {
      expect(row).toContain('data-zerops-surface="sidebar-stop-badge"');
      expect(row).toContain('data-zerops-surface="stop-menu"');
    }
    expect(production).toContain('aria-label="Deployed"');
    expect(production).toContain('data-zerops-primary-action="Release"');
    // A stage gets no verb in this slice: it deploys `main` on its own.
    expect(stage).not.toContain("Release");
    expect(withFlow([CRM_DEV, CRM_STAGE, CRM_PROD], flow({ releaseOffered: false }))).not.toContain(
      "Release",
    );
  });

  it("says a release on its way on production's line, where the menu has the tag", () => {
    const html = withFlow(
      [CRM_DEV, CRM_STAGE, CRM_PROD],
      flow({ releaseOffered: false, releaseInFlight: "v0.2.0" }),
    );
    const production = stop(html, "crm-prod");
    expect(production).toContain(">Releasing v0.2.0…<");
    expect(production).toContain('data-zerops-status-tone="pending"');
    expect(production).not.toContain('data-zerops-primary-action="Release"');
  });

  describe("a stop's line", () => {
    /** Two changes on `main` production does not run, newest first. */
    const WAITING = [
      { sha: "c".repeat(40), subject: "Cart badge" },
      { sha: "b".repeat(40), subject: "Search box" },
    ];
    const measured = (overrides: Partial<SidebarProjectFlow> = {}) =>
      flow({
        releaseContents: [{ commits: WAITING }],
        distances: new Map([
          ["crm-stage", { count: 0, changes: [] }],
          ["crm-prod", { count: 2, changes: WAITING }],
        ]),
        ...overrides,
      });

    it("says only what an in-sync, healthy stop runs", () => {
      const stage = stop(withFlow([CRM_DEV, CRM_STAGE, CRM_PROD], measured()), "crm-stage");
      expect(stage).toContain('data-zerops-surface="sidebar-environment-version"');
      expect(stage).toContain(">3f9c1b2<");
      expect(stage).not.toContain('data-zerops-surface="sidebar-stop-word"');
      expect(stage).not.toContain('data-zerops-surface="sidebar-stop-distance"');
    });

    it("says how far production is behind main as a chip, closed until somebody opens it", () => {
      const production = stop(withFlow([CRM_DEV, CRM_STAGE, CRM_PROD], measured()), "crm-prod");
      const distance =
        /<button[^>]*data-zerops-surface="sidebar-stop-distance"[^>]*>([^<]*)</u.exec(production);
      expect(distance?.[1]).toBe("+2");
      expect(distance?.[0]).toContain('aria-expanded="false"');
      // "+2" is a number with no noun: its name says what it counts.
      expect(distance?.[0]).toContain('aria-label="2 changes on main not here yet"');
      expect(withFlow([CRM_DEV, CRM_STAGE, CRM_PROD], measured())).not.toContain(
        "sidebar-stop-changes",
      );
    });

    it("opens the distance to the changes it counts, newest first, marked where the stage stands", () => {
      const tree = mount(
        <SidebarZeropsTree
          candidates={[CRM_DEV, CRM_STAGE, CRM_PROD]}
          complete
          getFlow={() =>
            measured({
              stageMarks: new Map([
                ["c".repeat(40), "deploying-on-stage"],
                ["b".repeat(40), "on-stage"],
              ]),
            })
          }
          onBrowseProjects={() => {}}
          onSelect={() => {}}
        />,
      );
      press(tree, "sidebar-stop-distance");
      const changes = tree.root.findAll(
        (node) => node.props["data-zerops-surface"] === "sidebar-stop-change",
      );
      expect(changes.map((node) => node.props["data-zerops-stage-mark"])).toEqual([
        "deploying-on-stage",
        "on-stage",
      ]);
      expect(text(changes[0]!)).toContain("Cart badge");
      expect(text(changes[1]!)).toContain("Search box");
      expect(surface(tree, "sidebar-stop-distance").props["aria-expanded"]).toBe(true);
      press(tree, "sidebar-stop-distance");
      expect(
        tree.root.findAll((node) => node.props["data-zerops-surface"] === "sidebar-stop-change"),
      ).toHaveLength(0);
    });

    it("starts every row's text at the Mate's column, on the same rail", () => {
      const tree = mount(
        <SidebarZeropsTree
          births={[
            {
              projectId: "crm-stage-new",
              startedAt: 0,
              placement: {
                groupId: "aaa",
                groupName: "Beviro CRM",
                kind: "stage",
                displayName: "stage",
              },
              step: "harden",
              overdue: false,
            },
          ]}
          candidates={[CRM_DEV, CRM_STAGE, CRM_PROD]}
          complete
          getFlow={() => measured({ stageMarks: new Map([["c".repeat(40), "on-stage"]]) })}
          onBrowseProjects={() => {}}
          onSelect={() => {}}
        />,
      );
      press(tree, "sidebar-stop-distance");
      // The rail cell is 20px in every one of these rows; the gap after it is
      // what puts the text on one column (the owner, 2026-09-25: "everything
      // jumps around differently").
      const rows = [
        "sidebar-mate",
        "sidebar-environment",
        "sidebar-environment-creating",
        "sidebar-stop-change",
      ].flatMap((name) =>
        tree.root.findAll(
          (node) => typeof node.type === "string" && node.props["data-zerops-surface"] === name,
        ),
      );
      expect(rows.length).toBeGreaterThanOrEqual(5);
      for (const row of rows) expect(String(row.props.className).split(" ")).toContain("gap-3.5");
      // A change's text is the first thing after the rail; where it stands on
      // the stage trails it.
      const change = tree.root.find(
        (node) =>
          typeof node.type === "string" &&
          node.props["data-zerops-surface"] === "sidebar-stop-change" &&
          node.props["data-zerops-stage-mark"] === "on-stage",
      );
      const kids = change.children.filter((child) => typeof child !== "string");
      expect(text(kids[1]!)).toBe("Cart badge");
      expect(
        kids[2]!.findAll(
          (node) => node.props["data-zerops-surface"] === "sidebar-stop-change-mark",
        ),
      ).not.toHaveLength(0);
    });

    it("closes the list itself once nothing is behind, and stays closed when more arrives", () => {
      const drawn = (state: SidebarProjectFlow) => (
        <SidebarZeropsTree
          candidates={[CRM_DEV, CRM_STAGE, CRM_PROD]}
          complete
          getFlow={() => state}
          onBrowseProjects={() => {}}
          onSelect={() => {}}
        />
      );
      const changes = (tree: ReactTestRenderer) =>
        tree.root.findAll((node) => node.props["data-zerops-surface"] === "sidebar-stop-change");
      const tree = mount(drawn(measured()));
      press(tree, "sidebar-stop-distance");
      expect(changes(tree)).toHaveLength(2);
      act(() => {
        tree.update(drawn(measured({ distances: new Map() })));
      });
      expect(changes(tree)).toHaveLength(0);
      act(() => {
        tree.update(drawn(measured()));
      });
      expect(changes(tree)).toHaveLength(0);
      expect(surface(tree, "sidebar-stop-distance").props["aria-expanded"]).toBe(false);
    });

    it("leads with a word where something differs, and hides the distance behind it", () => {
      const failedStage = measured({
        environments: new Map([
          ["crm-stage", { ...stageRow, tone: "bad" }],
          ["crm-prod", productionRow],
        ]),
        distances: new Map([
          ["crm-stage", { count: 1, changes: WAITING.slice(0, 1) }],
          ["crm-prod", { count: 2, changes: WAITING }],
        ]),
      });
      const html = withFlow([CRM_DEV, CRM_STAGE, CRM_PROD], failedStage);
      const stage = stop(html, "crm-stage");
      expect(stage).toContain('data-zerops-word-kind="failed"');
      expect(stage).toContain(">Failed on<");
      expect(stage).toContain(">3f9c1b2<");
      expect(stage).not.toContain("sidebar-stop-distance");
      // Production is healthy, so it stays quiet but for how far it is.
      const production = stop(html, "crm-prod");
      expect(production).not.toContain("sidebar-stop-word");
      expect(production).toContain(">+2<");

      const releasing = stop(
        withFlow([CRM_DEV, CRM_STAGE, CRM_PROD], measured({ releaseInFlight: "v0.2.0" })),
        "crm-prod",
      );
      expect(releasing).toContain('data-zerops-word-kind="releasing"');
      expect(releasing).not.toContain("sidebar-stop-distance");
    });

    it("names what runs by its commit, never by a merged pull request's title, a branch-fed stage's source in front", () => {
      const html = withFlow(
        [CRM_DEV, CRM_STAGE, CRM_PROD],
        measured({
          environments: new Map([
            ["crm-stage", { ...stageRow, source: "feat/cart" }],
            ["crm-prod", productionRow],
          ]),
          merged: [pull(9, { merged: true, title: "Mate: zitdev" })],
          distances: new Map([["crm-prod", { count: 2, changes: WAITING }]]),
        }),
      );
      expect(stop(html, "crm-stage")).toContain(">feat/cart · 3f9c1b2<");
      expect(stop(html, "crm-stage")).not.toContain("sidebar-stop-distance");
      expect(stop(html, "crm-prod")).toContain(">3f9c1b2<");
      expect(html).not.toContain("Mate: zitdev");
    });
  });

  describe("a stop's one line", () => {
    const WAITING = [
      { sha: "c".repeat(40), subject: "Cart badge" },
      { sha: "b".repeat(40), subject: "Search box" },
    ];
    const drawn = (overrides: Partial<SidebarProjectFlow> = {}) =>
      render([CRM_DEV, CRM_STAGE, CRM_PROD], {
        getFlow: () =>
          flow({
            releaseTag: "v0.3.0",
            releaseContents: [{ commits: WAITING }],
            distances: new Map([["crm-prod", { count: 2, changes: WAITING }]]),
            ...overrides,
          }),
      });
    /** A class list off the element wearing this surface in a row. */
    const classes = (row: string, surface: string) =>
      (
        new RegExp(`<[a-z]+[^>]*class="([^"]*)"[^>]*data-zerops-surface="${surface}"`, "u").exec(
          row,
        )?.[1] ?? ""
      ).split(" ");

    it("is one line: badge, role pill, name, what runs, the chip, then the verb", () => {
      const html = drawn();
      const at = html.indexOf('data-zerops-project="crm-prod"');
      expect(html.slice(html.lastIndexOf("<li", at), at)).toContain("h-8");
      const production = stop(html, "crm-prod");
      expect(production).not.toContain("py-2");
      const order = [
        'data-zerops-surface="sidebar-stop-badge"',
        ">prod<",
        ">crm-prod<",
        'data-zerops-surface="sidebar-environment-version"',
        'data-zerops-surface="sidebar-stop-distance"',
        'data-zerops-primary-action="Release"',
        'data-zerops-surface="stop-menu"',
      ].map((part) => production.indexOf(part));
      expect(order.every((at) => at > -1)).toBe(true);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
    });

    it("opens the stop from its pill and name", () => {
      const html = drawn({ onOpenStop: () => {} });
      const open =
        /<button[^>]*data-zerops-surface="sidebar-stop-open"[^>]*>(.*?)<\/button>/u.exec(
          stop(html, "crm-prod"),
        )?.[1] ?? "";
      expect(open).toContain('data-zerops-surface="role-tag"');
      expect(open).toContain(">crm-prod<");
    });

    it("leads what runs with the state word where something differs", () => {
      const failed = stop(
        drawn({
          environments: new Map([
            ["crm-stage", { ...stageRow, tone: "bad" }],
            ["crm-prod", productionRow],
          ]),
        }),
        "crm-stage",
      );
      expect(failed.indexOf(">Failed on<")).toBeGreaterThan(failed.indexOf(">stage<"));
      expect(failed.indexOf(">3f9c1b2<")).toBeGreaterThan(failed.indexOf(">Failed on<"));
    });

    // The globe stands on the row's right edge, in the column every Mate's
    // time, every change's Merge and every project's dot end in; the menu
    // shows beside it on hover, in a slot kept for it, so nothing moves.
    it("ends in a fixed cluster, a menu slot then the globe on the right edge, so nothing moves on hover", () => {
      const html = render([CRM_DEV, CRM_STAGE, CRM_PROD], { getFlow: () => flow() });
      for (const id of ["crm-stage", "crm-prod"]) {
        const row = stop(html, id);
        // Both slots are there at rest, whether or not the stop has a route.
        const globe = classes(row, "sidebar-stop-globe-slot");
        const more = classes(row, "sidebar-stop-menu-slot");
        for (const slot of [globe, more]) {
          expect(slot).toContain("w-5");
          expect(slot).toContain("shrink-0");
        }
        // The menu is invisible at rest and shown on hover or focus — by its
        // opacity alone, so its width never changes and the globe never moves.
        for (const cls of [
          "opacity-0",
          "group-hover/stop:opacity-100",
          "group-focus-within/stop:opacity-100",
        ])
          expect(more).toContain(cls);
        expect(
          more.some((cls) => /^group-(hover|focus-within)\/stop:(w|hidden|flex)/u.test(cls)),
        ).toBe(false);
        expect(globe.some((cls) => cls.includes("hover") || cls.includes("opacity"))).toBe(false);
        // Still in the tab order at rest.
        expect(row).toContain('data-zerops-surface="stop-menu"');
        expect(row.indexOf("sidebar-stop-menu-slot")).toBeLessThan(
          row.indexOf("sidebar-stop-globe-slot"),
        );
      }
    });

    it("gives way with what runs first, truncating it; the pill, word, chip and verb never", () => {
      const production = stop(drawn(), "crm-prod");
      const runs = classes(production, "sidebar-environment-version");
      expect(runs).toContain("truncate");
      expect(runs).toContain("shrink-[1000]");
      expect(production).not.toContain("group-hover/stop:hidden");
      for (const kept of ["role-tag", "sidebar-stop-distance"])
        expect(classes(production, kept)).toContain("shrink-0");
      expect(/<button[^>]*data-zerops-primary-action="Release"/u.exec(production)?.[0]).toContain(
        "shrink-0",
      );
    });

    it("wears the globe, always, once the stop has a public route", () => {
      const route = {
        service: "app",
        port: 80,
        url: "https://app.example.com",
        host: "app.example.com",
      };
      const routed = (count: number) =>
        stop(
          render(
            [
              CRM_DEV,
              CRM_STAGE,
              {
                ...CRM_PROD,
                routes: Array.from({ length: count }, (_, index) => ({
                  ...route,
                  url: `${route.url}/${String(index)}`,
                  host: `${String(index)}.${route.host}`,
                })),
              } as ZeropsCandidate,
            ],
            { getFlow: () => flow() },
          ),
          "crm-prod",
        );
      expect(routed(0)).not.toContain("public-routes-menu");
      expect(routed(1)).toContain('data-zerops-surface="public-routes-menu"');
      expect(routed(1)).not.toContain("public-routes-count");
      expect(routed(3)).toContain('data-zerops-surface="public-routes-count"');
      expect(routed(3)).toContain(": 3 public URLs");
      // In its own slot, never behind the hover.
      const production = routed(3);
      const globeAt = production.indexOf('data-zerops-surface="public-routes-menu"');
      expect(globeAt).toBeGreaterThan(production.indexOf("sidebar-stop-globe-slot"));
      expect(globeAt).toBeGreaterThan(production.indexOf("sidebar-stop-menu-slot"));
    });
  });

  it("keeps the timeline's shape with nothing read: no row, no dot, no verb", () => {
    const html = render([CRM_DEV, CRM_STAGE, CRM_PROD]);
    expect(html).toContain('data-zerops-surface="sidebar-environment-rows"');
    expect(html).not.toContain("sidebar-pull-request");
    expect(html).not.toContain("status-dot");
    expect(html).not.toContain("Release");
  });

  it("draws one spine, and branches a change off it instead of onto it", () => {
    const html = withFlow([CRM_DEV, CRM_STAGE, CRM_PROD]);
    const count = (needle: string) => html.split(needle).length - 1;
    const rows =
      count('data-zerops-surface="sidebar-mate"') +
      count('data-zerops-surface="sidebar-environment"') +
      count('data-zerops-surface="sidebar-pull-request"');
    const changes = count('data-zerops-surface="sidebar-pull-request"');
    const painted = count('class="w-px flex-1 bg-[var(--zerops-rail)]"');
    const blank = count('class="w-px flex-1"');
    // The air between a Mate's block and the stops carries the line through
    // it, painted, so the blocks stand apart and the spine stays whole.
    const gaps = count('data-zerops-rail="gap"');
    expect(rows).toBeGreaterThan(0);
    expect(changes).toBeGreaterThan(0);
    expect(gaps).toBeGreaterThan(0);
    // Every row carries both halves wherever it sits on the line, a change
    // included: its fork builds the spine the same way so it lands on the same
    // half pixel. Leaving one out lets the other take the free space, which shoved the
    // first face of every group 24px above its row and every last badge 17px
    // below it.
    expect(painted + blank).toBe(rows * 2 + gaps);
    // Unpainted only at the two ends: the first node of the group, and the
    // last stop, production. The stage stands on the line like any stop.
    expect(blank).toBe(2);
    const production = html.slice(html.indexOf('data-zerops-project="crm-prod"'));
    expect(production).toContain('class="w-px flex-1 bg-[var(--zerops-rail)]"');
    expect(production).toContain('class="w-px flex-1"');
    // A change is not a node on the line — it branches off one. Drawn as a
    // node it read as one more Mate however small its dot.
    expect(count('data-zerops-rail="fork"')).toBe(changes);
  });

  it("runs the line to a stage that is the group's only stop, and ends it there", () => {
    const html = render([CRM_DEV, CRM_STAGE]);
    const stage = stop(html, "crm-stage");
    expect(stage).toContain('data-zerops-surface="sidebar-stop-badge"');
    // Its top half meets the Mate above; nothing runs on below it.
    expect(stage).toContain('class="w-px flex-1 bg-[var(--zerops-rail)]"');
    expect(stage).toContain('class="w-px flex-1"');
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

  describe("the group heading's next-step dot", () => {
    it("carries a dot when groupFlow's own next step waits on somebody", () => {
      const html = withFlow([CRM_DEV, CRM_STAGE, CRM_PROD]);
      expect(html).toContain('data-zerops-surface="sidebar-project-next-step"');
    });

    it("sits the dot at the heading's end edge, after the verbs that show on hover", () => {
      const html = withFlow([CRM_DEV, CRM_STAGE, CRM_PROD]);
      const heading = html.slice(html.indexOf('data-zerops-surface="sidebar-project"'));
      expect(heading.indexOf('data-zerops-surface="sidebar-project-more"')).toBeLessThan(
        heading.indexOf('data-zerops-surface="sidebar-project-next-step"'),
      );
    });

    it("carries no dot once the flow says nothing is left to do", () => {
      const talked: ZeropsAgentActivity = {
        threadId: "thread-x" as ZeropsAgentActivity["threadId"],
        kind: "idle",
        status: null,
        face: "idle",
        subject: "Ship it",
        at: new Date().toISOString(),
        snippet: undefined,
        progress: undefined,
        unread: false,
        pausedUntil: undefined,
        threadKey: "env:thread",
        task: undefined,
      };
      const html = render([CRM_DEV_CONNECTED, CRM_STAGE, CRM_PROD], {
        getActivity: () => talked,
        getFlow: () => flow({ pullRequests: [], releaseOffered: false }),
      });
      expect(html).not.toContain('data-zerops-surface="sidebar-project-next-step"');
    });

    it("carries no dot while the flow is unread", () => {
      const html = render([CRM_DEV, CRM_STAGE, CRM_PROD]);
      expect(html).not.toContain('data-zerops-surface="sidebar-project-next-step"');
    });

    // Every kind, so a kind added to the flow cannot slip past the heading.
    // A dot says somebody must act: a first task has none, the Mate is the way in.
    const KINDS: Record<GroupNextStepKind, { readonly dot: boolean }> = {
      "answer-mate": { dot: true },
      "fix-mate": { dot: true },
      "fix-deploy": { dot: true },
      merge: { dot: true },
      unblock: { dot: true },
      release: { dot: true },
      "add-production": { dot: false },
      "first-task": { dot: false },
      none: { dot: false },
    };
    const kinds = Object.keys(KINDS) as ReadonlyArray<GroupNextStepKind>;
    const heading = (kind: GroupNextStepKind) =>
      renderToStaticMarkup(
        <ProjectHeader
          name="Links"
          nextStep={{ kind, text: `step ${kind}`, verb: undefined, target: undefined }}
          onBrowseProjects={() => {}}
        />,
      );
    const dotOf = (html: string) =>
      /data-zerops-surface="sidebar-project-next-step"[^>]*/u.exec(html)?.[0];

    it.each(kinds)("wears a dot only where somebody must act: %s", (kind) => {
      expect(dotOf(heading(kind)) !== undefined).toBe(KINDS[kind].dot);
    });

    it.each(kinds.filter((kind) => KINDS[kind].dot))("wears the page's tone for %s", (kind) => {
      expect(dotOf(heading(kind))).toContain(`data-zerops-status-tone="${nextStepTone(kind)}"`);
    });
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

  it("draws only the heading of a project collapsed last time, its next-step dot included", () => {
    stored.collapsed = new Set(["aaa"]);
    const html = renderToStaticMarkup(
      tree({
        getFlow: (): SidebarProjectFlow => ({
          pullRequests: [pull(4)],
          environments: new Map([["crm-prod", productionRow]]),
          releaseOffered: true,
          merging: () => false,
          releasing: false,
          onMerge: () => {},
          onRelease: () => {},
        }),
      }),
    );
    expect(html).toContain('data-zerops-surface="sidebar-project"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('data-zerops-surface="sidebar-project-next-step"');
    // No summary and no small badges: a second design of the rows is what the
    // owner turned down.
    for (const gone of [
      "sidebar-mate",
      "sidebar-pull-request",
      "sidebar-environment-rows",
      "sidebar-stop-badge",
    ])
      expect(html).not.toContain(`data-zerops-surface="${gone}"`);
  });

  // A heading belongs to the rows under it, never halfway between two
  // projects (the owner, 2026-09-28: "the gap between project name and under
  // project is the same"): a full breath above a project, and a run of
  // collapsed ones closed up into a list of their names.
  it("keeps a full breath between projects, and closes a run of collapsed ones into a list", () => {
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
    const room = (group: string) =>
      sections
        .find(([, , id]) => id === group)?.[1]
        ?.split(" ")
        .filter((name) => name.startsWith("mt-")) ?? [];
    expect(room("aaa")).toEqual([]);
    expect(room("links")).toEqual(["mt-9"]);
    expect(room("notes")).toEqual(["mt-1"]);
  });

  it("points its chevron right while collapsed and always shows it; down, on hover, while open", () => {
    const chevron = (collapsed: boolean) =>
      /<svg[^>]*data-zerops-surface="sidebar-project-chevron"[^>]*>/u.exec(
        renderToStaticMarkup(
          <ProjectHeader
            collapsed={collapsed}
            name="Links"
            onBrowseProjects={() => {}}
            onToggle={() => {}}
          />,
        ),
      )?.[0] ?? "";
    expect(chevron(true)).toContain("lucide-chevron-right");
    expect(chevron(true)).not.toContain("opacity-0");
    expect(chevron(false)).toContain("lucide-chevron-down");
    expect(chevron(false)).toContain("opacity-0");
    expect(chevron(false)).toContain("group-hover/project:opacity-100");
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

describe("a stop's deployment", () => {
  const known = (value: Deployment): Shown<Deployment> => ({
    state: "known",
    value,
    asOf: { ordinal: 1, atMs: 0 },
    coverage: "complete",
    freshness: { kind: "live" },
  });
  /** A flow provider's value that knows only each stop's deployment. */
  const deploymentsOnly = (deployments: ReadonlyMap<string, Shown<Deployment>>) =>
    ({ deployments, flows: new Map() }) as unknown as ZeropsProjectFlowValue;
  const withDeployments = (flow: ZeropsProjectFlowValue) => {
    return renderToStaticMarkup(
      <ZeropsProjectFlowContext.Provider value={flow}>
        <SidebarZeropsTree
          candidates={[CRM_DEV, CRM_STAGE, CRM_PROD]}
          complete
          onBrowseProjects={() => {}}
          onSelect={() => {}}
        />
      </ZeropsProjectFlowContext.Provider>,
    );
  };

  it("says a deploy running on production in words on its line, naming what it deploys", () => {
    const html = renderToStaticMarkup(
      <ZeropsProjectFlowContext.Provider
        value={deploymentsOnly(
          new Map([
            [
              "crm-prod",
              known({
                kind: "deploying",
                version: {
                  name: "v0.2.0",
                  commit: "055a7e8",
                  sha: undefined,
                  taggedBy: undefined,
                  label: "v0.2.0",
                },
                previous: null,
              }),
            ],
          ]),
        )}
      >
        <SidebarZeropsTree
          candidates={[CRM_DEV, CRM_STAGE, CRM_PROD]}
          complete
          getFlow={() => ({
            pullRequests: [],
            environments: new Map(),
            releaseOffered: false,
            merging: () => false,
            releasing: false,
            onMerge: () => {},
            onRelease: () => {},
          })}
          onBrowseProjects={() => {}}
          onSelect={() => {}}
        />
      </ZeropsProjectFlowContext.Provider>,
    );
    const production = stop(html, "crm-prod");
    expect(production).toContain(">Deploying v0.2.0<");
    expect(production).toContain('data-zerops-status-tone="pending"');
  });

  it("never says nothing is deployed while it has not read what runs there", () => {
    const html = render([CRM_DEV, CRM_STAGE, CRM_PROD]);
    expect(html.toLowerCase()).not.toContain("nothing deployed yet");
    expect(stop(html, "crm-prod")).toContain("Checking what runs here…");
  });

  it("says nothing is deployed where the platform says a stop runs nothing", () => {
    const html = withDeployments(
      deploymentsOnly(
        new Map([
          ["crm-prod", known({ kind: "none" })],
          ["crm-stage", { state: "unread", waitingFor: null }],
        ]),
      ),
    );
    expect(stop(html, "crm-prod")).toContain(">Nothing deployed yet<");
  });

  it("names what the platform says a stop runs before Gitea has answered", () => {
    const html = withDeployments(
      deploymentsOnly(
        new Map([
          [
            "crm-prod",
            known({
              kind: "running",
              activatedAt: null,
              version: {
                name: "v1.4.0",
                commit: "3f9c1b2",
                sha: "3f9c1b2000000000000000000000000000000000",
                taggedBy: undefined,
                label: "v1.4.0",
              },
            }),
          ],
        ]),
      ),
    );
    expect(stop(html, "crm-prod")).toContain("v1.4.0");
    expect(stop(html, "crm-prod")).toContain('aria-label="Deployed"');
  });

  it("names what a stage runs as it names production's", () => {
    const html = withDeployments(
      deploymentsOnly(
        new Map([
          [
            "crm-stage",
            known({
              kind: "running",
              activatedAt: null,
              version: {
                name: "v1.4.0",
                commit: "3f9c1b2",
                sha: "3f9c1b2000000000000000000000000000000000",
                taggedBy: undefined,
                label: "v1.4.0",
              },
            }),
          ],
        ]),
      ),
    );
    expect(stop(html, "crm-stage")).toContain(">v1.4.0<");
    expect(stop(html, "crm-stage")).toContain('aria-label="Deployed"');
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
    progress: undefined,
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
      merging: () => false,
      releasing: false,
      onMerge: () => {},
      onRelease: () => {},
    };
    const html = render(candidates, { getFlow: () => sidebar, health, mayCreate });
    const dot = /data-zerops-surface="sidebar-project-next-step"[^>]*/u.exec(html)?.[0];
    if (!nextStepAwaitsSomebody(page.kind)) expect(dot).toBeUndefined();
    else expect(dot).toContain(`aria-label="${page.text}"`);
  });
});

describe("arranging the projects by hand", () => {
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

  it("gives a heading a grip only in the Custom order, in the gutter, named for its project", () => {
    setLocalStorageItem(PROJECT_ORDER_STORAGE_KEY, "name", ProjectOrderSchema);
    expect(render([LINKS_MATE, SHOP_MATE])).not.toContain("sidebar-project-grip");
    setLocalStorageItem(PROJECT_ORDER_STORAGE_KEY, "custom", ProjectOrderSchema);
    const html = render([LINKS_MATE, SHOP_MATE]);
    const grip =
      /<button[^>]*data-zerops-surface="sidebar-project-grip"[^>]*>/u.exec(html)?.[0] ?? "";
    expect(grip).toContain('aria-label="Move Links: drag, or use the arrow keys"');
    // In the gutter and invisible at rest, so the name never moves for it.
    expect(grip).toContain("absolute");
    expect(grip).toContain("opacity-0");
    expect(grip).toContain("group-hover/project:opacity-100");
  });

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
    progress: undefined,
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
      progress: { completed: 2, total: 5 },
      ...overrides,
    });
  const slot = (html: string) =>
    /<span[^>]*data-zerops-surface="sidebar-mate-time"[^>]*>(.*?)<\/span>/u.exec(html)?.[0] ?? "";

  it("rings a working face with its plan, one segment a step", () => {
    const html = row(working());
    expect(html).toContain('data-zerops-surface="sidebar-mate-ring"');
    expect(html.match(/data-plan-ring-segment=/gu)).toHaveLength(5);
    expect(html.match(/data-plan-ring-segment="done"/gu)).toHaveLength(2);
  });

  it.each([
    { case: "a resting Mate", activity: live() },
    { case: "a working one with no plan", activity: working({ progress: undefined }) },
  ])("draws no ring on $case", ({ activity }) => {
    expect(row(activity)).not.toContain("sidebar-mate-ring");
  });

  it("counts up how long it has been working, in the busy blue, where its age was", () => {
    const time = slot(row(working()));
    expect(time).toContain("3:12");
    expect(time).toContain("text-status-busy-text");
    expect(slot(row(live()))).toContain(">2h<");
  });

  // Work left running in the background wears the working face and offers
  // Stop: its slot counts it up as any working face's does, never a grey age
  // beside a working face (the approved menu; the 2026-09-28 audit's gap).
  it("counts up work left running in the background, as it counts a run", () => {
    const time = slot(row(working({ kind: "monitoring", progress: undefined })));
    expect(time).toContain("3:12");
    expect(time).toContain("text-status-busy-text");
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
    { case: "a working Mate with words back already", activity: working() },
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

  it("sets an unread Mate's name and task in bold, and a read one in the usual weight", () => {
    const name = (html: string) =>
      /<span class="([^"]*)"[^>]*data-zerops-surface="sidebar-mate-name"/u.exec(html)?.[1] ?? "";
    const subject = (html: string) =>
      /<span class="([^"]*)"[^>]*data-zerops-surface="sidebar-mate-subject"/u.exec(html)?.[1] ?? "";
    const unread = row(live({ unread: true }));
    expect(name(unread)).toContain("font-bold");
    expect(subject(unread)).toContain("text-sidebar-foreground");
    expect(subject(unread)).toContain("font-medium");
    const read = row(live());
    expect(name(read)).toContain("font-medium");
    expect(name(read)).not.toContain("font-bold");
    expect(subject(read)).toContain("text-sidebar-muted-foreground");
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
    progress: undefined,
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

describe("a Mate's peek", () => {
  const spoken: ZeropsAgentActivity = {
    threadId: "thread-1" as ZeropsAgentActivity["threadId"],
    kind: "idle",
    status: null,
    face: "idle",
    subject: "Add a /status page",
    at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    snippet: "Done. /status answers on stage.",
    progress: undefined,
    unread: false,
    pausedUntil: undefined,
    threadKey: "env:thread",
    task: "Add a /status page",
  };
  const renderPeek = vi.fn((_peek: unknown) => null);
  const mounted = () =>
    mount(
      <PortalGate closed>
        <SidebarZeropsTree
          candidates={[CRM_DEV_CONNECTED]}
          complete
          getActivity={() => spoken}
          onBrowseProjects={() => {}}
          onSelect={() => {}}
          renderPeek={renderPeek}
        />
      </PortalGate>,
    );
  const row = (tree: ReactTestRenderer) => surface(tree, "sidebar-mate-row");
  const peek = () => useSidebarPeek.getState().peek;
  afterEach(() => {
    act(() => {
      useSidebarPeek.getState().close();
    });
    renderPeek.mockClear();
    vi.useRealTimers();
  });

  // The owner, 2026-09-27: "this pop needs to show up with much bigger delay".
  it("opens after the pointer rests on the row a while, and closes once it has left", () => {
    vi.useFakeTimers();
    const tree = mounted();
    act(() => {
      row(tree).props.onPointerEnter({ pointerType: "mouse" });
    });
    act(() => {
      vi.advanceTimersByTime(1199);
    });
    expect(peek()).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(peek()).toEqual({ projectId: "crm-dev", mode: "hover" });
    expect(renderPeek).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: "crm-dev", projectName: "Beviro CRM" }),
    );
    // Lit while its peek is open.
    expect(surface(tree, "sidebar-mate").props.className).toContain("bg-sidebar-row-hover");
    act(() => {
      row(tree).props.onPointerLeave({ pointerType: "mouse" });
    });
    act(() => {
      vi.advanceTimersByTime(220);
    });
    expect(peek()).toBeNull();
  });

  it("never opens for a pointer that only passes over the row", () => {
    vi.useFakeTimers();
    const tree = mounted();
    act(() => {
      row(tree).props.onPointerEnter({ pointerType: "mouse" });
      vi.advanceTimersByTime(900);
      row(tree).props.onPointerLeave({ pointerType: "mouse" });
      vi.advanceTimersByTime(2000);
    });
    expect(peek()).toBeNull();
  });

  // It waits for the pointer to rest: one still moving across the row is on
  // its way somewhere else.
  it("waits while the pointer keeps moving over the row", () => {
    vi.useFakeTimers();
    const tree = mounted();
    act(() => {
      row(tree).props.onPointerEnter({ pointerType: "mouse" });
    });
    for (let moved = 0; moved < 4; moved += 1) {
      act(() => {
        vi.advanceTimersByTime(800);
        row(tree).props.onPointerMove({ pointerType: "mouse", movementY: 2 });
      });
    }
    expect(peek()).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1200);
    });
    expect(peek()).toEqual({ projectId: "crm-dev", mode: "hover" });
  });

  it("is offered in the Mate's own menu, which pins it open", () => {
    const tree = mount(
      <PortalGate closed>
        <SidebarZeropsTree
          candidates={[CRM_DEV_CONNECTED]}
          complete
          getActivity={() => spoken}
          getMateActions={() => ({ muted: false, entries: [] })}
          onBrowseProjects={() => {}}
          onSelect={() => {}}
          renderPeek={renderPeek}
        />
      </PortalGate>,
    );
    const menu = tree.root.findByType(MateMenu);
    expect(menu.props.onPeek).toBeTypeOf("function");
    act(() => {
      menu.props.onPeek();
    });
    expect(peek()).toEqual({ projectId: "crm-dev", mode: "pinned" });
  });

  it("opens with Space and keeps it, and Space again puts it away — never pressing the row", () => {
    const tree = mounted();
    let prevented = 0;
    const space = { key: " ", preventDefault: () => (prevented += 1) };
    act(() => {
      surface(tree, "sidebar-mate").props.onKeyDown(space);
    });
    expect(peek()).toEqual({ projectId: "crm-dev", mode: "pinned" });
    expect(prevented).toBe(1);
    act(() => {
      row(tree).props.onPointerLeave({ pointerType: "mouse" });
    });
    expect(peek()?.mode).toBe("pinned");
    act(() => {
      surface(tree, "sidebar-mate").props.onKeyDown(space);
    });
    expect(peek()).toBeNull();
  });

  it("gives no peek where nobody draws one", () => {
    const tree = mount(
      <SidebarZeropsTree
        candidates={[CRM_DEV_CONNECTED]}
        complete
        getActivity={() => spoken}
        onBrowseProjects={() => {}}
        onSelect={() => {}}
      />,
    );
    act(() => {
      surface(tree, "sidebar-mate").props.onKeyDown({ key: " ", preventDefault: () => {} });
    });
    expect(peek()).toBeNull();
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
    progress: undefined,
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
    // After the Mates, before the stops.
    expect(html.indexOf("sidebar-quiet-mates")).toBeLessThan(
      html.indexOf('data-zerops-surface="sidebar-environment"'),
    );
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
      useSidebarPeek.getState().reveal({ kind: "mate", projectId: "crm-dev" });
    });
    expect(mateRows()).toHaveLength(1);
    // Answered: a menu drawn again later has nothing left to show.
    expect(useSidebarPeek.getState().revealing).toBeNull();
  });

  it("leaves an ask for a Mate it does not hold standing until one does", () => {
    mount(tree());
    act(() => {
      useSidebarPeek.getState().reveal({ kind: "mate", projectId: "elsewhere" });
    });
    expect(useSidebarPeek.getState().revealing?.target).toEqual({
      kind: "mate",
      projectId: "elsewhere",
    });
    act(() => {
      useSidebarPeek.getState().answerReveal(useSidebarPeek.getState().revealing!.seq);
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
    merging: () => false,
    releasing: false,
    onMerge: () => {},
    onRelease: () => {},
    onOpenChange: () => {},
    onOpenStop: () => {},
  });
  const OWN = pull(4, { mateProjectId: "links-dev", title: "Add a search box" });
  const ADAS = pull(6, { mateProjectId: undefined, author: "ada", title: "Bump the linter" });
  const tree = (props: Record<string, unknown> = {}) => (
    <SidebarZeropsTree
      candidates={[LINKS_MATE, LINKS_STAGE, LINKS_PROD]}
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
        candidates: [LINKS_MATE, THEO, LINKS_STAGE, LINKS_PROD],
        getFlow: () => linksFlow([OWN, theirs]),
        shown: (item: ZeropsCandidate) => item.project.id !== "links-theo",
      }),
    );
    expect(index()?.mates.map((mate) => mate.projectId)).toEqual(["links-dev"]);
    expect(index()?.changes.map((change) => change.key)).toEqual(["appdev#4"]);
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
      useSidebarPeek.getState().reveal({ kind: "project", groupId: "links" });
    });
    expect(mateRows()).toHaveLength(1);
    expect(useSidebarPeek.getState().revealing).toBeNull();
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
      useSidebarPeek.getState().reveal({
        kind: "change",
        groupId: "links",
        key: "appdev#1",
        mateProjectId: "links-dev",
      });
    });
    expect(changeRows()).toHaveLength(4);
    expect(changeRows().map((row) => row.props["data-zerops-change"])).toContain("appdev#1");
  });

  // Every change the Mate has open stands in its peek, as each stands under
  // its row (the owner, 2026-09-27: "it shows only one of the two merge
  // requests"): the one a jump asked for first, then the rest newest first.
  it("shows every open change of its Mate in its peek, the one a jump asked for first", () => {
    const older = pull(2, { mateProjectId: "links-dev", title: "Older change" });
    const newer = pull(3, { mateProjectId: "links-dev", title: "Newer change" });
    const peeks: Array<{ readonly changes: unknown; readonly changeCount: number }> = [];
    const mounted = mount(
      <PortalGate closed>
        {tree({
          getFlow: () => linksFlow([older, newer]),
          renderPeek: (peek: { readonly changes: unknown; readonly changeCount: number }) => {
            peeks.push(peek);
            return null;
          },
        })}
      </PortalGate>,
    );
    const shown = () => {
      const list = peeks.at(-1)?.changes as
        | ReactElement<{ children: ReadonlyArray<ReactElement<{ pull: FlowPullRequest }>> }>
        | undefined;
      return list?.props.children.map((line) => line.props.pull.number);
    };
    act_(() => {
      useSidebarPeek.getState().open("links-dev", "pinned", "appdev#2");
    });
    expect(shown()).toEqual([2, 3]);
    expect(peeks.at(-1)?.changeCount).toBe(2);
    act_(() => {
      useSidebarPeek.getState().open("links-dev", "pinned");
    });
    expect(shown()).toEqual([3, 2]);
    act_(() => {
      useSidebarPeek.getState().close();
      mounted.unmount();
    });
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
    merging: () => false,
    releasing: false,
    onMerge: () => {},
    onRelease: () => {},
    ...overrides,
  });
  const remembering = (changes: ReadonlyArray<FlowPullRequest> | undefined, stop?: string) => ({
    changes: () => changes,
    stop: () => stop,
  });
  const running = (label: string) =>
    ({
      deployments: new Map([["crm-prod", known(label)]]),
      flows: new Map(),
    }) as unknown as ZeropsProjectFlowValue;
  const RUNS_V230 = running("v2.3.0");
  const RUNS_V250 = running("v2.5.0");
  const withRunning = (runs: ZeropsProjectFlowValue, props: Record<string, unknown>) =>
    renderToStaticMarkup(
      <ZeropsProjectFlowContext.Provider value={runs}>
        <SidebarZeropsTree
          candidates={[CRM_DEV, CRM_PROD]}
          complete
          onBrowseProjects={() => {}}
          onSelect={() => {}}
          {...props}
        />
      </ZeropsProjectFlowContext.Provider>,
    );

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
    expect(html).not.toContain('data-zerops-primary-action="Merge"');
    expect(html).not.toContain('aria-label="Passing"');
  });

  it("draws Gitea's change rows once it answered, and never the remembered ones", () => {
    const html = render([CRM_DEV, CRM_PROD], {
      getFlow: () => flowOf({ changesKnown: true, pullRequests: [pull(15, { title: "Live" })] }),
      remembered: remembering([pull(14, { title: "Remembered" })]),
    });
    expect(html).toContain("#15 Live");
    expect(html).not.toContain("Remembered");
    expect(html).toContain('data-zerops-primary-action="Merge"');
  });

  it("says what a stop last ran until it is read, rather than Checking", () => {
    const html = render([CRM_DEV, CRM_PROD], {
      getFlow: () => flowOf({ changesKnown: false }),
      remembered: remembering(undefined, "v2.4.0"),
    });
    expect(stop(html, "crm-prod")).toContain(">v2.4.0<");
    // Its badge still says it is being read: only the line stands on memory.
    expect(stop(html, "crm-prod")).not.toContain(">Checking what runs here…<");
  });

  it("keeps the name it last saw until Gitea answers, which may name the release instead", () => {
    const unread = withRunning(RUNS_V230, {
      getFlow: () => flowOf({ changesKnown: false }),
      remembered: remembering(undefined, "v2.4.0"),
    });
    expect(stop(unread, "crm-prod")).toContain("v2.4.0");
    expect(stop(unread, "crm-prod")).not.toContain("v2.3.0");
    const answered = withRunning(RUNS_V250, {
      getFlow: () => flowOf({ changesKnown: true }),
      remembered: remembering(undefined, "v2.4.0"),
    });
    expect(stop(answered, "crm-prod")).toContain("v2.5.0");
  });

  it("reports what it drew of what it read, for the memory to keep", () => {
    const drawn: SidebarDrawn[] = [];
    const change = pull(4);
    mount(
      <ZeropsProjectFlowContext.Provider value={RUNS_V250}>
        <SidebarZeropsTree
          candidates={[CRM_DEV, CRM_PROD]}
          complete
          getFlow={() => flowOf({ changesKnown: true, pullRequests: [change] })}
          onBrowseProjects={() => {}}
          onDrawn={(next: SidebarDrawn) => drawn.push(next)}
          onSelect={() => {}}
        />
      </ZeropsProjectFlowContext.Provider>,
    );
    expect(drawn.at(-1)).toEqual({ changes: { aaa: [change] }, stops: { "crm-prod": "v2.5.0" } });
  });
});

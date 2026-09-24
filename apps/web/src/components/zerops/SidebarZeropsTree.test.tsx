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
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import type { ZeropsAgentActivity } from "~/zerops/agentActivity";
import { ZeropsProjectFlowContext, type ZeropsProjectFlowValue } from "~/zerops/projectFlowContext";
import {
  groupFlowInputOf,
  groupMemberFactsOf,
  nextStepTone,
  productionAddable,
  type GroupFlowReads,
} from "./projects/projectsView.logic";
import { ProjectHeader, SidebarZeropsTree, type SidebarProjectFlow } from "./SidebarZeropsTree";
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
    expect(row).toContain("hover:bg-sidebar-row-hover");
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

  it("lists production then its stage after the Mates, the Mate's own left out", () => {
    const html = render([CRM_DEV, CRM_STAGE, CRM_PROD]);
    expect(html).toContain('data-zerops-surface="sidebar-environment-rows"');
    // Production keeps the full stop treatment; the stage is a muted line of
    // its own, a different surface entirely (`groupFlow`'s own order, the
    // owner, 2026-09-23).
    expect(html.match(/data-zerops-surface="sidebar-environment"/gu)).toHaveLength(1);
    expect(html.match(/data-zerops-surface="sidebar-group-stage"/gu)).toHaveLength(1);
    // Production first — the order the code travels — after the Mate, and the
    // stage after production, never before it.
    expect(html.indexOf('data-zerops-surface="sidebar-mate"')).toBeLessThan(
      html.indexOf('data-zerops-project="crm-prod"'),
    );
    expect(html.indexOf('data-zerops-project="crm-prod"')).toBeLessThan(
      html.indexOf('data-zerops-project="crm-stage"'),
    );
    // The stops are open, and they are not a count to click open: the fold is
    // an exception a person asks for, never the state they are handed.
    expect(html).not.toContain("2 environments");
    expect(html).toContain('data-zerops-surface="sidebar-stops-fold"');
    expect(html).toContain('aria-expanded="true"');
    // A project whose only environment is its Mate's has no stops to list.
    expect(render([CRM_DEV])).not.toContain("sidebar-environment-rows");
  });

  it("never draws a stage row where the group has none — no empty or add slot", () => {
    const html = render([CRM_DEV, CRM_PROD]);
    expect(html).not.toContain("follows main");
    expect(html).not.toContain('data-zerops-surface="sidebar-group-stage"');
  });

  it("draws every group stage after production, each a muted line by its own name", () => {
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
    expect(prodAt).toBeLessThan(stage1At);
    expect(stage1At).toBeLessThan(stage2At);
    expect(html).toContain("↳ stage · follows main");
    expect(html).toContain("↳ stage 2 · follows main");
  });

  it("says a stop's own name, not the project's name a third time", () => {
    const html = render([LINKS_MATE, LINKS_STAGE, LINKS_PROD]);
    // The heading already says Links; the rows say what tells them apart.
    expect(html).toContain("↳ stage · follows main");
    expect(html).toContain(">production<");
    expect(html).not.toContain("Links - stage");
    expect(html).not.toContain(">Links - production<");
  });

  it("drops the role pill where the name it shortened to already says the role", () => {
    const html = render([LINKS_MATE, LINKS_STAGE, LINKS_PROD]);
    const rows = html.slice(html.indexOf('data-zerops-surface="sidebar-environment-rows"'));
    expect(rows).not.toContain(String.raw`data-zerops-surface="role-tag"`);
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

  it("draws a production being created as setting up, busy, before the stage, with nothing to press", () => {
    const html = render([CRM_DEV, CRM_STAGE], {
      births: [birth({ projectId: "crm-prod-new", kind: "production", displayName: "production" })],
    });
    const at = html.indexOf('data-zerops-project="crm-prod-new"');
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(html.indexOf('data-zerops-project="crm-stage"'));
    const row = html.slice(html.lastIndexOf("<li", at)).split("</li>")[0]!;
    expect(row).toContain('aria-busy="true"');
    expect(row).toContain('data-zerops-status-tone="pending"');
    expect(row).toContain(">production<");
    expect(row).toContain(">Setting up production…<");
    expect(row).not.toContain("<button");
    expect(comingRows(html)).toHaveLength(0);
  });

  it("draws a stage being created as the muted line under the stops", () => {
    const html = render([CRM_DEV, CRM_PROD], {
      births: [birth({ projectId: "crm-stage-new", kind: "stage", displayName: "stage" })],
    });
    const at = html.indexOf('data-zerops-project="crm-stage-new"');
    expect(at).toBeGreaterThan(html.indexOf('data-zerops-project="crm-prod"'));
    const row = html.slice(html.lastIndexOf("<li", at)).split("</li>")[0]!;
    expect(row).toContain('aria-busy="true"');
    expect(row).toContain(">↳ Setting up a stage…<");
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

  it("agrees with the page: a merged change offers Add production here too", () => {
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
    expect(html).toContain('data-zerops-surface="sidebar-project-next-step"');
    expect(html).toContain("main has code, no production yet");
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
    // Not hover-only: the button's own name carries it, so a keyboard and a
    // screen reader reach the same answer a pointer does.
    expect(html).toContain("Release: puts 2 changes live");
    expect(html).toContain("Add a search box above the list");
    expect(html).toContain("Rename the app in the page title");
  });

  it("says moving, not blocked, where a production is carrying work nobody can see", () => {
    const html = withFlow(
      [CRM_DEV, CRM_STAGE, CRM_PROD],
      flow({
        releaseContents: [{ commits: [{ sha: "a", subject: "Add a search box above the list" }] }],
      }),
    );
    // What is merged and not live is worn by *Release* now, not by a separate
    // chip a line below it: one fact, one element, and it is the one that
    // deals with it.
    const at = html.indexOf('data-zerops-surface="verb-count"');
    expect(at).toBeGreaterThan(-1);
    const chip = html.slice(html.lastIndexOf("<span", at), html.indexOf("</span>", at));
    // The count rides the verb: `1`, on the button that would ship it.
    expect(chip).toContain(">1");
    // Muted text beside a green badge read as settled: the badge only reports
    // the last deploy, and work merged but not live is the thing to act on.
    expect(chip).not.toContain("text-sidebar-muted-foreground");
    // But it is *moving*, not stuck. Amber is what a change that cannot land
    // wears, and this verb sat beside one in the identical chip.
    expect(chip).toContain("--zerops-status-busy");
    expect(chip).not.toContain("--zerops-status-attention");
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

  it("gives production its last deploy as a dot and Release when offered; the stage stays a muted line", () => {
    const html = withFlow([CRM_DEV, CRM_STAGE, CRM_PROD]);
    // Production first, the stage after it.
    expect(html.indexOf('data-zerops-project="crm-prod"')).toBeLessThan(
      html.indexOf('data-zerops-project="crm-stage"'),
    );
    const production = html.slice(
      html.indexOf('data-zerops-project="crm-prod"'),
      html.indexOf('data-zerops-project="crm-stage"'),
    );
    expect(production).toContain('aria-label="Running"');
    expect(production).toContain('data-zerops-primary-action="Release"');
    const stage = html.slice(html.indexOf('data-zerops-project="crm-stage"'));
    expect(stage).toContain("↳ crm-stage · follows main");
    expect(stage).not.toContain("Release");
    expect(stage).not.toContain('data-zerops-surface="sidebar-stop-badge"');
    expect(withFlow([CRM_DEV, CRM_STAGE, CRM_PROD], flow({ releaseOffered: false }))).not.toContain(
      "Release",
    );
  });

  it("says a release on its way on production's line, where the menu has the tag", () => {
    const html = withFlow(
      [CRM_DEV, CRM_STAGE, CRM_PROD],
      flow({ releaseOffered: false, releaseInFlight: "v0.2.0" }),
    );
    const production = html.slice(
      html.indexOf('data-zerops-project="crm-prod"'),
      html.indexOf('data-zerops-project="crm-stage"'),
    );
    expect(production).toContain(">Releasing v0.2.0…<");
    expect(production).toContain('data-zerops-status-tone="pending"');
    expect(production).not.toContain('data-zerops-primary-action="Release"');
  });

  it("keeps the timeline's shape with nothing read: no row, no dot, no verb", () => {
    const html = render([CRM_DEV, CRM_STAGE, CRM_PROD]);
    expect(html).toContain('data-zerops-surface="sidebar-environment-rows"');
    expect(html).not.toContain("sidebar-pull-request");
    expect(html).not.toContain("status-dot");
    expect(html).not.toContain("Release");
  });

  it("keeps a stop's own page reachable and its state visible while folded", () => {
    const html = withFlow([CRM_DEV, CRM_STAGE, CRM_PROD]);
    // Open by default, and the fold is a verb of its own rather than a state
    // a project is handed.
    expect(html).toContain('data-zerops-surface="sidebar-stops-fold"');
    expect(html).toContain("Hide the stages and the production");
  });

  it("draws one spine, and branches a change off it instead of onto it", () => {
    const html = withFlow([CRM_DEV, CRM_STAGE, CRM_PROD]);
    const count = (needle: string) => html.split(needle).length - 1;
    // The fold above the stops stands on the line too.
    const rows =
      count('data-zerops-surface="sidebar-mate"') +
      count('data-zerops-surface="sidebar-environment"') +
      count('data-zerops-surface="sidebar-group-stage"') +
      count('data-zerops-surface="sidebar-pull-request"') +
      count('data-zerops-surface="sidebar-stops-fold"');
    const changes = count('data-zerops-surface="sidebar-pull-request"');
    const painted = count('class="w-px flex-1 bg-[var(--zerops-rail)]"');
    const blank = count('class="w-px flex-1"');
    expect(rows).toBeGreaterThan(0);
    expect(changes).toBeGreaterThan(0);
    // Every row carries both halves wherever it sits on the line, a change
    // included: its fork builds the spine the same way so it lands on the same
    // half pixel. Leaving one out lets the other take the free space, which shoved the
    // first face of every group 24px above its row and every last badge 17px
    // below it.
    expect(painted + blank).toBe(rows * 2);
    // Unpainted only at the two ends: the first node of the group and the last.
    expect(blank).toBe(2);
    // A change is not a node on the line — it branches off one. Drawn as a
    // node it read as one more Mate however small its dot.
    expect(count('data-zerops-rail="fork"')).toBe(changes);
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
      "fix-deploy": { dot: true },
      merge: { dot: true },
      unblock: { dot: true },
      release: { dot: true },
      "add-production": { dot: true },
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
  const stop = (html: string, id: string) =>
    html.slice(html.indexOf(`data-zerops-project="${id}"`)).split("</li>")[0]!;

  it("says a deploy running on production in words on its line, beside what it deploys", () => {
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
    expect(production).toContain(">Deploying…<");
    expect(production).toContain(">v0.2.0<");
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
    expect(stop(html, "crm-prod")).toContain("Nothing deployed yet");
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
    expect(stop(html, "crm-prod")).toContain('aria-label="Running"');
  });

  it("never shows deployment detail on a group stage — it stays the muted line that follows main", () => {
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
    expect(stop(html, "crm-stage")).toContain("↳ crm-stage · follows main");
    expect(stop(html, "crm-stage")).not.toContain("v1.4.0");
    expect(stop(html, "crm-stage")).not.toContain("Checking what runs here");
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
    if (page.kind === "none") expect(dot).toBeUndefined();
    else expect(dot).toContain(`aria-label="${page.text}"`);
  });
});

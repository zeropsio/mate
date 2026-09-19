import type { EnvironmentRow, FlowPullRequest } from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import type { ZeropsAgentActivity } from "~/zerops/agentActivity";
import { SidebarZeropsTree, type SidebarProjectFlow } from "./SidebarZeropsTree";

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
    expect(html).toContain('data-mate-face-size="sm"');
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

  it('says nothing while the candidate list is on its first read, rather than "none"', () => {
    expect(render([], { unread: true })).toBe("");
    // Read once and Mate-less: the empty state, as before.
    expect(render([CRM_STAGE], { unread: false })).toContain("sidebar-environments-empty");
  });

  it("lights the open Mate's row the way the menu lights its open thread", () => {
    const html = render([CRM_DEV], { activeProjectId: "crm-dev" });
    expect(html).toContain('aria-current="true"');
    expect(html).toContain("bg-sidebar-row-active");
  });

  it("lists the other environments after the Mates as the timeline's stops, the Mate's own left out", () => {
    const html = render([CRM_DEV, CRM_STAGE, CRM_PROD]);
    expect(html).toContain('data-zerops-surface="sidebar-environment-rows"');
    expect(html.match(/data-zerops-surface="sidebar-environment"/gu)).toHaveLength(2);
    // Stage before production — the order the code travels — and after the Mate.
    expect(html.indexOf('data-zerops-surface="sidebar-mate"')).toBeLessThan(
      html.indexOf("crm-stage"),
    );
    expect(html.indexOf("crm-stage")).toBeLessThan(html.indexOf("crm-prod"));
    // Nothing to unfold: the stops are the menu's, not a count to click open.
    expect(html).not.toContain("2 environments");
    expect(html).not.toContain("aria-expanded");
    // A project whose only environment is its Mate's has no stops to list.
    expect(render([CRM_DEV])).not.toContain("sidebar-environment-rows");
  });

  it("says a stop's own name, not the project's name a third time", () => {
    const html = render([LINKS_MATE, LINKS_STAGE, LINKS_PROD]);
    // The heading already says Links; the rows say what tells them apart.
    expect(html).toContain(">stage<");
    expect(html).toContain(">production<");
    expect(html).not.toContain(">Links - stage<");
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

describe("the project's flow under it", () => {
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
    mergeable: true,
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
    version: { name: undefined, commit: "3f9c1b2", taggedBy: undefined, label: "3f9c1b2" },
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
    // The way into Gitea is the title; the checks are a dot, not a word.
    expect(html).toContain('href="https://gitea.example/crm/appdev/pulls/4"');
    expect(html).toContain('aria-label="Passing"');
    expect(html).not.toContain(">Passing</span>");
  });

  it("offers Merge only where Gitea said the branch merges", () => {
    expect(withFlow([CRM_DEV, CRM_STAGE])).toContain('data-zerops-primary-action="Merge"');
    expect(
      withFlow([CRM_DEV, CRM_STAGE], flow({ pullRequests: [pull(4, { mergeable: false })] })),
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

  it("wears the attention tone where a production is carrying work nobody can see", () => {
    const html = withFlow(
      [CRM_DEV, CRM_STAGE, CRM_PROD],
      flow({
        releaseContents: [{ commits: [{ sha: "a", subject: "Add a search box above the list" }] }],
      }),
    );
    const at = html.indexOf('data-zerops-surface="sidebar-environment-behind"');
    expect(at).toBeGreaterThan(-1);
    const chip = html.slice(html.lastIndexOf("<span", at), html.indexOf("</span>", at));
    expect(chip).toContain("1 waiting");
    // Muted text beside a green badge read as settled: the badge only reports
    // the last deploy, and work merged but not live is the thing to act on.
    expect(chip).toContain("--zerops-status-attention-surface");
    expect(chip).not.toContain("text-sidebar-muted-foreground");
  });

  it("keeps the verb bare where nothing said what a release carries", () => {
    const html = withFlow([CRM_DEV, CRM_STAGE, CRM_PROD]);
    expect(html).toContain('data-zerops-primary-action="Release"');
    expect(html).not.toContain("puts");
  });

  it("says why a pull request offers no Merge rather than leaving a dead end", () => {
    const running = withFlow(
      [CRM_DEV, CRM_STAGE],
      flow({ pullRequests: [pull(4, { mergeable: false, checks: "pending" })] }),
    );
    expect(running).toContain('data-zerops-surface="sidebar-pull-request-blocked"');
    expect(running).toContain("checks running");

    const stale = withFlow(
      [CRM_DEV, CRM_STAGE],
      flow({ pullRequests: [pull(4, { mergeable: false, checks: "passing" })] }),
    );
    expect(stale).toContain("needs a rebase");

    // A red dot with no word beside it is the row going quiet at the moment it
    // has most to say: every refusal is written out, the red one included.
    const failed = withFlow(
      [CRM_DEV, CRM_STAGE],
      flow({
        pullRequests: [pull(4, { mergeable: false, checks: "failing", checkWord: "Failing" })],
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

  it("gives each environment its last deploy as a dot, and the production Release when offered", () => {
    const html = withFlow([CRM_DEV, CRM_STAGE, CRM_PROD]);
    const stage = html.slice(html.indexOf("crm-stage"), html.indexOf("crm-prod"));
    expect(stage).toContain('aria-label="Deployed"');
    expect(stage).not.toContain("Release");
    const production = html.slice(html.indexOf("crm-prod"));
    expect(production).toContain('data-zerops-primary-action="Release"');
    expect(withFlow([CRM_DEV, CRM_STAGE, CRM_PROD], flow({ releaseOffered: false }))).not.toContain(
      "Release",
    );
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
    const painted = count('class="w-px flex-1 bg-sidebar-border"');
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
    expect(count("rounded-bl-md")).toBe(changes);
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

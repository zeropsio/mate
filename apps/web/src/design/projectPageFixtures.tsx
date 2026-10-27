/**
 * A project page's column for the overview harness (`?page=`): its environments, spend,
 * automation, repositories and history, as `ZeropsGroupPane` draws them once every read is in.
 * Acme Store runs a production and three stages with two automated Mates; Tea Shop runs a stage
 * and a production; any other project has nothing released yet. Fixtures only: nothing here ships.
 */
import { HqEnvironmentId, ProjectId } from "@t3tools/contracts";
import type { CanonicalEnvironmentRow as EnvironmentRow } from "@t3tools/client-runtime/zerops";
import type { HqAppTask } from "@t3tools/shared/hqIntake";
import type { FlowPullRequest, FlowReleaseRow } from "@t3tools/client-runtime/zerops";
import type { MateTintId } from "@t3tools/shared/brand";
import type { ReactNode } from "react";

import {
  ProjectAutomationView,
  type AutomationControls,
  type PoolMate,
} from "~/components/zerops/projectAutomation/ProjectAutomation";
import type { SourceRow } from "~/components/zerops/projectAutomation/projectAutomation.logic";
import { boardOf } from "~/components/zerops/projectAutomation/taskBoard.logic";
import { ProjectAccessChips } from "~/components/zerops/projects/ProjectAccessChips";
import { ProjectHistoryView } from "~/components/zerops/projects/ProjectHistory";
import { historyReleases } from "~/components/zerops/projects/projectHistory.logic";
import { MateFace } from "~/components/zerops/primitives";
import { ProjectSpendSectionView } from "~/components/zerops/projects/ProjectSpend";
import type { ProjectPerson } from "~/components/zerops/projects/projectPeople.logic";
import { joinSpend } from "~/components/zerops/projects/projectSpend.logic";
import type { ReleaseOffer } from "~/components/zerops/ZeropsReleaseVerb";
import { ZeropsGroupPane } from "~/components/zerops/ZeropsGroupDetail";
import type { AccountScope } from "@t3tools/client-runtime/zerops/data";
import { InventoryContext, type Inventory } from "~/zerops/inventoryContext";
import { ZeropsDataContext, type ZeropsDataContextValue } from "~/zerops/zeropsDataContext";

const NOW = Date.now();
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const nothing = () => {};
const sha = (seed: string) => seed.padEnd(40, "0").slice(0, 40);

function environment(
  projectId: string,
  name: string,
  tier: EnvironmentRow["tier"],
  label: string,
  source = tier === "production" ? "release" : "main",
): EnvironmentRow {
  return {
    id: HqEnvironmentId.make(projectId),
    target: { kind: "zerops", projectId: ProjectId.make(projectId) },
    name,
    tier,
    source,
    tone: "good",
    version: {
      name: tier === "production" ? label : undefined,
      label,
      commit: "3f9c1b2e",
      sha: sha("3f9c1b2e"),
      taggedBy: undefined,
    },
    versionRepository: "appdev",
  } as EnvironmentRow;
}

/** Every Mate a page's History names, as the harness's cards draw them. */
const MATES: Readonly<Record<string, { readonly name: string; readonly tint: MateTintId }>> = {
  "raya-t": { name: "Raya", tint: "olive" },
  "vera-t": { name: "Vera", tint: "amber" },
  odo: { name: "Odo", tint: "slate" },
  tess: { name: "Tess", tint: "rose" },
  "juno-s": { name: "Juno", tint: "sky" },
  "mira-s": { name: "Mira", tint: "amber" },
  "ines-s": { name: "Ines", tint: "olive" },
  "odo-s": { name: "Odo", tint: "slate" },
  "tess-s": { name: "Tess", tint: "rose" },
};

/** A change a Mate landed `minutes` ago, mirrored to GitHub's pull request `github`. */
function landed(
  number: number,
  title: string,
  mateProjectId: string,
  minutes: number,
  github = number,
): FlowPullRequest {
  return {
    repository: "appdev",
    number,
    title,
    kind: "code",
    mateProjectId,
    url: undefined,
    mergeability: "mergeable",
    behind: false,
    merged: true,
    mergedAt: ago(minutes),
    headSha: sha(String(number)),
    baseBranch: "main",
    line: `appdev #${String(number)}`,
    updatedAt: ago(minutes),
    pullRequest: {
      number: github,
      url: `https://github.com/acme/store/pull/${String(github)}`,
      state: "merged",
    },
  };
}

function shipped(
  tag: string,
  minutes: number,
  over: Partial<FlowReleaseRow> = {},
): Pick<FlowReleaseRow, "tag" | "taggedAt" | "verdict" | "rollbackOf" | "standing" | "history"> {
  return { tag, taggedAt: ago(minutes), verdict: "approved", standing: undefined, ...over };
}

/** Recorded release membership for the overview fixtures. */
function recordedHistory(
  input: Parameters<typeof historyReleases>[0],
  members: readonly (readonly number[])[],
  outside: readonly number[],
) {
  return historyReleases({
    ...input,
    releases: input.releases.map((release, index) => {
      const changes = (members[index] ?? []).flatMap((number) =>
        input.merged
          .filter((change) => change.number === number)
          .map((change) => ({ repo: change.repository, number, title: change.title })),
      );
      return {
        ...release,
        history: {
          changes,
          commitCount: changes.length + (outside[index] ?? 0),
          outsideCommitCount: outside[index] ?? 0,
          ranges: [],
        },
      };
    }),
  });
}

const DAY = 24 * 60;
const TEA_HISTORY = recordedHistory(
  {
    releases: [
      shipped("v0.1.3", 6 * DAY, { standing: "live" }),
      shipped("v0.1.2", 6.5 * DAY),
      shipped("v0.1.1", 7 * DAY),
      shipped("v0.1.0", 8 * DAY),
    ],
    merged: [
      landed(17, "Centre the shop so a cropped demo frame shows it all", "raya-t", 6 * DAY + 15),
      landed(16, "Hide sold out switch remembered across visits", "vera-t", 6 * DAY + 18),
      landed(13, "Price per 100 g leads on tea cards", "vera-t", 6 * DAY + 40),
      landed(11, "Add a Surprise me chip to the tea sommelier", "tess", 6 * DAY + 90),
      landed(10, "Back to top link in the footer, reading “↑ Top”", "vera-t", 6.6 * DAY),
      landed(7, "Teas in PostgreSQL, a Valkey cache and a tea-house redesign", "raya-t", 6.8 * DAY),
      landed(5, "In stock and Sold out labels with a Hide sold out switch", "vera-t", 7.2 * DAY),
      landed(6, "Footer with opening hours and contact email", "tess", 7.4 * DAY),
      landed(4, "Let the tea sommelier answer tea questions from the web", "raya-t", 8.2 * DAY),
    ],
  },
  [[17, 16, 13, 11], [10, 7], [5, 6], [4]],
  [0, 1, 0, 0],
);

/** Acme Store: seven releases, the newest five shown, one rolled back from. */
const ACME_HISTORY = recordedHistory(
  {
    releases: [
      shipped("v0.1.59", 60, { standing: "live", rollbackOf: "v0.1.57" }),
      shipped("v0.1.58", 3 * 60),
      shipped("v0.1.57", 20 * 60),
      shipped("v0.1.56", 2 * 24 * 60),
      shipped("v0.1.55", 3 * 24 * 60),
      shipped("v0.1.54", 5 * 24 * 60),
      shipped("v0.1.53", 8 * 24 * 60),
    ],
    merged: [
      landed(14, "Prices no longer round down in the cart", "tess-s", 5 * 60),
      landed(12, "Fix the VAT rate table for Ireland", "mira-s", 21 * 60),
      landed(11, "Fix the sold-out badge on mobile", "odo-s", 8.5 * 24 * 60),
      landed(10, "Gift cards at checkout", "mira-s", 30 * 60),
      landed(9, "Czech names for every product", "ines-s", 4 * 24 * 60),
    ],
  },
  [[], [14], [12, 10], [], [9], [], [11]],
  [0, 0, 0, 1, 0, 0, 0],
);

/** A Mate's face, as the harness's cards draw it. */
function mateFace(projectId: string): ReactNode {
  const mate = MATES[projectId];
  return mate === undefined ? undefined : <MateFace size={20} state="idle" tint={mate.tint} />;
}

/** A project page's History, drawn from its fixtures. */
function PageHistory({ groupId }: { readonly groupId: string }) {
  return (
    <ProjectHistoryView
      face={mateFace}
      mateName={(projectId) => MATES[projectId]?.name}
      onOpen={nothing}
      releases={groupId === "acme-store" ? ACME_HISTORY : TEA_HISTORY}
      repo={{ appId: groupId, repo: "appdev" }}
    />
  );
}

const RELEASE_WAITING: ReleaseOffer = {
  offered: true,
  releasing: false,
  tag: "v0.1.60",
  reason: undefined,
  onReview: nothing,
};
const RELEASE_NONE: ReleaseOffer = { ...RELEASE_WAITING, offered: false, tag: undefined };

const POOL: ReadonlyArray<PoolMate> = [
  {
    projectId: "odo-s",
    name: "Odo",
    tint: "slate",
    shape: undefined,
    automation: { task: { number: 42, title: "Prices round wrong in the cart" } },
  },
  { projectId: "tess-s", name: "Tess", tint: "rose", shape: undefined, automation: { task: null } },
];
const ADMIN: AutomationControls = {
  onAddMate: nothing,
  onTakeFrom: nothing,
  onEdit: nothing,
  onAskStop: nothing,
  onKeep: nothing,
  pressOf: () => ({ kind: "idle" }),
  onStop: nothing,
  onReadAgain: nothing,
  onOpenSettings: nothing,
};
const SOURCES: ReadonlyArray<SourceRow> = [
  { key: "github", kind: "github", words: "GitHub issues labelled “mate”" },
  { key: "slack", kind: "slack", words: "Slack #store-asks", disconnected: false },
];
const TASK: HqAppTask = {
  id: "t42",
  title: "Prices round wrong in the cart",
  label: "acme/store#42",
  url: "https://github.com/acme/store/issues/42",
  state: "working",
  mate: { projectId: "odo-s", name: "Odo" },
  requestedBy: "nova-dev",
  createdAt: ago(14),
  startedAt: ago(12),
  endedAt: null,
  spentUsd: 0.38,
  workedMs: 720_000,
  detail: null,
  change: null,
  pullRequest: null,
  link: null,
};
const TASKS: ReadonlyArray<HqAppTask> = [
  TASK,
  {
    ...TASK,
    id: "t45",
    title: "Czech names for every product",
    label: "acme/store#45",
    state: "queued",
    position: 1,
    mate: null,
    startedAt: null,
    spentUsd: null,
  },
  {
    ...TASK,
    id: "t39",
    title: "Prices no longer round down in the cart",
    state: "merged",
    mate: { projectId: "tess-s", name: "Tess" },
    endedAt: ago(300),
    spentUsd: 1.93,
    change: { repo: "appdev", number: 14 },
    pullRequest: null,
  },
  {
    ...TASK,
    id: "t31",
    title: "Fix the sold-out badge on mobile",
    state: "merged",
    mate: { projectId: "odo-s", name: "Odo" },
    endedAt: ago(8 * 24 * 60),
    spentUsd: 3.68,
    change: { repo: "appdev", number: 11 },
    pullRequest: null,
  },
];

const REPOS = [
  {
    name: "appdev",
    mainHead: null,
    updatedAt: ago(4),
    remote: {
      url: "https://github.com/acme/store.git",
      repositoryId: "1",
      keptAt: ago(60 * 24),
      keptBy: "Nova Dev",
      expiresAt: null,
      invalidSince: null,
    },
  },
];

/** Thirty days of spend: compute every day, model tokens on the days the automated Mates worked. */
const DAYS = Array.from({ length: 30 }, (_, at) =>
  new Date(NOW - (29 - at) * 86_400_000).toISOString().slice(0, 10),
);
const SPEND = {
  kind: "loaded" as const,
  series: joinSpend(
    { days: DAYS, usd: DAYS.map((_, at) => 0.42 + (at % 5) * 0.04) },
    new Map(DAYS.map((day, at) => [day, at % 3 === 0 ? 1.2 + (at % 4) * 0.35 : 0])),
    DAYS.at(-1)!,
  ),
};

/** A project set up today: nothing billed before it. */
const SPEND_TODAY = {
  kind: "loaded" as const,
  series: joinSpend(
    { days: DAYS, usd: DAYS.map((_, at) => (at === 29 ? 0.21 : 0)) },
    new Map(DAYS.map((day, at) => [day, at === 29 ? 0.63 : 0])),
    DAYS.at(-1)!,
  ),
};

/** A failed deploy's log reads the account's projects: stand-ins that hold none. */
function Standins({ children }: { readonly children: ReactNode }) {
  const inventory: Inventory = {
    projects: [],
    isLoading: false,
    error: null,
    projectRefs: new Map(),
    authority: new Map(),
    lost: new Set(),
    deleted: [],
  };
  const data: ZeropsDataContextValue = {
    scope: {} as AccountScope,
    signals: { hidden: () => false, online: () => true, listen: () => () => undefined },
    organizationRef: () => {
      throw new Error("not in the harness");
    },
    projectRef: () => {
      throw new Error("not in the harness");
    },
  };
  return (
    <ZeropsDataContext value={data}>
      <InventoryContext value={inventory}>{children}</InventoryContext>
    </ZeropsDataContext>
  );
}

const ACME_ENVIRONMENTS = [
  environment("store-prod", "production", "production", "v0.1.59"),
  environment("store-stage", "stage", "stage", "3f9c1b2"),
  environment("store-checkout", "stage-checkout", "stage", "a1b2c3d", "checkout-redesign"),
  environment("store-perf", "stage-perf", "stage", "9d8e7f6", "perf-budget"),
];

/** Who reaches a project, as its card's People draws them. */
export function ProjectPagePeople() {
  const people = ["Nova Dev", "Ines Vale", "Mira Holt", "Theo Lind"].map((name, index) => ({
    key: `cu-${String(index)}`,
    name,
    short: `${name.split(" ")[0] ?? name} ${name.split(" ")[1]?.[0] ?? ""}.`,
    initials: name
      .split(" ")
      .map((part) => part[0])
      .join(""),
    avatarUrl: null,
    email: null,
    role: index === 0 ? "Owner" : "Member",
    you: index === 0,
    creator: index === 0,
    pending: false,
    access: "Full access",
    line: "Full access",
    level: "full",
    across: [],
    note: null,
    change: null,
  })) as unknown as ReadonlyArray<ProjectPerson>;
  return (
    <ProjectAccessChips
      label="People"
      onAdd={nothing}
      onChoose={nothing}
      view={{ kind: "people", invite: true, candidates: [], people }}
    />
  );
}

/** The column beside a project's card on its page, by the project the harness opened. */
export function ProjectPageAside({ groupId }: { readonly groupId: string }) {
  const running = groupId === "acme-store" || groupId === "tea";
  const environments = groupId === "acme-store" ? ACME_ENVIRONMENTS : [];
  return (
    <Standins>
      <ZeropsGroupPane
        automation={
          <ProjectAutomationView
            admin={ADMIN}
            board={
              groupId === "acme-store"
                ? {
                    read: { state: "known", board: boardOf(TASKS, NOW, "acme-store") },
                    spend: "$21.40 of $40 this month",
                    onReadAgain: nothing,
                    onOpen: nothing,
                  }
                : undefined
            }
            onOpenMate={nothing}
            pool={groupId === "acme-store" ? POOL : []}
            sources={{
              rows: groupId === "acme-store" ? SOURCES : [],
              reading: false,
              withheld: false,
            }}
            workingOf={(projectId) => projectId === "odo-s"}
          />
        }
        environments={environments}
        finishing={false}
        groupId={groupId}
        history={running ? <PageHistory groupId={groupId} /> : null}
        name={groupId}
        onAdd={nothing}
        onFinish={nothing}
        onMirror={nothing}
        onSetUp={nothing}
        release={running ? RELEASE_WAITING : RELEASE_NONE}
        repo={running ? "appdev" : undefined}
        repos={running ? REPOS : []}
        slots={
          groupId === "acme-store"
            ? [
                {
                  kind: "environment",
                  tier: "production",
                  id: "store-prod",
                  note: { text: "2 changes waiting for production", review: true },
                },
                { kind: "environment", tier: "stage", id: "store-stage", note: undefined },
                { kind: "environment", tier: "stage", id: "store-checkout", note: undefined },
                { kind: "environment", tier: "stage", id: "store-perf", note: undefined },
              ]
            : [
                { kind: "slot", tier: "stage", name: "Stage", line: "Not added", add: true },
                {
                  kind: "slot",
                  tier: "production",
                  name: "Production",
                  line: "Not added",
                  add: true,
                },
              ]
        }
        spend={<ProjectSpendSectionView state={running ? SPEND : SPEND_TODAY} />}
      />
    </Standins>
  );
}

/**
 * A project page's column for the overview harness (`?page=`): its environments, spend,
 * automation, repositories and history, as `ZeropsGroupPane` draws them once every read is in.
 * Acme Store runs a production and three stages with two automated Mates; Tea Shop runs a stage
 * and a production; any other project has nothing released yet. Fixtures only: nothing here ships.
 */
import { HqEnvironmentId, ProjectId } from "@t3tools/contracts";
import type { CanonicalEnvironmentRow as EnvironmentRow } from "@t3tools/client-runtime/zerops";
import type { HqAppTask } from "@t3tools/shared/hqIntake";
import type { CompareCommit } from "@t3tools/shared/hqChanges";
import type { ReactNode } from "react";

import {
  ProjectAutomationView,
  type AutomationControls,
  type PoolMate,
} from "~/components/zerops/projectAutomation/ProjectAutomation";
import type { SourceRow } from "~/components/zerops/projectAutomation/projectAutomation.logic";
import { boardOf } from "~/components/zerops/projectAutomation/taskBoard.logic";
import { ProjectAccessChips } from "~/components/zerops/projects/ProjectAccessChips";
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

function commit(subject: string, seed: string, hoursAgo: number, mate?: string): CompareCommit {
  return {
    sha: sha(seed),
    subject,
    authorName: mate === undefined ? "Nova" : "Mate HQ",
    at: new Date(NOW - hoursAgo * 3_600_000).toISOString(),
    change: mate === undefined ? null : { number: 4, title: subject, mateProjectId: mate },
  };
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
        history={
          running
            ? {
                kind: "read",
                total: 4,
                commits: [
                  commit("One-page checkout", "b21d904c", 1, "juno-s"),
                  commit("Prices no longer round down in the cart", "5c3ea18b", 5, "tess-s"),
                  commit("Fix the VAT rate table for Ireland", "3f9c1b2e", 20),
                  commit("Gift cards at checkout", "9a7d2f10", 30, "mira-s"),
                ],
              }
            : { kind: "read", commits: [], total: 0 }
        }
        name={groupId}
        names={{
          mateNames: new Map([
            ["juno-s", "Juno"],
            ["tess-s", "Tess"],
            ["mira-s", "Mira"],
          ]),
        }}
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
        spend={<ProjectSpendSectionView state={SPEND} />}
        tags={new Map([[sha("3f9c1b2e"), ["v0.1.59"]]])}
      />
    </Standins>
  );
}

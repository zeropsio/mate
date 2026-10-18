/**
 * The project page's card grid under its road, for the detail harness: Tea Shop running with
 * changes waiting, ready and released (state c of the board), and a new project with nothing yet.
 * Fixtures only: nothing here ships.
 */
import type { FlowPullRequest } from "@t3tools/client-runtime/zerops";
import type { HqAppTask } from "@t3tools/shared/hqIntake";

import { MateFace } from "~/components/zerops/primitives";
import {
  ProjectAutomationView,
  type PoolMate,
} from "~/components/zerops/projectAutomation/ProjectAutomation";
import { boardOf } from "~/components/zerops/projectAutomation/taskBoard.logic";
import { ProjectAccessCardView } from "~/components/zerops/projects/ProjectAccessCard";
import { ProjectAccessChips } from "~/components/zerops/projects/ProjectAccessChips";
import { ProjectChangesCard } from "~/components/zerops/projects/ProjectChangesCard";
import { projectChangeGroups } from "~/components/zerops/projects/projectChangesCard.logic";
import { projectPeople } from "~/components/zerops/projects/projectPeople.logic";
import { ZeropsGroupPane } from "~/components/zerops/ZeropsGroupDetail";

const NOW = Date.now();
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const nothing = () => {};

const MATES = new Map([
  ["p-raya", { name: "Raya", tint: "olive" as const }],
  ["p-vera", { name: "Vera", tint: "amber" as const }],
  ["p-tess", { name: "Tess", tint: "rose" as const }],
  ["p-odo", { name: "Odo", tint: "slate" as const }],
]);
const mateOf = (projectId: string) => {
  const mate = MATES.get(projectId);
  return mate === undefined
    ? undefined
    : {
        name: mate.name,
        face: <MateFace shape={undefined} size={20} state="idle" tint={mate.tint} />,
      };
};

let next = 1;
function pull(title: string, mate: string, over: Partial<FlowPullRequest> = {}): FlowPullRequest {
  const number = next++;
  return {
    repository: "teashop",
    number,
    title,
    kind: "code",
    mateProjectId: mate,
    url: undefined,
    mergeability: "mergeable",
    behind: false,
    merged: false,
    mergedAt: undefined,
    headSha: `head${String(number)}`,
    baseBranch: "main",
    line: `teashop #${String(number)}`,
    updatedAt: ago(60),
    ...over,
  };
}
const landed = (title: string, mate: string, minutesAgo: number) =>
  pull(title, mate, { merged: true, mergedAt: ago(minutesAgo) });

const RUNNING_GROUPS = projectChangeGroups({
  open: [
    pull("Gift cards at checkout", "p-raya", { updatedAt: ago(60) }),
    pull("Tea of the month banner", "p-vera", { updatedAt: ago(120) }),
  ],
  merged: [
    landed("Prices per 100 g next to each tea", "p-vera", 25),
    landed("Search box on the tea list", "p-raya", 180),
    landed("Prices no longer round down in the cart", "p-tess", 300),
    landed("Show how many teas the list holds", "p-raya", 7 * 24 * 60),
    landed("Tea pages load their photos lazily", "p-vera", 7 * 24 * 60 + 30),
    landed("Fix the sold-out badge on mobile", "p-odo", 8 * 24 * 60),
    landed("Origin of each tea on its page", "p-raya", 13 * 24 * 60),
    landed("Steeping time on each tea", "p-vera", 14 * 24 * 60),
    landed("The tea list, first cut", "p-raya", 25 * 24 * 60),
  ],
  releases: [
    { tag: "v0.1.3", taggedAt: ago(6 * 24 * 60), live: true },
    { tag: "v0.1.2", taggedAt: ago(12 * 24 * 60), live: false },
    { tag: "v0.1.1", taggedAt: ago(19 * 24 * 60), live: false },
  ],
  stage: undefined,
  production: true,
});

const EMPTY_GROUPS = projectChangeGroups({
  open: [],
  merged: [],
  releases: [],
  stage: undefined,
  production: false,
});

const POOL: ReadonlyArray<PoolMate> = [
  {
    projectId: "p-odo",
    name: "Odo",
    tint: "slate",
    shape: undefined,
    automation: { task: { number: 42, title: "Prices round wrong in the cart" } },
  },
  { projectId: "p-tess", name: "Tess", tint: "rose", shape: undefined, automation: { task: null } },
];
const TASK: HqAppTask = {
  id: "t42",
  title: "Prices round wrong in the cart",
  label: "acme/tea-shop#42",
  url: "https://github.com/acme/tea-shop/issues/42",
  state: "working",
  mate: { projectId: "p-odo", name: "Odo" },
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
    title: "Czech names for every tea",
    label: "acme/tea-shop#45",
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
    mate: { projectId: "p-tess", name: "Tess" },
    endedAt: ago(300),
    spentUsd: 1.93,
    change: { repo: "teashop", number: 14 },
    pullRequest: null,
  },
];

const member = (id: string, fullName: string, roleCode: string) => ({
  id: `cu-${id}`,
  status: "ACTIVE",
  roleCode,
  user: { id: `u-${id}`, fullName },
});

const PEOPLE = projectPeople({
  members: {
    known: true,
    status: "ready",
    refused: false,
    list: [
      member("nova", "Nova Dev", "OWNER"),
      member("ida", "Ida Ops", "ADMIN"),
      member("ben", "Ben Build", "NO_ACCESS"),
      member("lea", "Lea Lint", "NO_ACCESS"),
    ],
  },
  projects: [{ projectId: "teashop-prod", kind: "production" }],
  grants: {
    "teashop-prod": {
      status: "ready",
      grants: [
        { clientUserId: "cu-ben", roleCode: "ADMIN" },
        { clientUserId: "cu-lea", roleCode: "READ_ONLY" },
      ],
    },
  },
  owners: {},
  pictures: {},
  viewerUserId: "u-nova",
  viewer: { roleCode: "OWNER", membershipId: "cu-nova" },
});

const TEASHOP_ACCESS = {
  state: "ready" as const,
  offerDomain: true,
  rows: [
    {
      key: "p:1",
      host: "teashop-a1b2.prg1.zerops.app",
      url: "https://teashop-a1b2.prg1.zerops.app",
      service: "app",
      port: 3000,
      tier: "production" as const,
      live: true,
    },
    {
      key: "s:1",
      host: "stage-teashop-a1b2.prg1.zerops.app",
      url: "https://stage-teashop-a1b2.prg1.zerops.app",
      service: "app",
      port: 3000,
      tier: "stage" as const,
      live: true,
    },
  ],
};

const REPOS = [
  {
    name: "teashop",
    mainHead: null,
    updatedAt: ago(4),
    remote: {
      url: "https://github.com/acme/tea-shop.git",
      repositoryId: "1",
      keptAt: ago(60 * 24),
      keptBy: "Nova Dev",
      expiresAt: null,
      invalidSince: null,
    },
  },
];

export function TeaShopCards() {
  return (
    <ZeropsGroupPane
      access={<ProjectAccessCardView model={TEASHOP_ACCESS} onManage={nothing} />}
      automation={
        <ProjectAutomationView
          board={{
            read: { state: "known", board: boardOf(TASKS, NOW, "tea-shop") },
            spend: "$21.40 of $40 this month",
            onReadAgain: nothing,
            onOpen: nothing,
          }}
          onOpenMate={nothing}
          pool={POOL}
          sources={{ rows: [], reading: false, withheld: false }}
          workingOf={(projectId) => projectId === "p-odo"}
        />
      }
      changes={
        <ProjectChangesCard
          groups={RUNNING_GROUPS}
          mateOf={mateOf}
          onOpen={nothing}
          onOpenRelease={nothing}
          read={{ state: "known" }}
        />
      }
      finishing={false}
      onFinish={nothing}
      people={
        <ProjectAccessChips card label="People" onAdd={nothing} onChoose={nothing} view={PEOPLE} />
      }
      repos={REPOS}
    />
  );
}

export function NewProjectCards() {
  return (
    <ZeropsGroupPane
      access={<ProjectAccessCardView model={{ state: "ready", rows: [], offerDomain: false }} />}
      automation={
        <ProjectAutomationView
          onOpenMate={nothing}
          pool={[]}
          sources={{ rows: [], reading: false, withheld: false }}
          workingOf={() => false}
        />
      }
      changes={
        <ProjectChangesCard
          emptyAction={{
            words: "No repository is declared for this project’s services yet.",
            label: "Set up an environment",
            onPress: nothing,
          }}
          groups={EMPTY_GROUPS}
          mateOf={mateOf}
          onOpen={nothing}
          read={{ state: "known" }}
        />
      }
      finishing={false}
      onFinish={nothing}
      people={<ProjectAccessChips card label="People" view={PEOPLE} />}
      repos={[]}
    />
  );
}

export function ReadingCards() {
  return (
    <ZeropsGroupPane
      access={<ProjectAccessCardView model={{ state: "reading", rows: [], offerDomain: false }} />}
      changes={
        <ProjectChangesCard
          groups={EMPTY_GROUPS}
          mateOf={mateOf}
          onOpen={nothing}
          read={{ state: "reading" }}
        />
      }
      finishing={false}
      onFinish={nothing}
      people={<ProjectAccessChips card label="People" view={{ kind: "reading" }} />}
    />
  );
}

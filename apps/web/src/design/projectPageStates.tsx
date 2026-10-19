/**
 * The project page's own cards in the five states it is designed against, for the overview
 * harness's `?page=s1` … `?page=s5`: (S1) brand new, (S2) in development with automated Mates,
 * (S3) typical, (S4) heavy, (S5) trouble. Each state is what its cards read; the page's head and
 * places are the harness's projects of the same ids.
 *
 * Fixtures only: nothing here ships. Every name is made up.
 */
import type { FlowPullRequest } from "@t3tools/client-runtime/zerops";
import type { MateTintId } from "@t3tools/shared/brand";
import type { HqAppTask } from "@t3tools/shared/hqIntake";
import type { ReactNode } from "react";

import { MateFace } from "~/components/zerops/primitives";
import {
  BudgetNeedView,
  ProjectAutomationView,
  type AutomationControls,
  type PoolMate,
} from "~/components/zerops/projectAutomation/ProjectAutomation";
import type { SourceRow } from "~/components/zerops/projectAutomation/projectAutomation.logic";
import { boardOf } from "~/components/zerops/projectAutomation/taskBoard.logic";
import { ProjectAccessCardView } from "~/components/zerops/projects/ProjectAccessCard";
import type { AccessCardModel } from "~/components/zerops/projects/projectAccessCard.logic";
import { ProjectAccessChips } from "~/components/zerops/projects/ProjectAccessChips";
import { ProjectChangesCard } from "~/components/zerops/projects/ProjectChangesCard";
import { projectChangeGroups } from "~/components/zerops/projects/projectChangesCard.logic";
import { projectPeople } from "~/components/zerops/projects/projectPeople.logic";
import { ProjectSpendCardView } from "~/components/zerops/projects/ProjectSpend";
import { joinSpend, type SpendState } from "~/components/zerops/projects/projectSpend.logic";

const NOW = Date.now();
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const DAY = 24 * 60;
const nothing = () => {};

/** Every Mate the five states name, by its project: its name and tint. */
const MATES: ReadonlyMap<string, { readonly name: string; readonly tint: MateTintId }> = new Map([
  ["s1-pia", { name: "Pia", tint: "sky" }],
  ["s2-oren", { name: "Oren", tint: "amber" }],
  ["s2-lida", { name: "Lida", tint: "violet" }],
  ["s2-kip", { name: "Kip", tint: "olive" }],
  ["s2-tam", { name: "Tam", tint: "coral" }],
  ["s3-ada", { name: "Ada", tint: "rose" }],
  ["s3-bo", { name: "Bo", tint: "sky" }],
  ["s4-juno", { name: "Juno", tint: "sky" }],
  ["s4-mira", { name: "Mira", tint: "amber" }],
  ["s4-ines", { name: "Ines", tint: "olive" }],
  ["s4-teo", { name: "Teo", tint: "violet" }],
  ["s4-kip", { name: "Kip", tint: "coral" }],
  ["s4-tam", { name: "Tam", tint: "rose" }],
  ["s4-rho", { name: "Rho", tint: "slate" }],
  ["s5-esme", { name: "Esme", tint: "coral" }],
  ["s5-nell", { name: "Nell", tint: "amber" }],
  ["s5-kip", { name: "Kip", tint: "olive" }],
  ["s5-tam", { name: "Tam", tint: "slate" }],
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

let next = 100;
/** A change of the state's repository, by its Mate. */
export function pageChange(
  title: string,
  mate: string,
  over: Partial<FlowPullRequest> = {},
): FlowPullRequest {
  const number = next++;
  return {
    repository: "app",
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
    line: `app #${String(number)}`,
    updatedAt: ago(60),
    ...over,
  };
}
const merged = (title: string, mate: string, minutesAgo: number) =>
  pageChange(title, mate, { merged: true, mergedAt: ago(minutesAgo) });

/** S2's open changes: two asking for review, one still being written. */
export const S2_OPEN: ReadonlyArray<FlowPullRequest> = [
  pageChange("Tag notes by colour", "s2-lida", { updatedAt: ago(25) }),
  pageChange("Export notes as Markdown", "s2-kip", { updatedAt: ago(70) }),
  pageChange("Reading list on the home page", "s2-oren", { ready: false, updatedAt: ago(4) }),
];

/** S3's open change, asking for review. */
export const S3_OPEN: ReadonlyArray<FlowPullRequest> = [
  pageChange("Seasonal box on the shop page", "s3-ada", { updatedAt: ago(40) }),
];

/** S4's open changes: four asking for review, three still being written. */
export const S4_OPEN: ReadonlyArray<FlowPullRequest> = [
  pageChange("One-page checkout", "s4-juno", { updatedAt: ago(30) }),
  pageChange("Gift cards at checkout", "s4-kip", { updatedAt: ago(55) }),
  pageChange("Stock count on each product", "s4-tam", { updatedAt: ago(90) }),
  pageChange("Faster product images", "s4-mira", { updatedAt: ago(200) }),
  pageChange("Wishlist that follows you between devices", "s4-teo", {
    ready: false,
    updatedAt: ago(6),
  }),
  pageChange("Returns in three clicks", "s4-rho", { ready: false, updatedAt: ago(12) }),
  pageChange("Order history filters", "s4-ines", { ready: false, updatedAt: ago(48) }),
];

/** S5's open change, asking for review. */
export const S5_OPEN: ReadonlyArray<FlowPullRequest> = [
  pageChange("Comments under each post", "s5-nell", { updatedAt: ago(90) }),
];

const EMPTY_SPEND_DAYS = Array.from({ length: 30 }, (_, at) =>
  new Date(NOW - (29 - at) * 86_400_000).toISOString().slice(0, 10),
);
const spend = (compute: (at: number) => number, tokens: (at: number) => number): SpendState => ({
  kind: "loaded",
  series: joinSpend(
    { days: EMPTY_SPEND_DAYS, usd: EMPTY_SPEND_DAYS.map((_, at) => compute(at)) },
    new Map(EMPTY_SPEND_DAYS.map((day, at) => [day, tokens(at)])),
    EMPTY_SPEND_DAYS.at(-1)!,
  ),
});

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
    ],
  },
  projects: [{ projectId: "prod", kind: "production" }],
  grants: { prod: { status: "ready", grants: [{ clientUserId: "cu-ben", roleCode: "ADMIN" }] } },
  owners: {},
  pictures: {},
  viewerUserId: "u-nova",
  viewer: { roleCode: "OWNER", membershipId: "cu-nova" },
});

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
  { key: "slack", kind: "slack", words: "Slack #asks", disconnected: false },
];

const pool = (
  ids: ReadonlyArray<string>,
  working: ReadonlyArray<string>,
): ReadonlyArray<PoolMate> =>
  ids.map((projectId) => {
    const mate = MATES.get(projectId)!;
    return {
      projectId,
      name: mate.name,
      tint: mate.tint,
      shape: undefined,
      automation: {
        task: working.includes(projectId) ? { number: 1, title: "A task" } : null,
      },
    };
  });

/** A task of the board: at work, queued or ended, by its Mate. */
function task(
  id: string,
  title: string,
  state: HqAppTask["state"],
  over: Partial<HqAppTask> = {},
): HqAppTask {
  return {
    id,
    title,
    label: `acme/app#${id}`,
    url: `https://github.com/acme/app/issues/${id}`,
    state,
    mate: null,
    requestedBy: "nova-dev",
    createdAt: ago(30),
    startedAt: null,
    endedAt: null,
    spentUsd: null,
    workedMs: null,
    detail: null,
    change: null,
    pullRequest: null,
    link: null,
    ...over,
  };
}
const atWork = (id: string, title: string, mate: string, minutes: number, usd: number) =>
  task(id, title, "working", {
    mate: { projectId: mate, name: MATES.get(mate)!.name },
    startedAt: ago(minutes),
    workedMs: minutes * 60_000,
    spentUsd: usd,
  });
const queued = (id: string, title: string, position: number, minutes: number) =>
  task(id, title, "queued", { position, createdAt: ago(minutes) });
const ended = (id: string, title: string, mate: string, minutes: number, usd: number) =>
  task(id, title, "merged", {
    mate: { projectId: mate, name: MATES.get(mate)!.name },
    startedAt: ago(minutes + 30),
    endedAt: ago(minutes),
    spentUsd: usd,
    change: { repo: "app", number: Number(id) },
  });

/**
 * A task its Mate finished whose change waits for review, mirrored to a pull request on GitHub:
 * HQ's change #`change`, GitHub's PR #`change + 1`.
 */
const inReviewTask = (id: string, title: string, mate: string, minutes: number, change: number) =>
  task(id, title, "done", {
    mate: { projectId: mate, name: MATES.get(mate)!.name },
    startedAt: ago(minutes + 40),
    endedAt: ago(minutes),
    spentUsd: 1.6,
    change: { repo: "app", number: change },
    pullRequest: {
      number: change + 1,
      url: `https://github.com/acme/app/pull/${String(change + 1)}`,
    },
  });

/** What HQ's navigation names of each pool Mate's latest task, by the task's id. */
const naming = (tasks: ReadonlyArray<HqAppTask>, ids: ReadonlyArray<string>) =>
  new Map(
    tasks
      .filter((entry) => ids.includes(entry.id))
      .map((entry) => [entry.id, { id: entry.id, title: entry.title, url: entry.url }] as const),
  );

const automation = (input: {
  readonly ids: ReadonlyArray<string>;
  readonly tasks: ReadonlyArray<HqAppTask>;
  readonly working: ReadonlyArray<string>;
  readonly gauge: { readonly words: string; readonly share: number };
  readonly spend: string;
  /** The tasks HQ's navigation names, by id: each Mate's latest. */
  readonly named?: ReadonlyArray<string>;
}) => (
  <ProjectAutomationView
    admin={ADMIN}
    look="part"
    board={{
      read: {
        state: "known",
        board: boardOf(input.tasks, NOW, "app", naming(input.tasks, input.named ?? [])),
      },
      spend: input.spend,
      gauge: input.gauge,
      onReadAgain: nothing,
      onOpen: nothing,
    }}
    onOpenMate={nothing}
    pool={pool(input.ids, input.working)}
    sources={{ rows: SOURCES, reading: false, withheld: false }}
    workingOf={(projectId) => input.working.includes(projectId)}
  />
);

const NO_AUTOMATION = (
  <ProjectAutomationView
    admin={ADMIN}
    look="part"
    onOpenMate={nothing}
    pool={[]}
    sources={{ rows: [], reading: false, withheld: false }}
    workingOf={() => false}
  />
);

const access = (rows: ReadonlyArray<readonly [string, "production" | "stage", boolean]>) => {
  const model: AccessCardModel = {
    state: "ready",
    offerDomain: false,
    rows: rows.map(([host, tier, live]) => ({
      key: `${tier}:${host}`,
      host,
      url: `https://${host}`,
      service: "app",
      port: 3000,
      tier,
      live,
    })),
  };
  return <ProjectAccessCardView model={model} onManage={nothing} />;
};

/** What each state's page holds besides its places and Mates. */
export interface PageCards {
  /** What needs the person that its page reads apart: the automation budget, spent. */
  readonly needs?: ReactNode;
  /** Its page's Changes, quiet while it is in development and has none. */
  readonly changes: (developing: boolean) => ReactNode;
  readonly automation: ReactNode;
  readonly spend: ReactNode;
  readonly access: ReactNode;
  readonly people: ReactNode;
}

const people = <ProjectAccessChips card label="People" onAdd={nothing} view={PEOPLE} />;

const changes =
  (input: Parameters<typeof projectChangeGroups>[0]) =>
  (developing: boolean): ReactNode => (
    <ProjectChangesCard
      cap={3}
      groups={projectChangeGroups(input)}
      mateOf={mateOf}
      onOpen={nothing}
      onOpenRelease={nothing}
      quiet={developing}
      read={{ state: "known" }}
      reviewsAbove
    />
  );

// S4: twelve released across three releases, six merged since, two older releases folded.
const S4_RELEASED = [
  merged("Free shipping over $50", "s4-juno", 3 * DAY),
  merged("Product reviews with photos", "s4-mira", 3 * DAY + 60),
  merged("Size guide on clothing", "s4-ines", 3 * DAY + 120),
  merged("Faster search", "s4-kip", 3 * DAY + 200),
  merged("Order confirmation email", "s4-tam", 3 * DAY + 300),
  merged("Cart remembers you", "s4-teo", 9 * DAY),
  merged("Discount codes", "s4-juno", 9 * DAY + 60),
  merged("Mobile menu", "s4-rho", 9 * DAY + 120),
  merged("Out-of-stock badge", "s4-kip", 9 * DAY + 200),
  merged("Product page, first cut", "s4-mira", 16 * DAY),
  merged("Checkout, first cut", "s4-juno", 16 * DAY + 60),
  merged("The catalogue, first cut", "s4-ines", 16 * DAY + 120),
];
const S4_READY = [
  merged("Prices per unit", "s4-kip", 40),
  merged("Search keeps its filters", "s4-tam", 95),
  merged("Saved addresses", "s4-juno", 180),
  merged("Product video", "s4-mira", 6 * 60),
  merged("Order tracking link", "s4-rho", 20 * 60),
  merged("Newsletter sign-up in the footer", "s4-kip", DAY + 60),
];

const S4_TASKS: ReadonlyArray<HqAppTask> = [
  atWork("301", "Gift wrap option at checkout", "s4-kip", 14, 1.12),
  atWork("302", "Fix the price rounding in the cart", "s4-tam", 6, 0.41),
  inReviewTask("299", "Stock count on each product", "s4-rho", 50, 40),
  inReviewTask("298", "Returns label in the order email", "s4-rho", 3 * 60, 38),
  queued("303", "Czech product names", 1, 20),
  queued("304", "“Can we hide sold-out items?” · Ida Ops", 2, 45),
  queued("305", "Bigger tap targets on mobile", 3, 80),
  queued("306", "Show delivery dates", 4, 120),
  queued("307", "Remember the last sort order", 5, 200),
  queued("308", "Export orders as CSV", 6, 260),
  ...Array.from({ length: 20 }, (_, at) =>
    ended(
      String(280 - at),
      [
        "Out-of-stock badge",
        "Faster search",
        "Discount codes",
        "Order confirmation email",
        "Prices per unit",
      ][at % 5]!,
      ["s4-kip", "s4-tam", "s4-rho"][at % 3]!,
      60 * (at + 1),
      0.8 + (at % 4) * 0.6,
    ),
  ),
];

/** The cards of each state, by the harness project's id. */
export const PAGE_CARDS: ReadonlyMap<string, PageCards> = new Map<string, PageCards>([
  [
    "s1",
    {
      changes: changes({ open: [], merged: [], releases: [], stage: undefined, production: false }),
      automation: NO_AUTOMATION,
      spend: (
        <ProjectSpendCardView
          state={spend(
            (at) => (at === 29 ? 0.08 : 0),
            (at) => (at === 29 ? 0.31 : 0),
          )}
        />
      ),
      access: null,
      people,
    },
  ],
  [
    "s2",
    {
      changes: changes({
        open: S2_OPEN,
        merged: [],
        releases: [],
        stage: undefined,
        production: false,
      }),
      automation: automation({
        ids: ["s2-kip", "s2-tam"],
        working: ["s2-kip"],
        tasks: [
          atWork("21", "Export notes as Markdown", "s2-kip", 9, 0.62),
          queued("22", "Sort notes by last edit", 1, 30),
          queued("23", "“Can notes have a due date?” · Ida Ops", 2, 70),
          inReviewTask("19", "Export notes as Markdown", "s2-tam", 35, 12),
          ended("18", "Pin a note to the top", "s2-tam", 60, 1.3),
          ended("17", "Search inside notes", "s2-kip", 4 * 60, 2.05),
          ended("16", "Fix the empty-state copy", "s2-tam", DAY, 0.22),
        ],
        named: ["21", "19"],
        gauge: { words: "$12.40 of $60 · October", share: 0.21 },
        spend: "$12.40 of $60 this month",
      }),
      spend: (
        <ProjectSpendCardView
          state={spend(
            (at) => (at > 22 ? 0.12 : 0),
            (at) => (at > 22 ? 0.9 + (at % 3) * 0.4 : 0),
          )}
        />
      ),
      access: null,
      people,
    },
  ],
  [
    "s3",
    {
      changes: changes({
        open: S3_OPEN,
        merged: [
          merged("Gift message on orders", "s3-bo", 50),
          merged("Prices per 100 g", "s3-ada", 4 * 60),
          merged("Newsletter sign-up", "s3-bo", 5 * DAY),
          merged("Tea origins on each page", "s3-ada", 5 * DAY + 90),
          merged("The shop, first cut", "s3-bo", 12 * DAY),
        ],
        releases: [
          { tag: "v0.4.1", taggedAt: ago(4 * DAY), live: true },
          { tag: "v0.4.0", taggedAt: ago(11 * DAY), live: false },
        ],
        stage: undefined,
        production: true,
      }),
      automation: NO_AUTOMATION,
      spend: (
        <ProjectSpendCardView
          state={spend(
            (at) => 0.42 + (at % 4) * 0.03,
            (at) => 0.6 + ((at * 7) % 5) * 0.3,
          )}
        />
      ),
      access: access([
        ["copperleaf.example", "production", true],
        ["app-copperleaf-stage.prg1.zerops.app", "stage", true],
      ]),
      people,
    },
  ],
  [
    "s4",
    {
      changes: changes({
        open: S4_OPEN,
        merged: [...S4_READY, ...S4_RELEASED],
        releases: [
          { tag: "v2.4.0", taggedAt: ago(2 * DAY), live: true },
          { tag: "v2.3.0", taggedAt: ago(8 * DAY), live: false },
          { tag: "v2.2.0", taggedAt: ago(15 * DAY), live: false },
          { tag: "v2.1.0", taggedAt: ago(22 * DAY), live: false },
          { tag: "v2.0.0", taggedAt: ago(29 * DAY), live: false },
        ],
        stage: undefined,
        production: true,
      }),
      automation: automation({
        ids: ["s4-kip", "s4-tam", "s4-rho"],
        working: ["s4-kip", "s4-tam"],
        tasks: S4_TASKS,
        named: ["301", "302", "299"],
        gauge: { words: "$186.20 of $400 · October", share: 0.47 },
        spend: "$186.20 of $400 this month",
      }),
      spend: (
        <ProjectSpendCardView
          state={spend(
            (at) => 2.1 + (at % 5) * 0.2,
            (at) => ([5, 6, 12, 13, 19, 20, 26, 27].includes(at) ? 1.4 : 5.5 + ((at * 11) % 7)),
          )}
        />
      ),
      access: access([
        ["shop.harbor.example", "production", true],
        ["api.harbor.example", "production", true],
        ["app-harbor-stage.prg1.zerops.app", "stage", true],
        ["app-harbor-checkout.prg1.zerops.app", "stage", true],
      ]),
      people,
    },
  ],
  [
    "s5",
    {
      changes: changes({
        open: S5_OPEN,
        merged: [
          merged("Post scheduling", "s5-nell", 3 * 60),
          merged("Author pages", "s5-esme", 3 * DAY),
        ],
        releases: [
          { tag: "v1.2.9", taggedAt: ago(2 * DAY), live: true },
          { tag: "v1.2.8", taggedAt: ago(9 * DAY), live: false },
        ],
        stage: undefined,
        production: true,
      }),
      automation: automation({
        ids: ["s5-kip", "s5-tam"],
        working: [],
        tasks: [
          queued("51", "Dark mode for the reader", 1, 3 * 60),
          queued("52", "RSS feed per author", 2, 5 * 60),
          queued("53", "Fix the broken share link", 3, 7 * 60),
          queued("54", "Word count on drafts", 4, 9 * 60),
          ended("49", "Image captions", "s5-kip", 10 * 60, 9.4),
          ended("48", "Faster post list", "s5-tam", 14 * 60, 12.1),
        ],
        gauge: { words: "$47.00 of $47 · October", share: 1 },
        spend: "$47.00 of $47 this month · spent",
      }),
      needs: (
        <BudgetNeedView gauge={{ words: "$47.00 of $47 · October", share: 1 }} onRaise={nothing} />
      ),
      spend: (
        <ProjectSpendCardView
          state={spend(
            (at) => 0.7 + (at % 3) * 0.05,
            (at) => (at > 20 ? 3 + (at % 4) : 0.4),
          )}
        />
      ),
      access: access([
        ["quillpost.example", "production", true],
        ["app-quill-stage.prg1.zerops.app", "stage", false],
      ]),
      people,
    },
  ],
]);

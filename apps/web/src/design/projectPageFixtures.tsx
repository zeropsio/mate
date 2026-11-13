/**
 * A project's own page for the overview harness (`?page=`): what its places, changes and side
 * column read beyond the overview's group — its environments, what its release brought, its
 * changes, repositories, automation, people and spend — as `ProjectPageBody` draws them once every
 * read is in. Acme Store runs a production and three stages with two automated Mates; Tea Shop runs
 * a stage and a production; any other project has nothing released yet. Fixtures only: nothing
 * here ships.
 */
import { HqEnvironmentId, ProjectId } from "@t3tools/contracts";
import type {
  CanonicalEnvironmentRow as EnvironmentRow,
  EnvironmentSlotRow,
  FlowPullRequest,
  FlowReleaseRow,
  GroupFlow,
} from "@t3tools/client-runtime/zerops";
import { releaseNotCreatedWords } from "@t3tools/client-runtime/zerops/flow";
import type { HqAppTask } from "@t3tools/shared/hqIntake";
import { MATE_SHAPE_OF_TINT, type MateTintId } from "@t3tools/shared/brand";
import type { ReactNode } from "react";

import {
  ProjectAutomationRowView,
  ProjectAutomationView,
  type AutomationControls,
  type PoolMate,
} from "~/components/zerops/projectAutomation/ProjectAutomation";
import type { SourceRow } from "~/components/zerops/projectAutomation/projectAutomation.logic";
import { boardOf } from "~/components/zerops/projectAutomation/taskBoard.logic";
import type { AccessTableView } from "~/components/zerops/projects/accessTable.logic";
import { ProjectAccessChips } from "~/components/zerops/projects/ProjectAccessChips";
import { ProjectHistoryView } from "~/components/zerops/projects/ProjectHistory";
import { historyReleases } from "~/components/zerops/projects/projectHistory.logic";
import {
  broughtBy,
  cardChanges,
  cardReady,
  mateChangesForReview,
  placeLines,
  type CardStage,
} from "~/components/zerops/projects/projectCard.logic";
import { ProjectPeopleRowView } from "~/components/zerops/projects/ProjectPeople";
import { MERGING_STATES, MergingBody, MergingRow } from "./projectMergingFixtures";
import { Button } from "~/components/ui/button";
import { MateFace } from "~/components/zerops/primitives";
import { ProjectSpendRowView } from "~/components/zerops/projects/ProjectSpend";
import type { ProjectPerson } from "~/components/zerops/projects/projectPeople.logic";
import { joinSpend } from "~/components/zerops/projects/projectSpend.logic";
import type { ReleaseOffer } from "~/components/zerops/ZeropsReleaseVerb";
import {
  ProjectPageBody,
  type ProjectPageFacts,
} from "~/components/zerops/project/ProjectPageBody";
import { CHANGES_HELD, lineCopies } from "~/components/zerops/project/projectPage.logic";
import {
  lineChangeKey,
  nextReleaseView,
  ProjectLine,
  projectLine,
} from "~/components/zerops/system";
import { SetupRow } from "~/components/zerops/project/SetupCard";
import type {
  CardWait,
  ProjectPageSlot,
  ProjectsFlowGroup,
} from "~/components/zerops/projects/ZeropsProjectsFlow";
import { RepoRowsView } from "~/components/zerops/github/GithubRepoRows";
import type { RepoListEntry } from "@t3tools/shared/hqChanges";
import type { AccountScope } from "@t3tools/client-runtime/zerops/data";
import { InventoryContext, type Inventory } from "~/zerops/inventoryContext";
import { ZeropsDataContext, type ZeropsDataContextValue } from "~/zerops/zeropsDataContext";

const NOW = Date.now();
const PAGE_PARAMS = new URLSearchParams(location.search);
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

/** The crowded line's Mates (`?page=line-crowd`): twelve, their tints repeating. */
export const CROWD_MATES: ReadonlyArray<{
  readonly id: string;
  readonly name: string;
  readonly tint: MateTintId;
}> = [
  { id: "wren-x", name: "Wren", tint: "amber" },
  { id: "odo-x", name: "Odo", tint: "slate" },
  { id: "raya-x", name: "Raya", tint: "olive" },
  { id: "tess-x", name: "Tess", tint: "rose" },
  { id: "vale-x", name: "Vale", tint: "sky" },
  { id: "juno-x", name: "Juno", tint: "violet" },
  { id: "fen-x", name: "Fen", tint: "coral" },
  { id: "ines-x", name: "Ines", tint: "sand" },
  { id: "mira-x", name: "Mira", tint: "olive" },
  { id: "kai-x", name: "Kai", tint: "sky" },
  { id: "pia-x", name: "Pia", tint: "rose" },
  { id: "toby-x", name: "Toby", tint: "amber" },
];

const CROWD_TOPICS = [
  "Search",
  "Checkout",
  "The wishlist",
  "A gift card",
  "Each tea card",
  "Delivery",
  "A review",
  "Stock",
  "A subscription",
  "An account",
  "Every price",
  "Each image",
];
const CROWD_WORK = [
  "loads faster on a slow connection",
  "remembers the last choice",
  "reads well on a phone",
  "says why it failed",
  "keeps its place on reload",
];

/** The crowded line's sixty changes, by number: #1–#34 merged, #35–#60 open. */
export const crowdTitle = (number: number) =>
  `${CROWD_TOPICS[number % CROWD_TOPICS.length] ?? ""} ${CROWD_WORK[number % CROWD_WORK.length] ?? ""}`;

/** Every Mate a page's History names, as the harness's cards draw them. */
const MATES: Readonly<Record<string, { readonly name: string; readonly tint: MateTintId }>> = {
  ...Object.fromEntries(CROWD_MATES.map((mate) => [mate.id, mate])),
  "raya-t": { name: "Raya", tint: "olive" },
  "wren-t": { name: "Wren", tint: "amber" },
  odo: { name: "Odo", tint: "slate" },
  tess: { name: "Tess", tint: "rose" },
  "juno-s": { name: "Juno", tint: "sky" },
  "toby-s": { name: "Toby", tint: "amber" },
  "ines-s": { name: "Ines", tint: "olive" },
  "odo-s": { name: "Odo", tint: "slate" },
  "tess-s": { name: "Tess", tint: "rose" },
  "juno-n": { name: "Juno", tint: "sky" },
  "wren-f": { name: "Wren", tint: "amber" },
  "odo-f": { name: "Odo", tint: "slate" },
  "ines-p": { name: "Ines", tint: "olive" },
  "wren-b": { name: "Wren", tint: "amber" },
  "fen-b": { name: "Fen", tint: "coral" },
  "kara-l": { name: "Kara", tint: "coral" },
  "milo-k": { name: "Milo", tint: "violet" },
  "kai-k": { name: "Kai", tint: "sky" },
  "nell-k": { name: "Nell", tint: "coral" },
  "juno-k": { name: "Juno", tint: "sky" },
  "ravi-k": { name: "Ravi", tint: "olive" },
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
): Pick<
  FlowReleaseRow,
  "tag" | "taggedAt" | "verdict" | "rollbackOf" | "standing" | "history" | "rollBack"
> {
  return {
    tag,
    taggedAt: ago(minutes),
    verdict: "approved",
    standing: undefined,
    rollBack: false,
    ...over,
  };
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
const TEA_INPUT = {
  releases: [
    shipped("v0.1.3", 6 * DAY, { standing: "live", by: "dana" }),
    shipped("v0.1.2", 6.5 * DAY),
    shipped("v0.1.1", 7 * DAY),
    shipped("v0.1.0", 8 * DAY),
  ],
  merged: [
    landed(17, "Centre the shop so a cropped demo frame shows it all", "raya-t", 6 * DAY + 15),
    landed(16, "Hide sold out switch remembered across visits", "wren-t", 6 * DAY + 18),
    landed(13, "Price per 100 g leads on tea cards", "wren-t", 6 * DAY + 40),
    landed(11, "Add a Surprise me chip to the tea sommelier", "tess", 6 * DAY + 90),
    landed(10, "Back to top link in the footer, reading “↑ Top”", "wren-t", 6.6 * DAY),
    landed(7, "Teas in PostgreSQL, a Valkey cache and a tea-house redesign", "raya-t", 6.8 * DAY),
    landed(5, "In stock and Sold out labels with a Hide sold out switch", "wren-t", 7.2 * DAY),
    landed(6, "Footer with opening hours and contact email", "tess", 7.4 * DAY),
    landed(4, "Let the tea sommelier answer tea questions from the web", "raya-t", 8.2 * DAY),
  ],
};
const TEA_HISTORY = recordedHistory(
  TEA_INPUT,
  [[17, 16, 13, 11], [10, 7], [5, 6], [4]],
  [0, 1, 0, 0],
);

/**
 * Juno Notes, not live yet: five changes on `main` and the project's setup files, nothing
 * released.
 */
const JUNO_INPUT = {
  releases: [],
  merged: [
    ...[
      landed(9, "Notes sorted by tag, newest first inside each tag", "juno-n", 25 * DAY),
      landed(8, "Markdown preview beside the editor, scrolling with it", "juno-n", 25 * DAY + 30),
      landed(7, "Pin a note to the top of its tag", "juno-n", 25 * DAY + 90),
      landed(6, "Search across titles and bodies as you type", "juno-n", 25 * DAY + 200),
      landed(5, "A notes list, an editor and tags to file notes under", "juno-n", 26 * DAY),
    ].map((change) => ({ ...change, pullRequest: undefined })),
    {
      ...landed(2, "Mate: the project's import files", "juno-n", 12 * DAY),
      repository: "group",
      kind: "recipe" as const,
      pullRequest: undefined,
    },
  ],
};

/** Acme Store: seven releases, the newest five shown, one rolled back from. */
const ACME_INPUT = {
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
    landed(12, "Fix the VAT rate table for Ireland", "toby-s", 21 * 60),
    landed(11, "Fix the sold-out badge on mobile", "odo-s", 8.5 * 24 * 60),
    landed(10, "Gift cards at checkout", "toby-s", 30 * 60),
    landed(9, "Czech names for every product", "ines-s", 4 * 24 * 60),
  ],
};
const ACME_HISTORY = recordedHistory(
  ACME_INPUT,
  [[], [14], [12, 10], [], [9], [], [11]],
  [0, 0, 0, 1, 0, 0, 0],
);

/** A change on `main`, by the commit it landed as: what a stage's deploys name it by. */
const onMain = (number: number, title: string, mateProjectId: string, minutes: number) => ({
  ...landed(number, title, mateProjectId, minutes),
  mergeCommitSha: sha(`c${String(number)}`),
});

const lineRepo = (
  name: string,
  github: string,
  mirror: { readonly syncedAt: string | null; readonly divergedSince: string | null },
) => ({
  name,
  mainHead: null,
  updatedAt: ago(4),
  mirror,
  remote: {
    url: `https://github.com/${github}.git`,
    repositoryId: "1",
    keptAt: ago(60 * DAY),
    keptBy: "Nova Dev",
    expiresAt: null,
    invalidSince: null,
    via: "token" as const,
    githubAppId: null,
  },
});
const IN_SYNC = { syncedAt: ago(20 * 60), divergedSince: null };

/** What a line state's page reads beyond its flow (`?page=line-…`). */
interface LineInput {
  readonly merged: ReadonlyArray<FlowPullRequest>;
  readonly releases: ReadonlyArray<ReturnType<typeof shipped>>;
  /** What the stage `main` feeds runs and is taking. */
  readonly stage?: CardStage;
  readonly repos: ReadonlyArray<RepoListEntry>;
  /** Why its last release did not go live, as production's page says it. */
  readonly cause?: string;
}

/** A code repository HQ keeps, with nothing of it on GitHub. */
const codeRepo = (name: string, over: Partial<RepoListEntry> = {}): RepoListEntry => ({
  name,
  mainHead: null,
  updatedAt: ago(25 * DAY),
  remote: null,
  ...over,
});

/** The Code card as the owner met it: two rows not on GitHub, one with a menu and one without. */
const CODE_ROWS: ReadonlyArray<RepoListEntry> = [
  codeRepo("api"),
  codeRepo("site", { canDelete: { allow: true } }),
  lineRepo("post", "acme/kite-post", IN_SYNC),
];

/** Every state a Code row reaches (`&code=states`); `mail` is being connected (`CODE_PRESS`). */
const CODE_STATES: ReadonlyArray<RepoListEntry> = [
  codeRepo("api"),
  lineRepo("post", "acme/kite-post", IN_SYNC),
  lineRepo("docs", "acme/kite-post-docs", { syncedAt: null, divergedSince: null }),
  lineRepo("web", "acme/kite-post-web", { syncedAt: ago(3 * DAY), divergedSince: ago(2 * DAY) }),
  {
    ...lineRepo("jobs", "acme/kite-post-jobs", IN_SYNC),
    remote: {
      ...lineRepo("jobs", "acme/kite-post-jobs", IN_SYNC).remote,
      invalidSince: ago(4 * DAY),
    },
  },
  codeRepo("mail"),
];
const CODE_PRESS = (repo: string) => (repo === "mail" ? ("connecting" as const) : null);

const HEAD = sha("head");
const stageRuns = (runs: string, deploying: ReadonlyArray<string> = []): CardStage => ({
  runs: [runs],
  deploying,
  mainHeads: new Map([["appdev", HEAD]]),
});

/**
 * The line's states: calm with a stage; stuck on a release that did not go live; ten times the
 * activity; three Mates and a release waiting; sixty changes from twelve Mates; not live yet; live
 * without a stage.
 */
const LINE_INPUTS: Readonly<Record<string, LineInput>> = {
  "line-calm": {
    releases: [
      shipped("v0.1.5", 2 * DAY, { standing: "live", by: "dana" }),
      shipped("v0.1.4", 9 * DAY),
    ],
    merged: [
      onMain(8, "First administrator from a setting in the vault", "milo-c", 20 * 60),
      onMain(7, "Run the landing site beside the studio", "milo-c", 2 * DAY + 40),
      onMain(6, "Files per account for hosted projects", "kai-c", 9 * DAY + 30),
      onMain(5, "The hosted server takes its own address", "milo-c", 9 * DAY + 90),
    ],
    stage: stageRuns(HEAD),
    repos: [lineRepo("studio", "acme/studio", IN_SYNC)],
  },
  "line-stuck": {
    releases: [
      shipped("v0.1.5", 8, { verdict: "refused" }),
      shipped("v0.1.4", 16, { verdict: "refused" }),
      shipped("v0.1.3", 8 * DAY, { standing: "live", by: "dana" }),
      shipped("v0.1.2", 9 * DAY),
    ],
    merged: [
      onMain(31, "Steer the bot while it answers", "pia-r", 40),
      onMain(29, "Connect notes and boards in one step", "pia-r", 4 * DAY),
      onMain(27, "A hidden browser for web work", "pia-r", 7 * DAY),
      onMain(24, "Everyone gets the bot, which guides their sign-in", "pia-r", 8 * DAY + 60),
    ],
    repos: [lineRepo("bot", "acme/relay-bot", IN_SYNC)],
    cause: releaseNotCreatedWords({ tag: "v0.1.5", missing: ["db"] }),
  },
  "line-busy": {
    releases: [
      shipped("v2.4.0", 3 * DAY, { standing: "live", by: "dana" }),
      shipped("v2.3.1", 9 * DAY),
    ],
    merged: [
      onMain(49, "Tea of the day on the home page", "raya-b", 6),
      onMain(48, "Faster tea search", "wren-b", 70),
      onMain(47, "Wishlist on tea cards", "wren-b", 2 * 60),
      onMain(46, "Brewing time on every tea", "odo-b", 3 * 60),
      onMain(45, "Loose leaf and bags as one product", "raya-b", 5 * 60),
      onMain(44, "Free delivery over a basket's worth", "raya-b", 7 * 60),
      onMain(43, "Sold-out teas say when they return", "tess-b", 9 * 60),
      onMain(42, "Origin on each tea card", "vale-b", 12 * 60),
      onMain(41, "A gift note at checkout", "juno-b", 20 * 60),
      onMain(40, "Tasting notes in the tea's own words", "vale-b", 26 * 60),
      onMain(39, "Caffeine marked on every tea", "odo-b", 30 * 60),
      onMain(38, "Samples of three teas in one order", "vale-b", 40 * 60),
      onMain(37, "Reorder the last basket in one press", "tess-b", 2 * DAY),
      onMain(33, "Price per 100 g leads on tea cards", "wren-b", 3 * DAY + 60),
      onMain(31, "Sold-out labels on tea cards", "wren-b", 4 * DAY),
    ],
    stage: stageRuns(sha("c48"), [HEAD]),
    // One copy on GitHub, behind and pushing; the other repository is kept in Mate alone.
    repos: [
      lineRepo("shop", "acme/tea-house", { syncedAt: null, divergedSince: null }),
      { name: "api", mainHead: null, updatedAt: ago(4), remote: null },
    ],
  },
  // Three Mates, a release waiting: four merged since the live release, one on its way to the stage.
  "line-three": {
    releases: [
      shipped("v0.4.2", 3 * DAY, { standing: "live", by: "dana" }),
      shipped("v0.4.1", 10 * DAY),
    ],
    merged: [
      onMain(10, "Undo send for ten seconds", "nell-k", 25),
      onMain(9, "Attachments open beside the letter", "milo-k", 5 * 60),
      onMain(8, "A quieter inbox on weekends", "kai-k", 22 * 60),
      onMain(7, "Drafts kept across devices", "milo-k", 2 * DAY),
    ],
    stage: stageRuns(sha("c9"), [HEAD]),
    repos: [lineRepo("mail", "acme/kite-mail", IN_SYNC)],
  },
  // Sixty changes from twelve Mates: thirty-four merged since the live release, two on their way
  // to the stage. The page holds the newest forty, open first.
  "line-crowd": {
    releases: [
      shipped("v3.1.0", 4 * DAY, { standing: "live", by: "dana" }),
      shipped("v3.0.2", 11 * DAY),
    ],
    merged: Array.from({ length: 34 }, (_, at) => {
      const number = 34 - at;
      return onMain(
        number,
        crowdTitle(number),
        CROWD_MATES[number % CROWD_MATES.length]?.id ?? "",
        (35 - number) * 50,
      );
    }),
    stage: stageRuns(sha("c32"), [HEAD]),
    repos: [lineRepo("shop", "acme/tea-house", IN_SYNC)],
  },
  // One change merged and waiting, the rest live: what the page says once, and where.
  "line-once": {
    releases: [
      shipped("v0.1.7", 3 * DAY, { standing: "live", by: "dana" }),
      shipped("v0.1.6", 5 * DAY),
    ],
    merged: [
      onMain(44, "Kites sorted by wind, lightest first", "juno-k", 50),
      onMain(
        41,
        "A hidden browser for web work, the desktop's browser for sign-ins",
        "juno-k",
        3 * DAY + 30,
      ),
      onMain(40, "Postcards keep their stamp when they are forwarded", "ravi-k", 5 * DAY + 20),
      {
        ...landed(2, "Add a mail queue to the setup", "juno-k", 6 * DAY),
        repository: "group",
        kind: "recipe" as const,
        pullRequest: undefined,
      },
    ],
    stage: stageRuns(HEAD),
    repos: [lineRepo("post", "acme/kite-post", IN_SYNC)],
  },
  // Changes all along the line, and a Code card whose rows are in different states: one not on
  // GitHub that nobody may delete (no menu), one that may be (a menu), one in sync.
  "once-full": {
    releases: [
      shipped("v0.1.7", 3 * DAY, { standing: "live", by: "dana" }),
      shipped("v0.1.6", 5 * DAY),
    ],
    merged: [
      onMain(50, "Kites sorted by wind, lightest first", "juno-o", 50),
      onMain(49, "Postcards keep their stamp when they are forwarded", "wren-o", 5 * 60),
      onMain(47, "A hidden browser for web work", "juno-o", 3 * DAY + 30),
      onMain(46, "Sign in with a postcode", "raya-o", 5 * DAY + 20),
    ],
    stage: stageRuns(sha("c49"), [HEAD]),
    repos: PAGE_PARAMS.get("code") === "states" ? CODE_STATES : CODE_ROWS,
  },
  "once-bare": {
    releases: [shipped("v0.0.3", 9 * DAY, { standing: "live", by: "dana" })],
    merged: [onMain(3, "A kite you fold from one sheet", "ines-o", 9 * DAY + 60)],
    repos: [codeRepo("kites")],
  },
  "line-notlive": {
    releases: [],
    merged: [onMain(4, "A lab to try a swarm of agents in", "kara-l", 3 * DAY)],
    repos: [lineRepo("lab", "acme/swarm-lab", IN_SYNC)],
  },
  ...Object.fromEntries(
    ["outside-before", "outside-set"].map((id) => [
      id,
      {
        releases: [],
        merged: [
          onMain(11, "Totals by tea, not by order", "wren-f", 50),
          onMain(9, "Refunds as their own rows", "odo-f", 26 * 60),
          onMain(8, "A ledger of every sale, newest first", "wren-f", 3 * DAY),
        ],
        repos: [lineRepo("ledger", "acme/tea-ledger", IN_SYNC)],
      },
    ]),
  ),
  "outside-bare": {
    releases: [],
    merged: [
      onMain(6, "Proofs open beside the page they mark", "ines-p", 4 * 60),
      onMain(4, "A press run's pages in print order", "ines-p", 2 * DAY),
    ],
    stage: stageRuns(HEAD),
    repos: [codeRepo("press")],
  },
  "line-nostage": {
    releases: [
      shipped("v1.2.0", 4 * DAY, { standing: "live", by: "dana" }),
      shipped("v1.1.0", 12 * DAY),
    ],
    merged: [
      onMain(18, "Notes by the place they were taken", "ines-f", 3 * 60),
      onMain(17, "A photo on every note", "toby-f", 26 * 60),
      onMain(15, "Search across every notebook", "ines-f", 4 * DAY + 60),
    ],
    repos: [lineRepo("notes", "acme/field-notes", IN_SYNC)],
  },
};

/** A Mate's face, as the harness's cards draw it. */
function mateFace(projectId: string): ReactNode {
  const mate = MATES[projectId];
  return mate === undefined ? undefined : <MateFace size={20} state="idle" tint={mate.tint} />;
}

/** Who released the harness's releases. */
const PEOPLE_NAMES: Readonly<Record<string, string>> = { dana: "Dana" };

/** A project page's History, drawn from its fixtures. */
function PageHistory({ groupId }: { readonly groupId: string }) {
  return (
    <ProjectHistoryView
      face={mateFace}
      mateName={(projectId) => MATES[projectId]?.name}
      onOpen={nothing}
      personName={(userId) => PEOPLE_NAMES[userId]}
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
  onReadAgain: nothing,
  onOpenSettings: nothing,
};
const SOURCES: ReadonlyArray<SourceRow> = [
  {
    key: "github",
    kind: "github",
    title: "GitHub issues labelled",
    label: "mate",
    detail: "acme/store",
    meta: null,
  },
  {
    key: "slack",
    kind: "slack",
    title: "#store-asks",
    detail: "Slack",
    meta: null,
    disconnected: false,
  },
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
  link: "https://mate.zerops.io/odo-s/conversation-42",
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
      via: "token" as const,
      githubAppId: null,
    },
  },
];

/** A project's code kept in Mate alone: on no GitHub. */
const KEPT_REPOS = [{ name: "notes", mainHead: null, updatedAt: ago(25 * DAY), remote: null }];

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

/** Who reaches a project: four people, three of them on its production. */
const PEOPLE_VIEW = {
  kind: "table",
  editable: true,
  invite: true,
  candidates: [],
  columns: [
    { projectId: "prod", kind: "production", label: "Production", owner: null, unread: false },
    { projectId: "stage", kind: "stage", label: "Stage", owner: null, unread: false },
  ],
  rows: ["Nova Dev", "Ines Vale", "Toby Holt", "Theo Lind"].map((name, index) => ({
    key: `cu-${String(index)}`,
    name,
    cells: [
      { projectId: "prod", level: index === 3 ? "none" : "full" },
      { projectId: "stage", level: "full" },
    ],
  })),
} as unknown as AccessTableView;

/** Who reaches a bigger project: sixteen people. */
const MANY_PEOPLE_VIEW = {
  ...PEOPLE_VIEW,
  rows: [
    "Nova Dev",
    "Ines Vale",
    "Toby Holt",
    "Theo Lind",
    "Dana Moss",
    "Eli Park",
    "Mira Stone",
    "Owen Hale",
    "Lena Fox",
    "Ravi Kade",
    "Ada Lark",
    "Ben Cole",
    "Cleo Ward",
    "Finn Ray",
    "Gail Ross",
    "Hugo Bell",
  ].map((name, index) => ({ key: `cu-${String(index)}`, name, avatarUrl: null, cells: [] })),
} as unknown as AccessTableView;

/** Who reaches a project, as its access chips draw them: the harness's *Manage*. */
function PageAccess() {
  const people = ["Nova Dev", "Ines Vale", "Toby Holt", "Theo Lind"].map((name, index) => ({
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

/** The project's whole Automation section, as its row's *Manage* opens it. */
function PageAutomation({ groupId }: { readonly groupId: string }) {
  return (
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
  );
}

/** What the page reads beyond the overview's group, from fixtures, for the project it opened. */
function harnessFacts(groupId: string, flow: GroupFlow): ProjectPageFacts {
  const line = LINE_INPUTS[groupId];
  const input =
    groupId === "acme-store"
      ? ACME_INPUT
      : groupId === "tea"
        ? TEA_INPUT
        : groupId === "juno-notes"
          ? JUNO_INPUT
          : line;
  const released = groupId === "acme-store" || groupId === "tea";
  const production = "stop" in flow.production ? flow.production.stop : undefined;
  const environments = [
    ...(production === undefined
      ? []
      : [
          environment(
            production.projectId,
            "production",
            "production",
            production.version?.label ?? "",
          ),
        ]),
    ...flow.stages.map((stage) =>
      environment(stage.projectId, stage.name, "stage", stage.version?.label ?? ""),
    ),
  ];
  const slots: ReadonlyArray<EnvironmentSlotRow> = [
    production === undefined
      ? {
          kind: "slot",
          tier: "production",
          name: "Production",
          line: "Not added",
          // A production deployed outside Mate is never offered a second one here.
          add: flow.production.kind !== "outside",
        }
      : { kind: "environment", tier: "production", id: production.projectId, note: undefined },
    ...(flow.stages.length === 0
      ? [{ kind: "slot", tier: "stage", name: "Stage", line: "Not added", add: true } as const]
      : flow.stages.map(
          (stage) =>
            ({ kind: "environment", tier: "stage", id: stage.projectId, note: undefined }) as const,
        )),
  ];
  return {
    brought: input === undefined ? [] : broughtBy(input.merged, input.releases),
    changes: cardChanges({
      open: flow.pullRequests.map((change) => change.pull),
      merged: input?.merged ?? [],
      releases: input?.releases ?? [],
      stage: line?.stage,
      production: production !== undefined,
      productionOutside: flow.production.kind === "outside",
      limit: CHANGES_HELD,
    }),
    // `?reading`: its changes are not read yet; the line holds their room.
    changesUnknown: PAGE_PARAMS.has("reading") ? "Reading its changes…" : undefined,
    repos: line?.repos ?? (released ? REPOS : []),
    copies: lineCopies(line?.repos, { orgName: "Acme", now: NOW }),
    releaseCause: line?.cause,
    environments,
    slots,
    release:
      flow.production.kind === "releasing"
        ? { ...RELEASE_WAITING, releasing: true, tag: flow.production.tag }
        : flow.production.kind === "ready-to-release" || flow.production.kind === "deploy-failed"
          ? RELEASE_WAITING
          : RELEASE_NONE,
    onAdd: nothing,
    onFinish: nothing,
    finishing: false,
    repo: released ? "appdev" : undefined,
    // `?undeclared`: HQ has not told which environments exist; the places are the group's lines.
    declared: !PAGE_PARAMS.has("undeclared"),
    fixOf: () =>
      flow.mates[0] === undefined ? undefined : { name: flow.mates[0].name, onAsk: nothing },
    outside: OUTSIDE,
  };
}

/**
 * Saying production is deployed outside Mate, as pressed: an Owner or Admin with nothing asked
 * yet; `?outside=reader` anyone else; `saving` and `removing` while HQ is asked; `refused` HQ's
 * words; `older` an HQ from before it.
 */
const OUTSIDE: NonNullable<ProjectPageFacts["outside"]> = (() => {
  const state = PAGE_PARAMS.get("outside");
  return {
    older: state === "older",
    editable: state !== "reader",
    press:
      state === "saving" || state === "removing"
        ? { kind: "saving", lifting: state === "removing" }
        : state === "refused"
          ? { kind: "refused", words: "Owners and Admins change this." }
          : { kind: "idle" },
    save: nothing,
    reset: nothing,
  };
})();

/**
 * What waits on the person in a harness project: Juno's question on Acme Store, then each Mate's
 * changes to review, as `projectWaits` lists them from the menu's list.
 */
function harnessWaits<T>(entry: ProjectsFlowGroup<T>): ReadonlyArray<CardWait> {
  const face = (tint: MateTintId) => <MateFace size={20} state="needs" tint={tint} />;
  const waiting = (projectId: string, name: string, tint: MateTintId) => ({
    projectId,
    name,
    tint,
    shape: MATE_SHAPE_OF_TINT[tint],
    face: "needs" as const,
  });
  const asks: ReadonlyArray<CardWait> =
    entry.group.groupId === "acme-store"
      ? [
          {
            wait: {
              kind: "ask",
              key: "ask:juno-s",
              ask: "question",
              mate: {
                ...waiting("juno-s", "Juno", "sky"),
                kind: "question",
                text: "Should checkout keep the guest option?",
              },
            },
            face: face("sky"),
            onVerb: nothing,
          },
        ]
      : // The Mates states (`?page=mates-…`): the viewer's Mate that asks stands here, so its
        // card below is quiet, as on a real page.
        entry.group.groupId.startsWith("mates-")
        ? entry.flow.mates
            .filter((mate) => mate.waiting)
            .map((mate) => ({
              wait: {
                kind: "ask" as const,
                key: `ask:${mate.projectId}`,
                ask: "question" as const,
                mate: {
                  ...waiting(mate.projectId, mate.name, "olive"),
                  kind: "question" as const,
                  text: "Should a gift box cost the same in every size, or go by its weight?",
                },
              },
              face: face("olive"),
              onVerb: nothing,
            }))
        : [];
  // There a change in review is a colleague's Mate's: its own card carries its Review.
  const reviewers = entry.group.groupId.startsWith("mates-") ? [] : entry.flow.mates;
  const reviews = reviewers.flatMap((mate): ReadonlyArray<CardWait> => {
    const count = mateChangesForReview(entry.flow, mate.projectId).length;
    const tint = MATES[mate.projectId]?.tint ?? "slate";
    return count === 0
      ? []
      : [
          {
            wait: {
              kind: "review",
              key: `review:${mate.projectId}`,
              mate: {
                ...waiting(mate.projectId, mate.name, tint),
                kind: "change",
                changes: count,
              },
              change: undefined,
            },
            face: face(tint),
            onVerb: nothing,
          },
        ];
  });
  return [...asks, ...reviews];
}

/**
 * The page's release door as the projects page draws it: offered only while production has a
 * candidate to release — none while a release is on its way.
 */
function harnessReleaseVerb<T>(entry: ProjectsFlowGroup<T>): ReactNode {
  const { production } = entry.flow;
  const candidate =
    production.kind === "ready-to-release" || production.kind === "deploy-failed"
      ? production.candidate
      : undefined;
  return candidate === undefined ? null : <Button size="sm">Review release</Button>;
}

/**
 * The picture as a Mate's Code page holds it (`?page=line-mine`): at a panel's width, compact, with
 * that Mate's changes as beads and everybody else's as a count.
 */
export function HarnessLineMine<T>({
  entry,
  mine,
  tintOf,
}: {
  readonly entry: ProjectsFlowGroup<T>;
  readonly mine: string;
  readonly tintOf: (mateProjectId: string) => MateTintId | undefined;
}) {
  const groupId = entry.group.groupId;
  const facts = harnessFacts(groupId, entry.flow);
  const ready = cardReady(entry.flow);
  return (
    <div className="grid gap-3 p-6" style={{ width: 540 }}>
      <ProjectLine
        onOpenChange={nothing}
        surface="panel"
        view={projectLine({
          flow: entry.flow,
          places: placeLines({ flow: entry.flow, nowMs: NOW }),
          tintOf,
          changes: facts.changes,
          changesKnown: true,
          waiting: new Set(
            mateChangesForReview(entry.flow, mine).map((pull) => lineChangeKey(pull)),
          ),
          work: [
            {
              key: "tree",
              mateProjectId: mine,
              title: "Wishlist on tea cards",
              words: "Not a change yet",
            },
          ],
          release: {
            view: nextReleaseView({ release: facts.release, ready }),
            ready,
          },
          mine,
        })}
      />
    </div>
  );
}

/** The harness's project page body, as the page draws it from the flow's group and slots. */
export function harnessProjectPage(
  groupId: string,
  onAddMate: () => void,
): ProjectPageSlot["render"] {
  const running = groupId === "acme-store" || groupId === "tea";
  const repos =
    LINE_INPUTS[groupId]?.repos ??
    (running ? REPOS : groupId === "juno-notes" ? KEPT_REPOS : undefined);
  return ({ entry, props, addMateWhy }) => (
    <Standins>
      <ProjectPageBody
        addMateWhy={addMateWhy}
        // `?held`: the project's reads have not answered; the line keeps its shape.
        entry={PAGE_PARAMS.has("held") ? { ...entry, awaiting: true } : entry}
        facts={harnessFacts(groupId, entry.flow)}
        onAddMate={onAddMate}
        // Its History, drawn from the fixtures' releases, and what waits on the person.
        props={{
          ...props,
          renderHistory: () => <PageHistory groupId={groupId} />,
          cardWaits: harnessWaits,
          renderReleaseVerb: harnessReleaseVerb,
        }}
        setup={{
          rows: (open) => (
            <>
              {repos !== undefined ? (
                <SetupRow label="Code" rows>
                  <RepoRowsView
                    actions={
                      groupId.startsWith("once-")
                        ? { deleteRepository: () => Promise.resolve() }
                        : {}
                    }
                    admin
                    apps={null}
                    authority={null}
                    dependencies={[]}
                    now={NOW}
                    onConnect={nothing}
                    onSetUpGithub={nothing}
                    orgId="org-acme"
                    orgName="Acme"
                    project={groupId}
                    pressOf={CODE_PRESS}
                    projectName={groupId}
                    repos={repos}
                  />
                </SetupRow>
              ) : null}
              {/* Its automated Mates make Automation a section of the page: no row opens it. */}
              {groupId === "acme-store" ? null : (
                <ProjectAutomationRowView
                  face={() => null}
                  onAdd={open.automation}
                  onManage={open.automation}
                  pool={[]}
                />
              )}
              <ProjectPeopleRowView
                onManage={open.access}
                view={groupId === "juno-notes" ? MANY_PEOPLE_VIEW : PEOPLE_VIEW}
              />
              <MergingRow
                onManage={open.merging}
                state={running ? MERGING_STATES.limited : MERGING_STATES.everyone}
              />
              <ProjectSpendRowView state={running ? SPEND : SPEND_TODAY} />
            </>
          ),
          access: <PageAccess />,
          automation: <PageAutomation groupId={groupId} />,
          automationStanding: groupId === "acme-store",
          merging: (
            <MergingBody state={running ? MERGING_STATES.limited : MERGING_STATES.everyone} />
          ),
        }}
      />
    </Standins>
  );
}

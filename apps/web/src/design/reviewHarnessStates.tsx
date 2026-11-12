/**
 * The review in every state it reaches (pass 16, R1–R8), for `design-change.html`: the views
 * the app runs, with made-up reads. Fixtures only — no route imports this module.
 */
import type { RunningLine } from "@t3tools/client-runtime/zerops/activity/runningNow";
import {
  changeReadoutOfRecord,
  changeRemarks,
  parseChangeDiff,
  releaseOutcomeOf,
  releaseSteps,
  releaseVersionField,
  RELEASE_NOTHING_MERGED,
  type ChangeReadout,
  type FlowPullRequest,
  type FlowReleaseRow,
  type ReleaseFailureReads,
  type ReviewClose,
  type ReviewPress,
} from "@t3tools/client-runtime/zerops";
import { NO_ANSWER_IN_TIME } from "@t3tools/client-runtime/data";
import type { HqDeployAnswer } from "@t3tools/shared/hqDeploys";
import {
  type HqJob,
  MERGE_TOO_LARGE,
  mergeLimitWords,
  mergeTooLargeWords,
} from "@t3tools/client-runtime/zerops/hq";
import type { CrewTask } from "@t3tools/contracts";
import type {
  ChangeCommit,
  HqChange,
  HqChangeComment,
  RecordedChangeFile,
} from "@t3tools/shared/hqChanges";
import { useEffect, useState, type ReactNode } from "react";

import {
  ChangeReviewView as ProjectedChangeReviewView,
  type ChangeReviewViewProps,
} from "~/components/zerops/review/ZeropsChangeReview";
import { Button } from "~/components/ui/button";
import { CrewTaskReviewView } from "~/components/zerops/review/ZeropsCrewTaskReview";
import {
  ReleaseReadingView,
  ReleaseReviewView,
  RollbackReviewView,
  type RollbackList,
} from "~/components/zerops/review/ZeropsReleaseReview";
import type { ReleaseProgress } from "~/components/zerops/review/releaseSheet.logic";
import { useReleaseSteps, ZeropsReleaseSteps } from "~/components/zerops/review/ZeropsReleaseSteps";
import { ZeropsReviewDialog } from "~/components/zerops/review/ZeropsReviewDialog";
import { ZeropsHostedFrame } from "~/components/zerops/landing/ZeropsHostedFrame";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "~/components/WorkspaceBreadcrumb";
import type { ChangeDiscussion } from "~/zerops/useChangeDiscussion";
import { useReleasePlanWait } from "~/zerops/useReleaseServicePlan";
import type { ZeropsChangeOffers } from "~/zerops/useChangeOffers";
import type { ReadoutPart } from "~/zerops/useZeropsChangeDetail";
import type { ReviewDiffState } from "~/components/zerops/review/ZeropsReviewSurface";

import { RegistryContext } from "@effect/atom-react";
import {
  HARNESS_HQ,
  HARNESS_PICTURES,
  HARNESS_PICTURE_REGISTRY,
  harnessDescription,
} from "./reviewHarnessPictures";

/** Each made-up readout's diffs, by path: what unfolding a file reads from its repository. */
const DIFFS = new WeakMap<ChangeReadout, ReadonlyMap<string, ReviewDiffState>>();
const NO_DIFF: ReviewDiffState = { kind: "read", file: undefined, cut: false };

function ChangeReviewView(props: Omit<ChangeReviewViewProps, "fileDiffs">) {
  const { readout } = props;
  const diffs = readout.kind === "read" ? DIFFS.get(readout.value) : undefined;
  return (
    <RegistryContext value={HARNESS_PICTURE_REGISTRY}>
      <ProjectedChangeReviewView
        appId="beviro"
        fileDiffs={{ diffOf: (path) => diffs?.get(path) ?? NO_DIFF, ask: noop }}
        {...props}
      />
    </RegistryContext>
  );
}

const NOW = Date.now();
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const noop = () => {};

const DIFF = [
  "diff --git a/src/server/routes/status.ts b/src/server/routes/status.ts",
  "new file mode 100644",
  "--- /dev/null",
  "+++ b/src/server/routes/status.ts",
  "@@ -0,0 +1,6 @@",
  '+import { Hono } from "hono";',
  '+import { hostname } from "node:os";',
  "+",
  '+export const status = new Hono().get("/", (c) =>',
  "+  c.json({ hostname: hostname(), node: process.version, time: new Date().toISOString() }),",
  "+);",
  "diff --git a/src/server/index.ts b/src/server/index.ts",
  "--- a/src/server/index.ts",
  "+++ b/src/server/index.ts",
  '@@ -10,7 +10,8 @@ import { web } from "./routes/web";',
  ' import { health } from "./routes/health";',
  '+import { status } from "./routes/status";',
  " ",
  " const app = new Hono();",
  ' app.route("/health", health);',
  '-app.route("/", web);',
  '+app.route("/status", status);',
  '+app.route("/", web);',
  "diff --git a/.nvmrc b/.nvmrc",
  "--- a/.nvmrc",
  "+++ b/.nvmrc",
  "@@ -1 +1 @@",
  "-20",
  "+22",
].join("\n");

/** The files HQ recorded of a change, and each one's diff as unfolding it reads it. */
interface HarnessFiles {
  readonly files: ReadonlyArray<RecordedChangeFile>;
  readonly diffs: ReadonlyMap<string, ReviewDiffState>;
}

/**
 * A `git diff` of several files, one patch per file, with the lines it adds and deletes. From
 * `cutAt` on, a file's diff is too long to read here.
 */
function hqFiles(
  diff: string,
  counts: ReadonlyArray<readonly [path: string, added: number, deleted: number]>,
  cutAt?: number,
): HarnessFiles {
  const patches = diff.split(/\n(?=diff --git )/u);
  return {
    files: counts.map(([path, added, deleted]) => ({ path, added, deleted, binary: false })),
    diffs: new Map(
      counts.map(([path], index) => [
        path,
        cutAt !== undefined && index >= cutAt
          ? { kind: "read", file: undefined, cut: true }
          : { kind: "read", file: parseChangeDiff(patches[index] ?? "").get(path), cut: false },
      ]),
    ),
  };
}

const FILES = hqFiles(DIFF, [
  ["src/server/routes/status.ts", 38, 0],
  ["src/server/index.ts", 3, 2],
  [".nvmrc", 1, 1],
]);

const WORDS =
  "Adds a /status route that lists the app's uptime and its last deploy, refreshed on each visit. It stays behind the sign-in, like the rest of the admin pages.";

const HEAD = "b21d904cb21d904cb21d904cb21d904cb21d904c";
/** `main` as the change was cut from it. */
const BASE = "ba5e000ba5e000ba5e000ba5e000ba5e000ba5e";

function pull(over: Partial<FlowPullRequest> = {}): FlowPullRequest {
  return {
    repository: "appdev",
    number: 2,
    title: "Add a /status page with the uptime and the last deploy",
    kind: "code",
    mateProjectId: "p-nova",
    url: `${HARNESS_HQ}/changes/g-snap/appdev/2`,
    mergeability: "mergeable",
    behind: false,
    merged: false,
    mergedAt: undefined,
    headSha: HEAD,
    baseBranch: "main",
    line: "appdev #2",
    updatedAt: minutesAgo(4),
    ...over,
  };
}

/** A change's commits, newest first, as a Mate's run leaves them. */
const COMMIT_SUBJECTS = [
  "Answer /status with the running version",
  "Refresh the status page every 30 seconds",
  "Keep /health for the load balancer",
  "Move .nvmrc to Node 22",
  "Read the uptime from performance.timeOrigin",
  "Draw the requests of the last hour",
  "Stack the status cards on a phone",
  "Say when the last deploy was",
  "Put the status page behind the sign-in",
  "Name the status route in the admin menu",
  "Cache the version for a minute",
  "Test /status answers without a session",
  "Test /status answers the version",
  "Tidy the status route's imports",
  "Add the status page's empty state",
  "Add the status page's error state",
  "Wire /status into the router",
  "Add a status route",
  "Start the status page",
];

function commits(count: number): ReadonlyArray<ChangeCommit> {
  return COMMIT_SUBJECTS.slice(0, count).map((subject, index) => ({
    sha: `${(0xb21d904 + index * 7919).toString(16)}${"c".repeat(33)}`,
    subject,
    authorName: "Nova",
    at: minutesAgo(4 + index * 95),
  }));
}

/** HQ's merge of main on the change's branch, after the change under it merged. */
const CORE_MERGE: ChangeCommit = {
  sha: `2c0e${"d".repeat(36)}`,
  subject: "Merge main as #1 landed it",
  authorName: "Core",
  at: minutesAgo(2),
};
const CORE_PUSH = {
  at: minutesAgo(2),
  from: commits(1)[0]?.sha ?? HEAD,
  head: CORE_MERGE.sha,
  landed: 1,
  squash: `5e1f${"a".repeat(36)}`,
};

const CHANGE: HqChange = {
  appId: "g-snap",
  repo: "appdev",
  number: 2,
  mateProjectId: "p-nova",
  title: "Add a /status page with the uptime and the last deploy",
  body: "",
  state: "open",
  head: HEAD,
  mergedSha: null,
  landedHead: null,
  openedAt: minutesAgo(400),
  mergedAt: null,
  closedAt: null,
  updatedAt: minutesAgo(400),
  mergeability: "clean",
  behind: false,
  ready: true,
  comments: 0,
};

/** What HQ recorded of the change, `over` it, as its review reads it (`changeReadoutOfRecord`). */
function detail(
  over: {
    readonly mergeability?: HqChange["mergeability"];
    readonly conflictPaths?: ReadonlyArray<string>;
    /** `main` moved on past where the change was cut from it. */
    readonly behind?: boolean;
    readonly files?: HarnessFiles;
    readonly filesTruncated?: boolean;
    readonly commits?: ReadonlyArray<ChangeCommit>;
  } = {},
): ReadoutPart<ChangeReadout> {
  const files = over.files ?? FILES;
  const value = changeReadoutOfRecord(
    { ...CHANGE, mergeability: over.mergeability ?? "clean", behind: over.behind ?? false },
    {
      mergeBase: BASE,
      files: files.files,
      filesTruncated: over.filesTruncated ?? false,
      conflictPaths: over.conflictPaths ?? [],
      commits: over.commits ?? commits(3),
      commitsTruncated: false,
    },
  );
  DIFFS.set(value, files.diffs);
  return { kind: "read", value };
}

const READ = detail();

function said(id: number, author: string, body: string, minutes: number): HqChangeComment {
  return {
    id: `c${String(id)}`,
    authorUserId: author,
    authorMateProjectId: null,
    body,
    createdAt: minutesAgo(minutes),
  };
}

const TALK: ReadonlyArray<HqChangeComment> = [
  said(
    1,
    "u-ales",
    "Does the page still load when the database is down? That is when I'd open it.",
    95,
  ),
  said(
    2,
    "u-wren",
    "It does: the uptime and the version come from the process, and the requests card says it could not read them.",
    41,
  ),
];

/** A long thread, as a change that went back and forth gathers. */
const LONG_TALK: ReadonlyArray<HqChangeComment> = Array.from({ length: 9 }, (_, index) =>
  index % 2 === 0
    ? said(
        index + 1,
        "u-ales",
        `Round ${String(index / 2 + 1)}: the cards still jump on a phone.`,
        400 - index * 40,
      )
    : said(index + 1, "u-wren", "Checked again on a 390 px screen: still fine.", 390 - index * 40),
);

function comments(state: ChangeDiscussion["state"]): ChangeDiscussion {
  return {
    state,
    say: async () => null,
    saying: false,
    waiting: false,
    pending: null,
    landed: null,
    retry: noop,
  };
}

/** The organization's members by their Zerops user id. */
const MEMBERS = new Map([
  ["u-ales", "Aleš"],
  ["u-wren", "Wren"],
]);

function remarksOf(conversation: ChangeDiscussion) {
  return conversation.state.kind === "read"
    ? changeRemarks({
        comments: conversation.state.comments,
        nameOf: (userId) => MEMBERS.get(userId),
        mateNameOf: () => NOVA.name,
        me: "u-ales",
      })
    : [];
}

const TALKING = comments({ kind: "read", comments: TALK });

const NOVA = { name: "Nova", tint: "slate", mine: true } as const;
/** A Mate deleted since it opened the change: no face, nobody's own. */
const GONE = { name: "the Mate", tint: undefined, mine: false } as const;
const HEIRS = [
  { projectId: "p-sage", name: "Sage" },
  { projectId: "p-juno", name: "Juno" },
];

const IDLE: ReviewPress = { kind: "idle" };
/** Nobody asked to close it. */
const OPEN: ReviewClose = { kind: "idle" };
/** All HQ's rule offers a developer of the application: comment, Merge, Close. */
const DEVELOPS: ZeropsChangeOffers = {
  read: true,
  comment: true,
  merge: true,
  close: true,
  why: {},
  readRefused: false,
};
/** The people the project's merge limit names, as the member list calls them. */
const MERGER_NAMES: Readonly<Record<string, string>> = {
  "u-ada": "Ada K.",
  "u-sam": "Sam R.",
  "u-lee": "Lee P.",
  "u-noor": "Noor T.",
  "u-kim": "Kim L.",
};
/** Who merges, as the held press says it of the first `named` of them. */
const mergersOnly = (named: number) =>
  mergeLimitWords(Object.keys(MERGER_NAMES).slice(0, named), (userId) => MERGER_NAMES[userId]);
/** Merge held by the project's merge limit: comment and Close stay, Merge says who merges. */
const mergeHeld = (named: number): ZeropsChangeOffers => ({
  ...DEVELOPS,
  merge: false,
  why: { merge: mergersOnly(named) },
});
/** Merged a minute ago: the review says what happened, and offers the release's review. */
const MERGED_NOW: Partial<FlowPullRequest> = {
  state: "closed",
  merged: true,
  mergedAt: minutesAgo(1),
  updatedAt: minutesAgo(1),
};
const NONE_OPEN: ReadonlyArray<string> = [];
const OFFERED = { kind: "offered" } as const;

/** A change with a long diff: a lockfile read whole, and files after it too long to read here. */
const LONG_DIFF = [
  "diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml",
  "--- a/pnpm-lock.yaml",
  "+++ b/pnpm-lock.yaml",
  "@@ -1,0 +1,2600 @@",
  ...Array.from({ length: 2_600 }, (_, index) => `+  /pkg-${String(index)}@1.0.0: {}`),
].join("\n");
const LONG = detail({
  files: hqFiles(
    LONG_DIFF,
    [
      ["pnpm-lock.yaml", 2_600, 0],
      ["src/server/index.ts", 3, 2],
      ["src/web/app.tsx", 12, 4],
    ],
    1,
  ),
  filesTruncated: true,
});

/** A change whose diff holds lines far wider than the review: an import list and an inlined SVG. */
const WIDE_IMPORT = `import { pool, migrate, ensureInbox, boardCols, itemCols, bus, changed, listenForChanges, ${Array.from(
  { length: 24 },
  (_, index) => `columnReader${String(index)}`,
).join(", ")} } from "./db";`;
const WIDE_SVG = `const logo = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="${Array.from(
  { length: 40 },
  (_, index) => `M${String(index)} ${String(index * 2)}L${String(index + 3)} ${String(index)}`,
).join(" ")}"/></svg>';`;
const WIDE = detail({
  files: hqFiles(
    [
      "diff --git a/server/index.ts b/server/index.ts",
      "--- a/server/index.ts",
      "+++ b/server/index.ts",
      `@@ -1,3 +1,4 @@ ${WIDE_IMPORT.slice(0, 60)}`,
      '-import { pool } from "./db";',
      `+${WIDE_IMPORT}`,
      `+${WIDE_SVG}`,
      " ",
      " const app = new Hono();",
    ].join("\n"),
    [["server/index.ts", 2, 1]],
  ),
});

/** A project with a stage and a production, as `environments.yaml` declares them. */
const STAGE_AND_PRODUCTION: ChangeReviewViewProps["environments"] = [
  { tier: "stage" },
  { tier: "production" },
];
/** A project that has made nothing from its recipe yet. */
const NO_ENVIRONMENTS: ChangeReviewViewProps["environments"] = [];

/** A change to the group repo's recipe, from a Mate's bot. */
const RECIPE: Partial<FlowPullRequest> = {
  repository: "group",
  kind: "recipe",
  number: 7,
  title: "Add a mail service to the Remote (CDE) and Local setups",
  line: "#7",
  url: `${HARNESS_HQ}/changes/g-snap/group/7`,
};

/** The same service added to two tiers, as git names a path with an em dash in it. */
function recipeDiff(tiers: ReadonlyArray<string>): string {
  return tiers
    .flatMap((tier) => {
      const path = `${tier.replace("—", "\\342\\200\\224")}/import.yaml`;
      return [
        `diff --git "a/${path}" "b/${path}"`,
        `--- "a/${path}"`,
        `+++ "b/${path}"`,
        "@@ -18,3 +18,9 @@ services:",
        "   - hostname: db",
        "     type: postgresql@17",
        "     mode: NON_HA",
        "+",
        "+  - hostname: mail",
        "+    type: nodejs@22",
        `+    buildFromGit: ${HARNESS_HQ}/git/g-snap/mail.git`,
        "+    zeropsSetup: mail",
        "+    enableSubdomainAccess: true",
      ];
    })
    .join("\n");
}

/** What a recipe change touching `tiers` reads as: each tier's recipe, and its diff. */
function recipeRead(tiers: ReadonlyArray<string>): ReadoutPart<ChangeReadout> {
  return detail({
    files: hqFiles(
      recipeDiff(tiers),
      tiers.map((tier) => [`${tier}/import.yaml`, 6, 0] as const),
    ),
    commits: [
      {
        sha: `7d1e0a4${"d".repeat(33)}`,
        subject: "Add a mail service",
        authorName: "Nova",
        at: minutesAgo(6),
      },
    ],
  });
}

/** The owner's case: two recipes nothing in the project is made from. */
const UNUSED_TIERS = ["1 — Remote (CDE)", "2 — Local"];
/** The two recipes a stage and a production are made from. */
const MADE_FROM_TIERS = ["3 — Stage", "4 — Small Production"];

/** HQ's record, still on its way: what the flow knew paints, the rest holds its room. */
const READING = { kind: "reading" } as const;
const UNREAD = { kind: "failed", reason: "HQ is not answering right now." } as const;

function Change({
  over,
  readout = READ,
  open = NONE_OPEN,
  described = true,
  conversation = TALKING,
  environments = STAGE_AND_PRODUCTION,
  offers = DEVELOPS,
  press = IDLE,
  closing = OPEN,
  frame,
  addable,
  mate = NOVA,
  heirs,
  hand,
  landedTitle,
  followsMain = false,
}: {
  /** The project's production is deployed outside Mate and follows `main`. */
  readonly followsMain?: boolean;
  readonly over?: Partial<FlowPullRequest>;
  /** The merged change HQ brought main in after, by its title. */
  readonly landedTitle?: string;
  /** What HQ recorded of it, where it is not the one every state shares. */
  readonly readout?: ChangeReviewViewProps["readout"];
  readonly open?: ReadonlyArray<string>;
  /** Whether its Mate described it: the description every state shares, unless one is given. */
  readonly described?: boolean;
  readonly conversation?: ChangeDiscussion;
  readonly environments?: ChangeReviewViewProps["environments"];
  readonly offers?: ChangeReviewViewProps["offers"];
  readonly press?: ReviewPress;
  readonly closing?: ReviewClose;
  readonly frame?: ChangeReviewViewProps["frame"];
  /** The environments the one question after a first merge may offer. */
  readonly addable?: ChangeReviewViewProps["addable"];
  readonly mate?: ChangeReviewViewProps["mate"];
  readonly heirs?: ChangeReviewViewProps["heirs"];
  readonly hand?: ChangeReviewViewProps["hand"];
}) {
  const value = pull(described ? { description: WORDS, ...over } : over);
  return (
    <ChangeReviewView
      addable={addable}
      closing={closing}
      comments={conversation}
      environments={environments}
      onAddEnvironment={noop}
      frame={frame}
      hqAddress={HARNESS_HQ}
      initiallyOpen={open}
      followsMain={followsMain}
      live={followsMain ? undefined : "v0.1.0"}
      mate={mate}
      heirs={heirs}
      hand={hand}
      landedTitle={landedTitle}
      onHand={noop}
      now={NOW}
      onAsk={async () => {}}
      onClose={noop}
      onOpenPage={frame === "page" ? undefined : noop}
      previews={PREVIEWS}
      project="Beviro"
      stages={environments.some((entry) => entry.tier === "stage") ? ["stage"] : []}
      onRetry={noop}
      remarks={remarksOf(conversation)}
      onFix={noop}
      onClosing={noop}
      onMerge={noop}
      onOpenRun={value.description === undefined ? undefined : noop}
      offers={offers}
      pictures={HARNESS_PICTURES}
      press={press}
      pull={value}
      readout={readout}
      waitingForProduction={0}
      release={{ allowed: true }}
    />
  );
}

/** The Mate's preview, its pair's stage half: what "Try it" opens. */
const PREVIEWS = [
  {
    service: "app",
    url: "https://appstage-beviro.prg1.zerops.app",
  },
];

const RELEASE_ROWS = [
  {
    key: "a1",
    title: "Performance tuning across the storefront and backend",
    change: { repository: "appdev", number: 54 },
    mateProjectId: "p-juno",
    mergedAt: minutesAgo(60 * 26),
    stage: "on-stage" as const,
    face: { tint: "sky" as const },
    mate: "Juno",
    sub: "Juno · merged 1 day ago",
  },
  {
    key: "b2",
    title: "Clearer copy on the admin sign-in",
    change: { repository: "appdev", number: 55 },
    mateProjectId: "p-cleo",
    mergedAt: minutesAgo(90),
    stage: "on-stage" as const,
    face: { tint: "sand" as const },
    mate: "Cleo",
    sub: "Cleo · merged 1 hour ago",
  },
];

/** What a roll back to v0.1.55 takes off production: the two changes v0.1.57 put live. */
const LEAVING: RollbackList = { state: "known", rows: RELEASE_ROWS, count: 2, atLeast: false };
const NOTHING_BACK: RollbackList = { state: "known", rows: [], count: 0, atLeast: false };

function Rollback({
  leaving = LEAVING,
  comingBack = NOTHING_BACK,
  untold = NONE_OPEN,
  press = IDLE,
  outcome = OFFERED,
}: {
  readonly press?: ReviewPress;
  readonly outcome?: Parameters<typeof RollbackReviewView>[0]["outcome"];
  readonly leaving?: RollbackList;
  readonly comingBack?: RollbackList;
  readonly untold?: ReadonlyArray<string>;
}) {
  return (
    <RollbackReviewView
      comingBack={comingBack}
      leaving={leaving}
      line="app 7e1c0d2 · api 7e1c0d2"
      live="v0.1.57"
      permission={{ allowed: true }}
      name="Beviro"
      nextTag="v0.1.58"
      now={NOW}
      onClose={noop}
      onOpenChange={noop}
      onRollBack={noop}
      outcome={outcome}
      press={press}
      services={["app", "api"]}
      tag="v0.1.55"
      untold={untold}
      appId="beviro"
      where={[
        {
          service: "app",
          line: "goes back to 7e1c0d2",
          code: { repository: "appdev", sha: SEVEN_E },
        },
        {
          service: "api",
          line: "goes back to 7e1c0d2",
          code: { repository: "apidev", sha: SEVEN_E },
        },
      ]}
    />
  );
}

const SEVEN_E = "7e1c0d2".padEnd(40, "0");

/** A commit someone pushed to `main` themselves: no change, no review; it opens in the Git browser. */
const UNREVIEWED_ROW = {
  key: "c3",
  title: "Bump the VAT table",
  change: undefined,
  commit: { repository: "appdev", sha: "c3".padEnd(40, "0") },
  mateProjectId: undefined,
  mergedAt: undefined,
  stage: "on-stage" as const,
  sub: "",
};

const WHERE = [
  { service: "app", line: "redeploys from 3fa9c21" },
  { service: "api", line: "redeploys from 3fa9c21" },
];

type ReleaseProps = Parameters<typeof ReleaseReviewView>[0];
type ReleasePlan = NonNullable<ReleaseProps["servicePlan"]>;

/** HQ's plan of a release that needs a database production lacks before it deploys the app. */
const CREATE_DB: Extract<ReleasePlan["operations"][number], { kind: "create" }> = {
  kind: "create",
  service: "db",
  settings: {
    hostname: "db",
    type: "postgresql@18",
    mode: "HA",
    verticalAutoscaling: { minRam: 1, maxRam: 4 },
  },
  cost: "Adds one billed service; resource usage is charged by Zerops according to the reviewed settings.",
};
const CREATION_PLAN: ReleasePlan = {
  hash: "a".repeat(64),
  operations: [CREATE_DB, { kind: "deploy", service: "app", sha: SEVEN_E }],
};
/** The same plan read again once the database stands: it only deploys. */
const DEPLOY_PLAN: ReleasePlan = {
  hash: "b".repeat(64),
  operations: [{ kind: "deploy", service: "app", sha: SEVEN_E }],
};
/** A release that moves the app alone: the api stays as it is. */
const APP_ALONE = {
  services: ["app"],
  where: [
    { service: "app", line: "gets v0.1.57" },
    { service: "api", line: "stays as it is" },
  ],
} satisfies Partial<ReleaseProps>;
const NO_CREATION = { run: { kind: "none" }, created: [], onCreate: noop } as const;
/** A release of three services, and HQ's plan of it: one deploy each. */
const THREE = {
  services: ["app", "api", "worker"],
  listed: ["app", "api", "worker"],
  where: [
    { service: "app", line: "gets v0.1.57" },
    { service: "api", line: "gets v0.1.57" },
    { service: "worker", line: "gets v0.1.57" },
  ],
  production: {
    at: undefined,
    addresses: [{ service: "app", url: "https://beviro.app" }],
    parts: [
      { hostname: "app", version: "v0.1.56" },
      { hostname: "api", version: "v0.1.56" },
      { hostname: "worker", version: "v0.1.56" },
    ],
  },
} satisfies Partial<ReleaseProps>;
const THREE_PLAN: ReleasePlan = {
  hash: "d".repeat(64),
  operations: THREE.services.map((service) => ({ kind: "deploy", service, sha: SEVEN_E })),
};

/**
 * A release whose production's setup gained a cache: HQ creates it, then deploys both parts. HQ
 * names the production "acme-production", and stops the release at the creation because the
 * deploy key it keeps for it reaches more than its project.
 */
const KEY_ENVIRONMENT = "acme-production";
const KEY_WIDENED = `${KEY_ENVIRONMENT}'s deploy token reaches more than its project; a person with admin access to its project renews it in Zerops Mate`;
const KEY_PLAN: ReleasePlan = {
  hash: "c".repeat(64),
  operations: [
    {
      kind: "create",
      service: "cache",
      settings: { hostname: "cache", type: "valkey@7.2", mode: "NON_HA" },
      cost: "Adds one billed service; resource usage is charged by Zerops according to the reviewed settings.",
    },
    { kind: "deploy", service: "api", sha: SEVEN_E },
    { kind: "deploy", service: "shop", sha: SEVEN_E },
  ],
};
/** What stands the same in every state of that release. */
const KEY_RELEASE = {
  servicePlan: KEY_PLAN,
  services: ["api", "shop"],
  where: [
    { service: "api", line: "gets v0.1.57" },
    { service: "shop", line: "gets v0.1.57" },
  ],
  production: {
    at: undefined,
    addresses: [{ service: "shop", url: "https://shop.acme.example" }],
    parts: [
      { hostname: "api", version: "v0.1.56" },
      { hostname: "shop", version: "v0.1.56" },
    ],
  },
  environmentName: KEY_ENVIRONMENT,
  listed: ["api", "shop"],
  creation: NO_CREATION,
  onReviewNew: noop,
} satisfies Partial<ReleaseProps>;
const secondsAgo = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();
const STARTED = { at: secondsAgo(178), by: "you" } as const;

/** One platform process in production, as the sheet reads it (`runningLines`). */
const runningOf = (
  over: Partial<RunningLine> & Pick<RunningLine, "id" | "words" | "doing">,
): RunningLine => ({
  service: undefined,
  trail: undefined,
  waiting: false,
  behind: undefined,
  since: secondsAgo(130),
  version: undefined,
  kind: "build",
  versionId: undefined,
  rank: 2,
  ...over,
});
/** The stopped release before this one, its deploy of shop sent again once the key was renewed. */
const SHOP_SENT_AGAIN = runningOf({
  id: "process-shop-again",
  service: "shop",
  words: "Deploying v0.1.56",
  doing: "is deploying v0.1.56",
  version: "v0.1.56",
  trail: [
    { label: "Build container", state: "done" },
    { label: "Build", state: "done" },
    { label: "Deploy", state: "busy" },
  ],
  rank: 3,
});

/** One production deploy of v0.1.57, as the sheet's steps read HQ's job of it. */
const deployOf = (
  service: string,
  state: ReleaseProgress["deploys"][number]["state"],
  over: Partial<ReleaseProgress["deploys"][number]> = {},
): ReleaseProgress["deploys"][number] => ({
  service,
  state,
  reason: undefined,
  at: secondsAgo(48),
  endedAt: null,
  ...over,
});
const creationOf = (
  state: NonNullable<ReleaseProgress["creation"]>["state"],
  over: Partial<NonNullable<ReleaseProgress["creation"]>> = {},
): NonNullable<ReleaseProgress["creation"]> => ({
  tag: "v0.1.57",
  state,
  reason: undefined,
  services: ["db"],
  at: secondsAgo(178),
  endedAt: null,
  ...over,
});
/** The steps' reads from the jobs the outcome is derived from. */
const progressOfJobs = (jobs: ReadonlyArray<HqJob>): ReleaseProgress => ({
  creation: undefined,
  deploys: jobs.map((job) => ({
    service: job.service ?? "",
    state: job.state,
    reason: job.reason ?? undefined,
    at: job.at,
    endedAt: job.endedAt,
  })),
});

/** v0.1.57 as HQ lists it, deploying app and api from one commit. */
const tagged57 = (over: Partial<FlowReleaseRow> = {}): FlowReleaseRow => ({
  tag: "v0.1.57",
  verdict: "approved",
  detail: undefined,
  line: "app 7e1c0d2 · api 7e1c0d2",
  entries: [
    { service: "app", commit: SEVEN_E },
    { service: "api", commit: SEVEN_E },
  ],
  taggedAt: minutesAgo(1.2),
  standing: undefined,
  word: "Approved",
  rollBack: false,
  failedEntries: [],
  ...over,
});

/** A production service's newest job of v0.1.57, as HQ's navigation streams it. */
const job57 = (service: string, state: HqJob["state"], over: Partial<HqJob> = {}): HqJob => ({
  id: `job-${service}`,
  kind: "deploy",
  service,
  sha: SEVEN_E,
  state,
  cause: "release",
  ref: "v0.1.57",
  reason: null,
  appVersionId: null,
  processId: null,
  requestedBy: null,
  at: minutesAgo(1.2),
  endedAt: null,
  supersededBy: null,
  ...over,
});

const productionReads = (
  jobs: ReadonlyArray<HqJob>,
  stalled: ReleaseFailureReads["stalled"] = undefined,
) => ({
  environmentInputs: [
    {
      tier: "production" as const,
      release: null,
      services: jobs.map((job) => ({
        hostname: job.service ?? "",
        deploy: { latest: job, live: null },
      })),
    },
  ],
  stalled,
});

/** The sheet's outcome as the app derives it (`releaseOutcomeOf`), from HQ's rows and jobs. */
const derived57 = (input: {
  readonly tagged: FlowReleaseRow;
  readonly jobs: ReadonlyArray<HqJob>;
  readonly stalled?: ReleaseFailureReads["stalled"];
}) => {
  const reads = productionReads(input.jobs, input.stalled);
  return releaseOutcomeOf({
    tagged: input.tagged,
    releasing: true,
    stalled: input.stalled !== undefined,
    reads,
    steps: releaseSteps({ tag: "v0.1.57", environmentInputs: reads.environmentInputs, nowMs: NOW }),
    pressing: false,
    tag: "v0.1.57",
    clockMs: NOW,
  });
};

function Release({
  outcome = OFFERED,
  press = IDLE,
  titleId,
  onOpenChange,
  onClose = noop,
  over,
  initialVersion,
}: {
  readonly initialVersion?: string;
  readonly over?: Partial<ReleaseProps> | undefined;
  readonly outcome?: Parameters<typeof ReleaseReviewView>[0]["outcome"];
  readonly press?: ReviewPress;
  readonly titleId?: string | undefined;
  readonly onOpenChange?: Parameters<typeof ReleaseReviewView>[0]["onOpenChange"];
  readonly onClose?: () => void;
}) {
  const [version, setVersion] = useState(initialVersion ?? "0.1.57");
  const tag = releaseVersionField(version, ["v0.1.56"]).tag ?? "v0.1.57";
  return (
    <ReleaseReviewView
      onOpenChange={onOpenChange}
      titleId={titleId}
      fixer="Juno"
      gate={{ allowed: true }}
      permission={{ allowed: true }}
      hasStage
      production={{
        at: minutesAgo(60 * 24 * 4),
        addresses: [{ service: "app", url: "https://beviro.app" }],
        parts: [
          { hostname: "app", version: "v0.1.56" },
          { hostname: "api", version: "v0.1.56" },
        ],
      }}
      replaces={{ kind: "release", tag: "v0.1.56" }}
      started={outcome.kind === "offered" ? undefined : STARTED}
      commits={3}
      name="Beviro"
      now={NOW}
      onClose={onClose}
      onFix={noop}
      onRelease={noop}
      outcome={outcome}
      press={press}
      rows={RELEASE_ROWS}
      services={["app", "api"]}
      tag={tag}
      version={{
        value: version,
        onChange: setVersion,
        nextPatch: "v0.1.57",
        tags: ["v0.1.56"],
        suggestions: [{ tag: "v1.0.0", source: "appdev/package.json" }],
      }}
      untold={[]}
      where={WHERE}
      appId="beviro"
      productionCode={[
        { service: "api", repository: "apidev", sha: SEVEN_E },
        { service: "app", repository: "appdev", sha: SEVEN_E },
      ]}
      {...over}
    />
  );
}

function task(over: Partial<CrewTask> = {}): CrewTask {
  return {
    id: "task-12" as CrewTask["id"],
    number: 12,
    title: "Camera rig for the product shots",
    owner: "juno" as CrewTask["owner"],
    state: "ready",
    source: "lead",
    createdBy: null,
    createdAt: minutesAgo(80),
    dependsOn: [],
    fresh: false,
    brief: "Set up a camera rig component the product page can reuse for its three shots.",
    doneWhen: "The product page renders all three shots from the rig.",
    note: null,
    attempts: 1,
    reason: null,
    question: null,
    waitingOn: [],
    diffStat: { insertions: 45, deletions: 3 },
    report: "Added CameraRig with three presets and moved the product page onto it.",
    check: { state: "passed", output: "" },
    review: null,
    landedCommit: null,
    landedAt: null,
    delivered: false,
    ...over,
  } as CrewTask;
}

function Crew({
  over,
  conflicts = NONE_OPEN,
}: {
  readonly over?: Partial<CrewTask>;
  readonly conflicts?: ReadonlyArray<string>;
}) {
  return (
    <CrewTaskReviewView
      conflicts={conflicts}
      face={{ name: "Juno", tint: "sky", face: "idle" }}
      mateName="Fen"
      onAsk={noop}
      onClose={noop}
      onLand={noop}
      press={{ kind: "idle" }}
      task={task(over)}
    />
  );
}

/**
 * A change whose reads land `after` ms after it opens — its files, commits and comments; its
 * description's pictures never readable — so the first frame can be set against the settled one.
 */
function Settling({
  frame,
  after,
}: {
  readonly frame: ChangeReviewViewProps["frame"];
  readonly after: number;
}) {
  const [read, setRead] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      setRead(true);
    }, after);
    return () => {
      clearTimeout(timer);
    };
  }, [after]);
  return (
    <Change
      conversation={read ? TALKING : comments({ kind: "reading" })}
      frame={frame}
      over={{
        description: harnessDescription({ after, unreadable: true }),
      }}
      readout={read ? detail({ commits: commits(19) }) : READING}
    />
  );
}

/** How long a settling review's reads take, as a slow HQ answers. */
const SETTLE_MS = 1_500;

/** Immediate deploy answers, before the same jobs arrive in HQ's stream. */
const DEPLOY_ANSWER: HqDeployAnswer = {
  jobs: [
    {
      environment: "xyz-production",
      kind: "deploy",
      service: "app",
      sha: "96e2309".padEnd(40, "0"),
      job: "1",
      state: "building",
      processId: "process-1",
      behind: null,
      reason: null,
    },
  ],
  note: null,
};
const QUEUED_ANSWER: HqDeployAnswer = {
  jobs: [
    ...DEPLOY_ANSWER.jobs,
    {
      ...DEPLOY_ANSWER.jobs[0]!,
      service: "api",
      job: "2",
      state: "queued",
      processId: null,
      behind: "1",
    },
    {
      ...DEPLOY_ANSWER.jobs[0]!,
      environment: "xyz-stage",
      job: "3",
      state: "skipped",
      processId: null,
      reason: "This tier has no deploy key.",
    },
  ],
  note: "The preview tier could not be read.",
};

/** A release's sheet in one of its states: what `Release` is handed. */
interface ReleaseSheet {
  readonly id: string;
  readonly label: string;
  readonly props: {
    readonly outcome?: ReleaseProps["outcome"];
    readonly press?: ReviewPress;
    readonly over?: Partial<ReleaseProps>;
    readonly initialVersion?: string;
    readonly onOpenChange?: ReleaseProps["onOpenChange"];
  };
}

const RUNNING_JOBS = [job57("app", "building"), job57("api", "queued")];
const FAILED_JOBS = [
  job57("app", "failed", {
    at: minutesAgo(3.4),
    endedAt: minutesAgo(2),
    reason: "Build failed: npm ERR! missing script: build",
  }),
];

/** HQ's deploy jobs of that release: one it left because the part already runs the commit, one it ended for the creation. */
const KEY_DEPLOYS = [
  deployOf("api", "live", { reason: "api already runs it", endedAt: secondsAgo(25) }),
  deployOf("shop", "refused", {
    reason: "The release creation prerequisite did not resolve successfully; review a new release.",
    endedAt: secondsAgo(25),
  }),
];

/**
 * The release's sheet in every state it reaches, reading to done: each is also the dialog's
 * (`?release=<id>`), in its real frame.
 */
export const RELEASE_SHEETS: ReadonlyArray<ReleaseSheet> = [
  { id: "release-reading-project", label: "Release · the project is not read yet", props: {} },
  {
    id: "release-reading",
    label: "Release · reading what goes out and what production needs",
    props: { over: { changesPending: true, expected: 2, servicePlanPending: true } },
  },
  { id: "release", label: "A release", props: {} },
  {
    id: "release-one",
    label: "Release · one change, one service: the sheet ends at its buttons",
    props: {
      over: { ...APP_ALONE, servicePlan: DEPLOY_PLAN, rows: [RELEASE_ROWS[1]!], commits: 1 },
    },
  },
  {
    id: "release-create",
    label: "Release · ready, with a service to create first",
    props: { over: { ...APP_ALONE, servicePlan: CREATION_PLAN, creation: NO_CREATION } },
  },
  {
    id: "release-create-reading",
    label: "Release · the plan is still read, the changes are listed",
    props: { over: { servicePlanPending: true } },
  },
  {
    id: "release-reading-working",
    label: "Release · the plan read for 4 s: what HQ's review reads",
    props: { over: { servicePlanPending: true, servicePlanWait: "working" } },
  },
  {
    id: "release-reading-late",
    label: "Release · the plan read for 20 s: later than usual, with Try again",
    props: {
      over: { servicePlanPending: true, servicePlanWait: "late", onRetryServicePlan: noop },
    },
  },
  {
    id: "release-reading-unanswered",
    label: "Release · no plan after 45 s: the wait is over, with Try again",
    props: {
      over: {
        gate: { allowed: false, reason: NO_ANSWER_IN_TIME },
        servicePlanFailure: NO_ANSWER_IN_TIME,
        onRetryServicePlan: noop,
      },
    },
  },
  {
    id: "release-create-refused",
    label: "Release · the plan could not be read, with Review again",
    props: {
      over: {
        gate: { allowed: false, reason: "The production plan changed. Review it again." },
        servicePlanFailure: "The production plan changed. Review it again.",
        onRetryServicePlan: noop,
      },
    },
  },
  {
    id: "release-blocked-gate",
    label: "Release · HQ holds it, in HQ's words, its name for production said as Production",
    props: {
      over: {
        environmentName: KEY_ENVIRONMENT,
        gate: {
          allowed: false,
          reason: `${KEY_ENVIRONMENT} is still taking its last release. Release once it is live.`,
        },
      },
    },
  },
  {
    id: "release-blocked-permission",
    label: "Release · not this person's to press",
    props: {
      over: {
        gate: { allowed: false, reason: "Ask an owner of Acme to make you a releaser." },
        permission: { allowed: false, reason: "Ask an owner of Acme to make you a releaser." },
      },
    },
  },
  {
    id: "release-merge-limited",
    label: "Release · to Git, held by the project's merge limit: who merges, by name",
    props: {
      over: {
        gate: { allowed: false, reason: mergersOnly(2), refusedBy: "hq" },
        permission: { allowed: false, reason: mergersOnly(2), refusedBy: "hq" },
      },
    },
  },
  {
    id: "release-nothing",
    label: "Release · nothing merged to release",
    props: { over: { gate: { allowed: false, reason: RELEASE_NOTHING_MERGED }, rows: [] } },
  },
  {
    id: "release-create-early",
    label: "Release · the early path creating the service",
    props: {
      over: {
        ...APP_ALONE,
        servicePlan: CREATION_PLAN,
        creation: { ...NO_CREATION, run: { kind: "working", sinceMs: NOW - 100_000 } },
      },
    },
  },
  {
    id: "release-create-early-failed",
    label: "Release · the early path, Zerops could not create it",
    props: {
      over: {
        ...APP_ALONE,
        servicePlan: CREATION_PLAN,
        creation: {
          ...NO_CREATION,
          run: {
            kind: "failed",
            words: "Zerops could not create db: The project has reached its limit of services.",
          },
        },
      },
    },
  },
  {
    id: "release-create-early-done",
    label: "Release · the early path created it, the release only deploys",
    props: {
      over: {
        ...APP_ALONE,
        servicePlan: DEPLOY_PLAN,
        creation: { run: { kind: "created" }, created: [CREATE_DB], onCreate: undefined },
      },
    },
  },
  {
    id: "release-unreviewed",
    label: "A release carrying a commit nobody reviewed, opening in the Git browser",
    props: { onOpenChange: noop, over: { rows: [...RELEASE_ROWS, UNREVIEWED_ROW] } },
  },
  {
    id: "release-many",
    label: "Release · more than six changes",
    props: {
      onOpenChange: noop,
      over: {
        rows: Array.from({ length: 9 }, (_, index) => ({
          ...RELEASE_ROWS[index % 2]!,
          key: `m${String(index)}`,
          change: { repository: "appdev", number: 60 + index },
        })),
        commits: 14,
      },
    },
  },
  {
    id: "release-first",
    label: "The first release",
    props: { over: { replaces: { kind: "first" } } },
  },
  {
    id: "release-version",
    label: "The person's version, with the code's declaration",
    props: { initialVersion: "1.0.0" },
  },
  {
    id: "release-version-invalid",
    label: "A version that already exists",
    props: { initialVersion: "0.1.56" },
  },
  {
    id: "release-pressed",
    label: "Release · pressed, HQ has not answered",
    props: {
      outcome: { kind: "releasing", progress: "Preparing v0.1.57" },
      press: { kind: "running" },
      over: { started: { at: secondsAgo(1), by: "you" } },
    },
  },
  {
    id: "release-create-running",
    label: "Release · HQ creating the service",
    props: {
      outcome: { kind: "releasing" },
      press: { kind: "done" },
      over: {
        ...APP_ALONE,
        servicePlan: CREATION_PLAN,
        started: { at: secondsAgo(100), by: "you" },
        progress: { creation: creationOf("creating", { at: secondsAgo(100) }), deploys: [] },
      },
    },
  },
  {
    id: "release-running-steps",
    label: "Release · created, the app building",
    props: {
      outcome: { kind: "releasing" },
      press: { kind: "done" },
      over: {
        ...APP_ALONE,
        servicePlan: CREATION_PLAN,
        progress: {
          creation: creationOf("created", { endedAt: secondsAgo(48) }),
          deploys: [deployOf("app", "building")],
        },
        logOf: () => ({
          projectId: "p-production",
          target: { jobId: "job-app", processId: "process-app", appVersionId: null },
        }),
      },
    },
  },
  {
    id: "release-create-failed",
    label: "Release · stopped, Zerops could not create the service",
    props: {
      outcome: { kind: "failed", detail: "Its production deploy failed", services: [] },
      press: { kind: "done" },
      over: {
        ...APP_ALONE,
        servicePlan: CREATION_PLAN,
        creation: NO_CREATION,
        progress: {
          creation: creationOf("failed", {
            reason: "Internal Server Error",
            at: secondsAgo(250),
            endedAt: secondsAgo(65),
          }),
          deploys: [],
        },
      },
    },
  },
  {
    id: "release-key-reading",
    label: "Release · reading, a step per service the release lists",
    props: {
      over: {
        ...KEY_RELEASE,
        servicePlan: undefined,
        changesPending: true,
        expected: 2,
        servicePlanPending: true,
      },
    },
  },
  {
    id: "release-key-early-jobs",
    label: "Release · the deploys' rows came before the creation's: it is still creating",
    props: {
      outcome: { kind: "releasing" },
      press: { kind: "done" },
      over: {
        ...KEY_RELEASE,
        started: { at: secondsAgo(15), by: "you" },
        progress: { creation: undefined, deploys: KEY_DEPLOYS },
      },
    },
  },
  {
    id: "release-early-build",
    label: "Release · a build seen before the creation's row: nothing says created",
    props: {
      outcome: { kind: "releasing" },
      press: { kind: "done" },
      over: {
        ...KEY_RELEASE,
        started: { at: secondsAgo(8), by: "you" },
        // The build HQ's answer names is an older release's, sent again: it proves nothing.
        progress: { creation: undefined, deploys: [deployOf("shop", "building")] },
        running: [SHOP_SENT_AGAIN],
      },
    },
  },
  {
    id: "release-busy-production",
    label: "Release · production busy with an older deploy: the release waits for it",
    props: {
      outcome: {
        kind: "releasing",
        clock: "Step 1 of 4 · 3m 10s · taking longer than usual",
      },
      press: { kind: "done" },
      over: {
        ...KEY_RELEASE,
        started: { at: secondsAgo(190), by: "you" },
        progress: {
          creation: {
            tag: "v0.1.57",
            state: "creating",
            reason: undefined,
            services: ["cache"],
            at: secondsAgo(106),
            endedAt: null,
          },
          deploys: [deployOf("api", "queued"), deployOf("shop", "queued")],
        },
        running: [
          SHOP_SENT_AGAIN,
          runningOf({
            id: "process-mail",
            service: "mail",
            words: "Restarting",
            doing: "is restarting",
            kind: "other",
            since: secondsAgo(12),
          }),
        ],
      },
    },
  },
  {
    id: "release-running-trails",
    label: "Release · each deploy says where its build stands",
    props: {
      outcome: { kind: "releasing" },
      press: { kind: "done" },
      over: {
        ...KEY_RELEASE,
        started: { at: secondsAgo(205), by: "you" },
        progress: {
          creation: {
            tag: "v0.1.57",
            state: "created",
            reason: undefined,
            services: ["cache"],
            at: secondsAgo(200),
            endedAt: secondsAgo(150),
          },
          deploys: [
            deployOf("api", "building", { at: secondsAgo(148), processId: "process-api" }),
            deployOf("shop", "building", { at: secondsAgo(148), processId: "process-shop" }),
          ],
        },
        running: [
          runningOf({
            id: "process-api",
            service: "api",
            words: "Deploying v0.1.57",
            doing: "is deploying v0.1.57",
            version: "v0.1.57",
            trail: [
              { label: "Build container", state: "done" },
              { label: "Build", state: "done" },
              { label: "Deploy", state: "busy" },
            ],
            rank: 3,
          }),
          runningOf({
            id: "process-shop",
            service: "shop",
            words: "Building v0.1.57",
            doing: "is building v0.1.57",
            version: "v0.1.57",
            trail: [
              { label: "Build container", state: "done" },
              { label: "Build", state: "busy" },
              { label: "Deploy", state: "waiting" },
            ],
          }),
        ],
        logOf: (service) => ({
          projectId: "p-production",
          target: { jobId: `job-${service}`, processId: `process-${service}`, appVersionId: null },
        }),
      },
    },
  },
  ...(
    [
      ["release-key-stopped", "HQ will not use production's key", { kind: "none" }, true],
      ["release-key-renewing", "the key being renewed", { kind: "working" }, true],
      [
        "release-key-renewed",
        "the key renewed, a new release the way on",
        { kind: "renewed" },
        true,
      ],
      [
        "release-key-renew-failed",
        "the renewal failed, in its own words",
        {
          kind: "failed",
          words:
            "Zerops did not confirm the new key; check production's access tokens in Zerops, then renew again.",
        },
        true,
      ],
      ["release-key-not-admin", "not this person's key to renew", { kind: "none" }, false],
    ] as const
  ).map(([id, label, run, admin]): ReleaseSheet => ({
    id,
    label: `Release · stopped at the creation, ${label}`,
    props: {
      outcome: { kind: "failed", detail: "Its production deploy failed", services: ["shop"] },
      press: {
        kind: "done",
        deploys: { jobs: [], note: `HQ could not stop mail: ${KEY_WIDENED}` },
      },
      over: {
        ...KEY_RELEASE,
        started: { at: secondsAgo(40), by: "you" },
        progress: {
          creation: creationOf("failed", {
            reason: KEY_WIDENED,
            services: ["cache"],
            at: secondsAgo(40),
            endedAt: secondsAgo(24),
          }),
          deploys: KEY_DEPLOYS,
        },
        keyRenewal: { run, onRenew: admin ? noop : undefined },
      },
    },
  })),
  {
    id: "release-reopened-key",
    label: "See why · opened on the release that stopped on production's key, nothing pressed here",
    props: {
      outcome: { kind: "failed", detail: "Its production deploy failed", services: ["shop"] },
      over: {
        ...KEY_RELEASE,
        started: { at: minutesAgo(42), by: "Dana" },
        progress: {
          creation: creationOf("failed", {
            reason: KEY_WIDENED,
            services: ["cache"],
            at: minutesAgo(42),
            endedAt: minutesAgo(41.7),
          }),
          deploys: KEY_DEPLOYS,
        },
        keyRenewal: { run: { kind: "none" }, onRenew: noop },
      },
    },
  },
  {
    id: "release-reopened",
    label: "See why · opened on a release whose deploy failed, the next one a press away",
    props: {
      outcome: derived57({
        tagged: tagged57({
          standing: "deploy-failed",
          failedEntries: [{ service: "app", commit: SEVEN_E }],
        }),
        jobs: FAILED_JOBS,
      }),
      over: { progress: progressOfJobs(FAILED_JOBS), onReviewNew: noop },
    },
  },
  {
    id: "release-key-deploy",
    label: "Release · stopped at a deploy, the key HQ keeps no longer answers",
    props: {
      outcome: { kind: "failed", detail: "The deploy of app failed", services: ["app"] },
      press: { kind: "done" },
      over: {
        environmentName: KEY_ENVIRONMENT,
        keyRenewal: { run: { kind: "none" }, onRenew: noop },
        progress: {
          creation: undefined,
          deploys: [
            deployOf("app", "refused", {
              reason: `${KEY_ENVIRONMENT}'s deploy token no longer answers; a person with admin access to its project renews it in Zerops Mate`,
              endedAt: secondsAgo(40),
            }),
            deployOf("api", "failed", {
              reason: "Build failed: the lockfile is out of date",
              at: secondsAgo(120),
              endedAt: secondsAgo(40),
            }),
          ],
        },
      },
    },
  },
  {
    id: "releasing",
    label: "Releasing · two services",
    props: {
      outcome: derived57({ tagged: tagged57(), jobs: RUNNING_JOBS }),
      press: { kind: "done" },
      over: {
        progress: progressOfJobs(RUNNING_JOBS),
        started: { at: minutesAgo(1.2), by: "Dana" },
      },
    },
  },
  {
    id: "release-late",
    label: "Releasing · taking longer than usual",
    props: {
      outcome: {
        kind: "releasing",
        progress: "Putting v0.1.57 live · 4m 10s · taking longer than usual",
        clock: "4m 10s · taking longer than usual",
      },
      press: { kind: "done" },
      over: {
        started: { at: secondsAgo(250), by: "you" },
        progress: {
          creation: undefined,
          deploys: [
            deployOf("app", "live", { at: secondsAgo(250), endedAt: secondsAgo(140) }),
            deployOf("api", "building", { at: secondsAgo(250) }),
          ],
        },
      },
    },
  },
  {
    id: "released",
    label: "Released",
    props: {
      outcome: { kind: "released", at: minutesAgo(3) },
      press: { kind: "done" },
      over: {
        ...APP_ALONE,
        servicePlan: CREATION_PLAN,
        started: { at: secondsAgo(422), by: "you" },
        progress: {
          creation: creationOf("created", { at: secondsAgo(422), endedAt: secondsAgo(292) }),
          deploys: [deployOf("app", "live", { at: secondsAgo(292), endedAt: secondsAgo(188) })],
        },
        onRollBack: noop,
        onAddDomain: noop,
      },
    },
  },
  {
    id: "release-failed",
    label: "Release failed · no job says why",
    props: {
      outcome: {
        kind: "failed",
        detail: "The deploy of app failed",
        services: ["app"],
        at: minutesAgo(2),
      },
      press: { kind: "done" },
    },
  },
  {
    id: "release-failed-words",
    label: "Release failed · the platform's words",
    props: {
      outcome: derived57({
        tagged: tagged57({
          standing: "deploy-failed",
          failedEntries: [{ service: "app", commit: SEVEN_E }],
        }),
        jobs: FAILED_JOBS,
      }),
      press: { kind: "done" },
      over: { progress: progressOfJobs(FAILED_JOBS), onReviewNew: noop },
    },
  },
  {
    id: "release-deploy-refused",
    label: "Release · HQ's deploy refused at its one try",
    props: {
      outcome: {
        kind: "failed",
        detail: "The deploy of app failed",
        services: ["app"],
        at: minutesAgo(1),
      },
      press: { kind: "done" },
      over: {
        fixer: undefined,
        onReviewNew: noop,
        progress: {
          creation: undefined,
          deploys: [
            deployOf("app", "refused", {
              reason: "Zerops did not answer: timeout.",
              endedAt: secondsAgo(40),
            }),
          ],
        },
      },
    },
  },
  {
    id: "release-stalled-reason",
    label: "Release stalled · HQ's reason",
    props: {
      outcome: derived57({
        tagged: tagged57(),
        jobs: [],
        stalled: {
          tag: "v0.1.57",
          at: minutesAgo(3),
          reasons: ["api: Zerops refused the deploy token"],
        },
      }),
      press: { kind: "done" },
    },
  },
  {
    id: "release-stalled-unknown",
    label: "Release stalled · HQ couldn't tell",
    props: {
      outcome: derived57({
        tagged: tagged57(),
        jobs: [],
        stalled: { tag: "v0.1.57", at: minutesAgo(3), reasons: [] },
      }),
      press: { kind: "done" },
    },
  },
  {
    id: "release-superseded",
    label: "Release · a newer one was tagged after it",
    props: {
      outcome: { kind: "superseded", by: "v0.1.58", live: "v0.1.58" },
      press: { kind: "done" },
    },
  },
];

export const REVIEW_STATES: ReadonlyArray<{
  readonly id: string;
  readonly label: string;
  readonly node: ReactNode;
  /** Drawn as the change's page rather than on the dialog's stage. */
  readonly page?: true;
}> = [
  {
    id: "page",
    label: "The change's page",
    page: true,
    node: (
      <Change
        frame="page"
        over={{ description: harnessDescription({ after: 0 }) }}
        readout={detail({ commits: commits(19) })}
      />
    ),
  },
  {
    id: "page-pr",
    label: "The change's page, mirrored to GitHub",
    page: true,
    node: (
      <Change
        frame="page"
        over={{
          description: harnessDescription({ after: 0 }),
          pullRequest: {
            number: 14,
            url: "https://github.com/acme/tea-shop/pull/14",
            state: "open",
            checks: "passing",
          },
        }}
        readout={detail({ commits: commits(3) })}
      />
    ),
  },
  {
    id: "page-pr-merged",
    label: "The change's page, merged on GitHub",
    page: true,
    node: (
      <Change
        frame="page"
        over={{
          merged: true,
          mergedAt: minutesAgo(2),
          state: "closed",
          pullRequest: {
            number: 14,
            url: "https://github.com/acme/tea-shop/pull/14",
            state: "merged",
            checks: "passing",
          },
        }}
        readout={detail({ commits: commits(3) })}
      />
    ),
  },
  {
    id: "page-settle",
    label: "The change's page, its reads landing after 1.5 s",
    page: true,
    node: <Settling after={SETTLE_MS} frame="page" />,
  },
  {
    id: "page-reading",
    label: "The change's page, everything HQ answers still being read",
    page: true,
    node: (
      <Change
        conversation={comments({ kind: "reading" })}
        frame="page"
        readout={READING}
        described={false}
      />
    ),
  },
  {
    id: "page-wide",
    label: "The change's page, a diff with lines wider than its column open",
    page: true,
    node: <Change frame="page" open={["server/index.ts"]} readout={WIDE} />,
  },
  {
    id: "settle",
    label: "Its reads landing after 1.5 s",
    node: <Settling after={SETTLE_MS} frame="dialog" />,
  },
  { id: "ready", label: "A change, ready", node: <Change open={["src/server/index.ts"]} /> },
  {
    id: "core-push",
    label: "HQ brought main in after the change under it merged",
    node: (
      <Change
        landedTitle="Show the order list"
        over={{ corePush: CORE_PUSH, headSha: CORE_MERGE.sha }}
        readout={detail({ commits: [CORE_MERGE, ...commits(3)] })}
      />
    ),
  },
  {
    id: "draft-again",
    label: "A draft again: HQ couldn't check the push in time",
    node: <Change over={{ ready: false, draftReason: "notes_timed_out" }} />,
  },
  {
    id: "description",
    label: "Its description, two pictures in it",
    node: <Change over={{ description: harnessDescription({ after: 0 }) }} />,
  },
  {
    id: "description-slow",
    label: "Its description, its pictures arriving slowly",
    node: <Change over={{ description: harnessDescription({ after: 2_500 }) }} />,
  },
  {
    id: "description-missing",
    label: "Its description, a picture that cannot be read",
    node: <Change over={{ description: harnessDescription({ after: 0, missing: true }) }} />,
  },
  {
    id: "description-unread",
    label: "Its description, none of its pictures readable",
    node: <Change over={{ description: harnessDescription({ after: 120, unreadable: true }) }} />,
  },
  {
    id: "no-words",
    label: "No description",
    node: <Change described={false} />,
  },
  {
    id: "reading",
    label: "Everything HQ answers, still being read",
    node: (
      <Change conversation={comments({ kind: "reading" })} readout={READING} described={false} />
    ),
  },
  {
    id: "unread",
    label: "Nothing HQ answers could be read",
    node: (
      <Change
        conversation={comments({ kind: "failed", reason: "HQ is not answering right now." })}
        readout={UNREAD}
      />
    ),
  },
  {
    // Kara's #2: HQ held no record of its files or commits at its head.
    id: "not-recorded",
    label: "Files and commits HQ has not recorded",
    node: (
      <Change
        readout={{
          kind: "read",
          value: changeReadoutOfRecord(
            { ...CHANGE, mergeability: "clean", behind: false },
            {
              mergeBase: BASE,
              files: null,
              filesTruncated: false,
              conflictPaths: [],
              commits: null,
              commitsTruncated: false,
            },
          ),
        }}
      />
    ),
  },
  {
    id: "many-commits",
    label: "Nineteen commits, the newest five shown",
    node: <Change readout={detail({ commits: commits(19) })} />,
  },
  {
    id: "long-conversation",
    label: "A long conversation, its newest three shown",
    node: <Change conversation={comments({ kind: "read", comments: LONG_TALK })} />,
  },
  {
    id: "long",
    label: "A diff too long for here",
    node: (
      <Change open={["pnpm-lock.yaml", "src/server/index.ts", "src/web/app.tsx"]} readout={LONG} />
    ),
  },
  {
    id: "wide",
    label: "A diff with lines wider than the review",
    node: <Change open={["server/index.ts"]} readout={WIDE} />,
  },
  {
    id: "behind-clean",
    label: "Behind main, still merges",
    node: <Change readout={detail({ behind: true })} />,
  },
  {
    id: "conflict",
    label: "A change, blocked: a conflict",
    node: (
      <Change
        readout={detail({
          behind: true,
          mergeability: "conflict",
          conflictPaths: ["src/server/index.ts"],
        })}
      />
    ),
  },
  {
    id: "behind",
    label: "Behind main, no longer merges",
    node: <Change readout={detail({ behind: true, mergeability: "conflict" })} />,
  },
  {
    id: "empty",
    label: "Nothing in it main does not have",
    node: <Change readout={detail({ mergeability: "empty" })} />,
  },
  {
    id: "not-offered",
    label: "Ready, to a person HQ's rule offers neither Merge nor Close",
    node: <Change offers={{ ...DEVELOPS, merge: false, close: false }} />,
  },
  {
    id: "merge-limited",
    label: "Ready, to a person the project's merge limit holds: who merges, by name",
    node: <Change offers={mergeHeld(2)} />,
  },
  {
    id: "merge-limited-many",
    label: "Merge held by the limit, five people named: the first three and how many more",
    node: <Change offers={mergeHeld(5)} />,
  },
  {
    id: "merge-limited-nobody",
    label: "Merge held by the limit, nobody named: the organization's Owner and Admins",
    node: <Change offers={mergeHeld(0)} />,
  },
  { id: "merging", label: "Merging", node: <Change press={{ kind: "running" }} /> },
  {
    id: "merged-on-github",
    label: "Merged on GitHub, main not there yet (Merge still being answered)",
    node: (
      <Change
        over={{
          pullRequest: {
            number: 14,
            url: "https://github.com/acme/tea-shop/pull/14",
            state: "merged",
            checks: "passing",
          },
        }}
        press={{ kind: "running" }}
      />
    ),
  },
  {
    id: "refused",
    label: "Not merged: HQ refused it",
    node: (
      <Change
        press={{
          kind: "refused",
          reason: "Its Mate pushed to it since you opened it. Review it again.",
        }}
      />
    ),
  },
  {
    id: "refused-too-large",
    label: "Not merged: a file above HQ's merge limit, said for the person's Mate",
    node: (
      <Change
        press={{
          kind: "refused",
          reason: mergeTooLargeWords(16 * 1024 * 1024, 24 * 1024 * 1024),
          code: MERGE_TOO_LARGE,
        }}
      />
    ),
  },
  { id: "merged-now", label: "After Merge", node: <Change press={{ kind: "done" }} /> },
  { id: "merged", label: "Merged", node: <Change over={MERGED_NOW} /> },
  {
    id: "ready-no-production",
    label: "Ready, in a project with no production",
    node: <Change environments={NO_ENVIRONMENTS} />,
  },
  {
    id: "follows-main",
    label: "Ready, where production is deployed outside Mate and follows main: merging goes live",
    node: <Change environments={NO_ENVIRONMENTS} followsMain />,
  },
  {
    id: "follows-main-stage",
    label: "Ready, production follows main and a stage deploys merges",
    node: <Change environments={[{ tier: "stage" }]} followsMain />,
  },
  {
    id: "follows-main-merged",
    label: "Merged, where production follows main: nothing waits for a release",
    node: <Change environments={NO_ENVIRONMENTS} followsMain over={MERGED_NOW} />,
  },
  {
    id: "merged-outside",
    label: "Merged outside Mate",
    node: <Change over={{ ...MERGED_NOW, landedOutside: true }} />,
  },
  {
    id: "first-merge-both",
    label: "The first code merge, no environment yet: where should it run? (stage and production)",
    node: (
      <Change
        addable={{ stage: true, production: true }}
        environments={NO_ENVIRONMENTS}
        over={{ ...MERGED_NOW, firstCodeMerge: true }}
        press={{ kind: "done" }}
      />
    ),
  },
  {
    id: "first-merge-production",
    label: "The first code merge, a stage exists: where should it run? (production only)",
    node: (
      <Change
        addable={{ stage: false, production: true }}
        environments={[{ tier: "stage" }]}
        over={{ ...MERGED_NOW, firstCodeMerge: true }}
        press={{ kind: "done" }}
      />
    ),
  },
  {
    id: "first-merge-stage",
    label: "The first code merge, a production exists: where should it run? (stage only)",
    node: (
      <Change
        addable={{ stage: true, production: false }}
        environments={[{ tier: "production" }]}
        over={{ ...MERGED_NOW, firstCodeMerge: true }}
        press={{ kind: "done" }}
      />
    ),
  },
  {
    id: "merged-no-question",
    label: "A later merge, no production: the plain merged review, no question",
    node: (
      <Change
        addable={{ stage: true, production: true }}
        environments={NO_ENVIRONMENTS}
        over={{ ...MERGED_NOW, firstCodeMerge: false }}
        press={{ kind: "done" }}
      />
    ),
  },
  {
    id: "close-asked",
    label: "Close without merging, asked",
    node: <Change closing={{ kind: "asked" }} />,
  },
  { id: "closing", label: "Closing", node: <Change closing={{ kind: "running" }} /> },
  {
    id: "close-refused",
    label: "Not closed: HQ refused it",
    node: (
      <Change closing={{ kind: "refused", reason: "This change is merged or closed already." }} />
    ),
  },
  {
    id: "closed-now",
    label: "Closed without merging, by this press",
    node: <Change closing={{ kind: "done" }} />,
  },
  {
    id: "closed",
    label: "Closed without merging",
    node: <Change over={{ state: "closed", merged: false }} />,
  },
  {
    id: "landed-with",
    label: "Merged as part of another change, which was built on it and merged first",
    node: <Change over={{ state: "closed", merged: false, landedWith: 38 }} />,
  },
  {
    id: "mate-gone",
    label: "Its Mate gone: Close, or Hand to another Mate",
    node: <Change over={{ mateGone: true }} mate={GONE} heirs={HEIRS} />,
  },
  {
    id: "mate-gone-handing",
    label: "Its Mate gone: being handed to another Mate",
    node: (
      <Change
        over={{ mateGone: true }}
        mate={GONE}
        heirs={HEIRS}
        hand={{ kind: "running", to: "p-juno" }}
      />
    ),
  },
  {
    id: "recipe",
    label: "A setup change, ready: a service added to setups nothing is made from",
    node: (
      <Change
        conversation={comments({ kind: "read", comments: [] })}
        open={[`${UNUSED_TIERS[0]}/import.yaml`]}
        over={RECIPE}
        readout={recipeRead(UNUSED_TIERS)}
        described={false}
      />
    ),
  },
  {
    id: "recipe-merged-unused",
    label: "A setup change merged, to setups nothing is made from: no release",
    node: (
      <Change
        conversation={comments({ kind: "read", comments: [] })}
        over={{ ...RECIPE, ...MERGED_NOW }}
        readout={recipeRead(UNUSED_TIERS)}
        described={false}
      />
    ),
  },
  {
    id: "recipe-merged",
    label: "A setup change merged: the stage and production get what it adds",
    node: (
      <Change
        conversation={comments({ kind: "read", comments: [] })}
        over={{
          ...RECIPE,
          ...MERGED_NOW,
          title: "Add a mail service to the stage and production setups",
        }}
        readout={recipeRead(MADE_FROM_TIERS)}
        described={false}
      />
    ),
  },
  {
    id: "recipe-merged-none",
    label: "A setup change merged, in a project with no stage or production yet",
    node: (
      <Change
        conversation={comments({ kind: "read", comments: [] })}
        environments={NO_ENVIRONMENTS}
        over={{
          ...RECIPE,
          ...MERGED_NOW,
          title: "Add a mail service to the stage and production setups",
        }}
        readout={recipeRead(MADE_FROM_TIERS)}
        described={false}
      />
    ),
  },
  {
    id: "rollback-deploy-answer",
    label: "Roll back · queued deploy",
    node: (
      <Rollback
        press={{ kind: "done", deploys: QUEUED_ANSWER }}
        outcome={{ kind: "releasing" }}
        untold={["app"]}
      />
    ),
  },
  {
    id: "merged-deploy-answer",
    label: "Merged · stage building, production skipped",
    node: <Change press={{ kind: "done", deploys: QUEUED_ANSWER }} />,
  },
  {
    id: "recipe-deploy-answer",
    label: "Setup merged · services being added",
    node: (
      <Change
        over={{ ...RECIPE, ...MERGED_NOW }}
        readout={recipeRead(MADE_FROM_TIERS)}
        press={{
          kind: "done",
          deploys: {
            jobs: [
              {
                ...DEPLOY_ANSWER.jobs[0]!,
                environment: "stage",
                kind: "delta",
                service: null,
                sha: null,
              },
            ],
            note: null,
          },
        }}
      />
    ),
  },
  ...RELEASE_SHEETS.map((sheet) => ({
    id: sheet.id,
    label: sheet.label,
    node:
      sheet.id === "release-reading-project" ? (
        <ReleaseReadingView name="Beviro" onClose={noop} titleId="release-reading-project" />
      ) : (
        <Release {...sheet.props} />
      ),
  })),
  { id: "rollback", label: "Roll back", node: <Rollback /> },
  {
    id: "rollback-comparing",
    label: "Roll back, HQ comparing",
    node: <Rollback comingBack={{ state: "reading" }} leaving={{ state: "reading" }} />,
  },
  {
    id: "rollback-uncompared",
    label: "Roll back, HQ could not compare",
    node: (
      <Rollback
        comingBack={{ state: "failed", reason: "HQ has no such commit." }}
        leaving={{ state: "failed", reason: "HQ has no such commit." }}
        untold={["web"]}
      />
    ),
  },
  { id: "crew-ready", label: "Crew task, ready to land", node: <Crew /> },
  {
    id: "crew-conflict",
    label: "Crew task, conflicts",
    node: <Crew conflicts={["src/components/CameraRig.tsx"]} />,
  },
];

/** One state as the change's own page: its bar and its column, a window's height. */
export function ReviewPageStage({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2" data-review-harness-state={label}>
      <span className="px-2 text-xs font-medium text-muted-foreground">{label}</span>
      <div className="h-dvh overflow-hidden rounded-xl border border-border">
        <ZeropsHostedFrame
          breadcrumb={
            <WorkspaceBreadcrumb ariaLabel="Zerops breadcrumb" className="min-w-0">
              <WorkspaceBreadcrumbItem>Projects</WorkspaceBreadcrumbItem>
              <WorkspaceBreadcrumbSeparator />
              <WorkspaceBreadcrumbItem>Snap</WorkspaceBreadcrumbItem>
            </WorkspaceBreadcrumb>
          }
          width="column"
        >
          {children}
        </ZeropsHostedFrame>
      </div>
    </section>
  );
}

/** One state on the plan's dimmed stage, the review as it stands in the dialog. */
export function ReviewStage({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2" data-review-harness-state={label}>
      <span className="px-2 text-xs font-medium text-muted-foreground">{label}</span>
      <div
        className="flex justify-center rounded-xl px-5 py-9"
        style={{ background: "color-mix(in oklab, var(--background), var(--color-black) 18%)" }}
      >
        <div className="rv" style={{ maxHeight: "none", width: 540 }}>
          {children}
        </div>
      </div>
    </section>
  );
}

/** How long the dialog's change takes to read its files, as a quick HQ answers. */
const TRY_READ_MS = 600;

/**
 * The real dialog, opened from a button, to try its motion, its focus and its keys — its files
 * arriving a moment after it opens, as they do from HQ.
 */
export function ReviewDialogTry({
  openAtStart = false,
  state,
}: {
  readonly openAtStart?: boolean;
  /** One of `REVIEW_STATES` to stand in the dialog's frame in place of the change read late. */
  readonly state?: string | undefined;
}) {
  const [from, setFrom] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(openAtStart);
  const stood = REVIEW_STATES.find((entry) => entry.id === state)?.node;
  const [read, setRead] = useState(false);
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      setRead(true);
    }, TRY_READ_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [open]);
  return (
    <div className="flex gap-3 px-2">
      <Button
        data-review-harness-open="ready"
        onClick={(event) => {
          setFrom(event.currentTarget);
          setRead(false);
          setOpen(true);
        }}
        variant="secondary"
      >
        Open the review as a dialog
      </Button>
      <ZeropsReviewDialog
        from={from}
        labelledBy="review-try-title"
        onClosed={noop}
        onOpenChange={setOpen}
        open={open}
      >
        {stood !== undefined ? (
          stood
        ) : (
          <ChangeReviewView
            closing={OPEN}
            comments={read ? TALKING : comments({ kind: "reading" })}
            environments={STAGE_AND_PRODUCTION}
            hqAddress={HARNESS_HQ}
            live="v0.1.0"
            mate={NOVA}
            now={NOW}
            onAsk={async () => {}}
            onOpenPage={() => {
              setOpen(false);
            }}
            previews={PREVIEWS}
            project="Beviro"
            stages={["stage"]}
            remarks={read ? remarksOf(TALKING) : []}
            onClose={() => {
              setOpen(false);
            }}
            onFix={noop}
            onOpenRun={noop}
            onClosing={noop}
            onMerge={noop}
            offers={DEVELOPS}
            pictures={HARNESS_PICTURES}
            press={IDLE}
            pull={pull({
              description: harnessDescription({ after: TRY_READ_MS }),
              pipeline: {
                head: HEAD,
                requirements: "known",
                checks: [
                  { id: "unit", name: "Unit tests", requirement: "required", state: "passed" },
                  { id: "lint", name: "Lint", requirement: "advisory", state: "passed" },
                ],
              },
            })}
            readout={read ? READ : READING}
            titleId="review-try-title"
            waitingForProduction={0}
            release={{ allowed: true }}
          />
        )}
      </ZeropsReviewDialog>
    </div>
  );
}

/** The changes the harness's release carries, as each one's review reads it. */
const RELEASED: Readonly<Record<number, Partial<FlowPullRequest>>> = {
  54: {
    number: 54,
    title: "Performance tuning across the storefront and backend",
    merged: true,
    mergedAt: minutesAgo(60 * 26),
    updatedAt: minutesAgo(60 * 26),
  },
  55: {
    number: 55,
    title: "Clearer copy on the admin sign-in",
    merged: true,
    mergedAt: minutesAgo(90),
    updatedAt: minutesAgo(90),
  },
};

/**
 * One release from reading to its end, as a person lives it: the reads land, the press, HQ creating
 * what production lacks, the deploy, and live — or stopped at the creation (`fails`), or with
 * nothing to create (`plain`). Where the sheet ends and where its buttons stand across all of it
 * is measured here.
 */
function useReleaseJourney(kind: "creates" | "fails" | "plain"): ReleaseSheet["props"] & {
  readonly onRelease: () => void;
} {
  const [stage, setStage] = useState<"reading" | "ready" | "creating" | "deploying" | "ended">(
    "reading",
  );
  useEffect(() => {
    const next =
      stage === "reading"
        ? (["ready", 750] as const)
        : stage === "creating"
          ? ([kind === "fails" ? "ended" : "deploying", 2_000] as const)
          : stage === "deploying"
            ? (["ended", 2_000] as const)
            : undefined;
    if (next === undefined) return;
    const timer = setTimeout(() => setStage(next[0]), next[1]);
    return () => clearTimeout(timer);
  }, [kind, stage]);
  const sheet = (id: string) => RELEASE_SHEETS.find((entry) => entry.id === id)!.props;
  // With nothing to create the same sheets stand without their creation: its plan only deploys.
  const plain = (props: ReleaseSheet["props"]): ReleaseSheet["props"] =>
    kind !== "plain"
      ? props
      : {
          ...props,
          over: {
            ...props.over,
            servicePlan: DEPLOY_PLAN,
            ...(props.over?.progress === undefined
              ? {}
              : { progress: { ...props.over.progress, creation: undefined } }),
          },
        };
  const props =
    stage === "reading"
      ? { over: { ...APP_ALONE, ...sheet("release-reading").over } }
      : stage === "ready"
        ? plain(sheet("release-create"))
        : stage === "creating"
          ? plain(sheet("release-create-running"))
          : stage === "deploying"
            ? plain(sheet("release-running-steps"))
            : plain(sheet(kind === "fails" ? "release-create-failed" : "released"));
  return {
    ...props,
    onRelease: () => setStage(kind === "plain" ? "deploying" : "creating"),
  };
}

const PLAY = new URLSearchParams(location.search);
/** `&at=<seconds>`: the wait held at that moment, for a still look. */
const PLAY_AT = { "0": "started", "4": "working", "20": "late", "45": "expired" } as const;

/**
 * The wait for HQ's plan, lived through time (`?release=reading-play`): its words at once, after
 * 4 s and after 20 s, and the wait over at 45 s, on the review's own clock. `&services=1` is a
 * release of one service (three otherwise); `&lands=<seconds>` has the plan answer then,
 * `&creates` with a service to create first; `&fails=<seconds>` has HQ answer that it could not.
 * Try again starts the wait, and the answer's time, anew. `&at=0|4|20|45|landed` holds one moment.
 */
function useReadingPlay(on: boolean): ReleaseSheet["props"] {
  const one = PLAY.get("services") === "1";
  const lands = PLAY.get("lands");
  const fails = PLAY.get("fails");
  const at = PLAY.get("at");
  const [round, setRound] = useState(0);
  const [answer, setAnswer] = useState<{
    readonly of: number;
    readonly kind: "plan" | "failure";
  }>();
  const answered = answer?.of === round ? answer.kind : undefined;
  useEffect(() => {
    if (!on || at !== null) return;
    const timers = [
      ...(lands === null
        ? []
        : [setTimeout(() => setAnswer({ of: round, kind: "plan" }), Number(lands) * 1000)]),
      ...(fails === null
        ? []
        : [setTimeout(() => setAnswer({ of: round, kind: "failure" }), Number(fails) * 1000)]),
    ];
    return () => timers.forEach(clearTimeout);
  }, [at, fails, lands, on, round]);
  const wait = useReleasePlanWait(on && at === null && answered === undefined);
  const again = () => {
    setRound((before) => before + 1);
    wait.restart();
  };
  const stage =
    at === "landed" || answered === "plan"
      ? "landed"
      : at !== null && at in PLAY_AT
        ? PLAY_AT[at as keyof typeof PLAY_AT]
        : wait.stage;
  const base = one ? { ...APP_ALONE, listed: ["app"] } : THREE;
  if (stage === "landed") {
    const plan = one ? DEPLOY_PLAN : THREE_PLAN;
    return {
      over: {
        ...base,
        servicePlan: PLAY.has("creates")
          ? { ...plan, operations: [CREATE_DB, ...plan.operations] }
          : plan,
        creation: NO_CREATION,
      },
    };
  }
  const failure =
    answered === "failure" ? UNREAD.reason : stage === "expired" ? NO_ANSWER_IN_TIME : undefined;
  return failure === undefined && stage !== "expired"
    ? {
        over: {
          ...base,
          servicePlanPending: true,
          servicePlanWait: stage,
          onRetryServicePlan: again,
        },
      }
    : {
        over: {
          ...base,
          gate: { allowed: false, reason: failure ?? NO_ANSWER_IN_TIME },
          servicePlanFailure: failure ?? NO_ANSWER_IN_TIME,
          onRetryServicePlan: again,
        },
      };
}

/** The harness's release and the change a row steps into. */
function ReleaseTrySteps({
  onClose,
  state,
}: {
  readonly onClose: () => void;
  /** A sheet's id (`RELEASE_SHEETS`), or a journey (`useReleaseJourney`): reading to its end. */
  readonly state: string;
}) {
  const steps = useReleaseSteps();
  const onChange = steps.step.view === "change";
  const shown = steps.shown;
  const journey = useReleaseJourney(
    state === "journey-fails" ? "fails" : state === "journey-plain" ? "plain" : "creates",
  );
  const onJourney = state.startsWith("journey");
  const play = useReadingPlay(state === "reading-play");
  const found = RELEASE_SHEETS.find((entry) => entry.id === state);
  const { onRelease, ...lived } = journey;
  const sheet: ReleaseSheet["props"] = onJourney
    ? lived
    : state === "reading-play"
      ? play
      : found === undefined
        ? {}
        : found.props;
  const titleId = onChange ? undefined : "release-try-title";
  return (
    <ZeropsReleaseSteps
      change={
        shown === undefined ? null : (
          <ChangeReviewView
            closing={OPEN}
            comments={TALKING}
            environments={STAGE_AND_PRODUCTION}
            hqAddress={HARNESS_HQ}
            live="v0.1.56"
            mate={NOVA}
            now={NOW}
            onAsk={async () => {}}
            back={{ label: "Release", onPress: steps.back }}
            onClose={onClose}
            onFix={noop}
            onOpenPage={onClose}
            onOpenRun={noop}
            project="Beviro"
            onClosing={noop}
            onMerge={noop}
            offers={DEVELOPS}
            pictures={HARNESS_PICTURES}
            press={IDLE}
            pull={pull({
              ...RELEASED[shown.number],
              description: harnessDescription({ after: 0 }),
            })}
            readout={READ}
            remarks={remarksOf(TALKING)}
            titleId={onChange ? "release-try-title" : undefined}
            waitingForProduction={2}
            release={{ allowed: true }}
          />
        )
      }
      release={
        state === "release-reading-project" ? (
          <ReleaseReadingView name="Beviro" onClose={onClose} titleId="release-try-title" />
        ) : (
          <Release
            onClose={onClose}
            onOpenChange={steps.open}
            titleId={titleId}
            {...sheet}
            over={onJourney ? { ...sheet.over, onRelease } : sheet.over}
          />
        )
      }
      steps={steps}
    />
  );
}

/**
 * The release's dialog, opened from a button, in its real frame: to step into a change it carries
 * and back — the slide, the focus and Esc twice — and to stand in any state of it.
 * `?release=<id>` opens it in that state as the page loads (`RELEASE_SHEETS`; `open` is the plain
 * one), `?release=journey` runs one from reading to live, `journey-fails` to a failed creation,
 * `journey-plain` one that creates nothing, `reading-play` the wait for HQ's plan through time
 * (`useReadingPlay`).
 */
export function ReleaseDialogTry({
  openAtStart,
  state = "release",
}: {
  readonly openAtStart: boolean;
  readonly state?: string | undefined;
}) {
  const [from, setFrom] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(openAtStart);
  const close = () => {
    setOpen(false);
  };
  return (
    <div className="flex gap-3 px-2">
      <Button
        data-review-harness-open="release"
        onClick={(event) => {
          setFrom(event.currentTarget);
          setOpen(true);
        }}
        variant="secondary"
      >
        Open the release as a dialog
      </Button>
      <ZeropsReviewDialog
        from={from}
        labelledBy="release-try-title"
        onClosed={noop}
        onOpenChange={setOpen}
        open={open}
      >
        <ReleaseTrySteps onClose={close} state={state} />
      </ZeropsReviewDialog>
    </div>
  );
}

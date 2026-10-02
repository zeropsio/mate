/**
 * The review in every state it reaches (pass 16, R1–R8), for `design-change.html`: the views
 * the app runs, with made-up reads. Fixtures only — no route imports this module.
 */
import {
  changeRemarks,
  parseChangeDiff,
  type FlowPullRequest,
  type GiteaChangedFile,
  type GiteaCommit,
  type GiteaIssueComment,
  type ReviewPress,
} from "@t3tools/client-runtime/zerops";
import type { CrewTask } from "@t3tools/contracts";
import { useEffect, useState, type ReactNode } from "react";

import {
  ChangeReviewView,
  type ChangeReviewViewProps,
} from "~/components/zerops/review/ZeropsChangeReview";
import { CrewTaskReviewView } from "~/components/zerops/review/ZeropsCrewTaskReview";
import {
  ReleaseReviewView,
  RollbackReviewView,
} from "~/components/zerops/review/ZeropsReleaseReview";
import { useReleaseSteps, ZeropsReleaseSteps } from "~/components/zerops/review/ZeropsReleaseSteps";
import { ZeropsReviewDialog } from "~/components/zerops/review/ZeropsReviewDialog";
import { ZeropsHostedFrame } from "~/components/zerops/landing/ZeropsHostedFrame";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "~/components/WorkspaceBreadcrumb";
import type {
  ZeropsChangeComments,
  ZeropsChangeCommentsState,
} from "~/zerops/useZeropsChangeComments";

import { HARNESS_GITEA, HARNESS_PICTURES, harnessDescription } from "./reviewHarnessPictures";

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

const FILES: ReadonlyArray<GiteaChangedFile> = [
  {
    filename: "src/server/routes/status.ts",
    previousFilename: undefined,
    status: "added",
    additions: 38,
    deletions: 0,
  },
  {
    filename: "src/server/index.ts",
    previousFilename: undefined,
    status: "modified",
    additions: 3,
    deletions: 2,
  },
  {
    filename: ".nvmrc",
    previousFilename: undefined,
    status: "modified",
    additions: 1,
    deletions: 1,
  },
];

const WORDS =
  "Adds a /status route that lists the app's uptime and its last deploy, refreshed on each visit. It stays behind the sign-in, like the rest of the admin pages.";

function pull(over: Partial<FlowPullRequest> = {}): FlowPullRequest {
  return {
    repository: "appdev",
    number: 2,
    title: "Add a /status page with the uptime and the last deploy",
    kind: "code",
    mateProjectId: "p-nova",
    author: "mate-p-nova",
    url: "https://gitea.example/snap/appdev/pulls/2",
    checks: "passing",
    checkWord: "Passing",
    mergeability: "mergeable",
    merged: false,
    mergedAt: undefined,
    headSha: "b21d904cb21d904cb21d904cb21d904cb21d904c",
    baseBranch: "main",
    line: "appdev #2",
    updatedAt: minutesAgo(4),
    headBranch: "mate/mate-p-nova",
    checkRows: [
      { name: "build", tone: "ok", word: "Passed", description: "pnpm build · 34s" },
      { name: "/status", tone: "ok", word: "Passed", description: "checked in the browser" },
    ],
    additions: 42,
    deletions: 3,
    changedFiles: 3,
    mergeBase: "base-sha",
    baseSha: "base-sha",
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

function commits(count: number): ReadonlyArray<GiteaCommit> {
  return COMMIT_SUBJECTS.slice(0, count).map((subject, index) => ({
    sha: `${(0xb21d904 + index * 7919).toString(16)}${"c".repeat(33)}`,
    subject,
    at: minutesAgo(4 + index * 95),
  }));
}

const READ = {
  files: { kind: "read", value: FILES },
  diff: { kind: "read", value: { files: parseChangeDiff(DIFF), cut: false } },
  commits: { kind: "read", value: commits(3) },
  mainSince: { kind: "none" },
} as const;

function said(id: number, author: string, body: string, minutes: number): GiteaIssueComment {
  return { id, author, avatarUrl: undefined, body, at: minutesAgo(minutes) };
}

const TALK: ReadonlyArray<GiteaIssueComment> = [
  said(
    1,
    "ales",
    "Does the page still load when the database is down? That is when I'd open it.",
    95,
  ),
  said(
    2,
    "mate-p-nova",
    "It does now: the uptime and the version come from the process, and the requests card says it could not read them.",
    41,
  ),
];

/** A long thread, as a change that went back and forth gathers. */
const LONG_TALK: ReadonlyArray<GiteaIssueComment> = Array.from({ length: 9 }, (_, index) =>
  index % 2 === 0
    ? said(
        index + 1,
        "ales",
        `Round ${String(index / 2 + 1)}: the cards still jump on a phone.`,
        400 - index * 40,
      )
    : said(index + 1, "mate-p-nova", "Fixed, and checked on a 390 px screen.", 390 - index * 40),
);

function comments(state: ZeropsChangeCommentsState): ZeropsChangeComments {
  return { state, say: async () => null, saying: false, retry: noop };
}

const MATE_NAMES = new Map([["p-nova", "Nova"]]);

function remarksOf(conversation: ZeropsChangeComments) {
  return conversation.state.kind === "read"
    ? changeRemarks({ comments: conversation.state.comments, mateNames: MATE_NAMES, me: "ales" })
    : [];
}

const TALKING = comments({ kind: "read", comments: TALK });

const NOVA = { name: "Nova", tint: "slate", mine: true } as const;

const IDLE: ReviewPress = { kind: "idle" };
const NONE_OPEN: ReadonlyArray<string> = [];
const RUN = { words: WORDS, reading: false } as const;
const OFFERED = { kind: "offered" } as const;

/** A change whose diff was too long to read whole: a lockfile first, the read stopping after. */
const LONG_FILES: ReadonlyArray<GiteaChangedFile> = [
  {
    filename: "pnpm-lock.yaml",
    previousFilename: undefined,
    status: "modified",
    additions: 2_600,
    deletions: 0,
  },
  {
    filename: "src/server/index.ts",
    previousFilename: undefined,
    status: "modified",
    additions: 3,
    deletions: 2,
  },
  {
    filename: "src/web/app.tsx",
    previousFilename: undefined,
    status: "modified",
    additions: 12,
    deletions: 4,
  },
];
const LONG_DIFF = [
  "diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml",
  "--- a/pnpm-lock.yaml",
  "+++ b/pnpm-lock.yaml",
  "@@ -1,0 +1,2600 @@",
  ...Array.from({ length: 2_600 }, (_, index) => `+  /pkg-${String(index)}@1.0.0: {}`),
  "diff --git a/src/server/index.ts b/src/server/index.ts",
  "--- a/src/server/index.ts",
  "+++ b/src/server/index.ts",
  '@@ -10,7 +10,8 @@ import { web } from "./routes/web";',
  ' import { health } from "./routes/health";',
  '+import { status } from "./routes/status";',
  " ",
  " const app = new Hono();",
  ' app.route("/he',
].join("\n");
const LONG = {
  files: { kind: "read", value: LONG_FILES },
  diff: {
    kind: "read",
    value: { files: parseChangeDiff(LONG_DIFF, { cut: true }), cut: true },
  },
} as const;

/** A change whose diff holds lines far wider than the review: an import list and an inlined SVG. */
const WIDE_IMPORT = `import { pool, migrate, ensureInbox, boardCols, itemCols, bus, changed, listenForChanges, ${Array.from(
  { length: 24 },
  (_, index) => `columnReader${String(index)}`,
).join(", ")} } from "./db";`;
const WIDE_SVG = `const logo = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="${Array.from(
  { length: 40 },
  (_, index) => `M${String(index)} ${String(index * 2)}L${String(index + 3)} ${String(index)}`,
).join(" ")}"/></svg>';`;
const WIDE_FILES: ReadonlyArray<GiteaChangedFile> = [
  {
    filename: "server/index.ts",
    previousFilename: undefined,
    status: "modified",
    additions: 2,
    deletions: 1,
  },
];
const WIDE = {
  files: { kind: "read", value: WIDE_FILES },
  diff: {
    kind: "read",
    value: {
      files: parseChangeDiff(
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
      ),
      cut: false,
    },
  },
} as const;

/** A project with a stage and a production, as `environments.yaml` declares them. */
const STAGE_AND_PRODUCTION: ChangeReviewViewProps["environments"] = [
  { tier: "stage" },
  { tier: "production" },
];
/** A project that has made nothing from its recipe yet. */
const NO_ENVIRONMENTS: ChangeReviewViewProps["environments"] = [];

/** A change to the group repo's recipe, from a Mate's bot: no checks run on a recipe. */
const RECIPE: Partial<FlowPullRequest> = {
  repository: "group",
  kind: "recipe",
  number: 7,
  title: "Add a mail service to the Remote (CDE) and Local recipes",
  line: "#7",
  url: "https://gitea.example/snap/group/pulls/7",
  checks: "none",
  checkWord: undefined,
  checkRows: [],
  additions: 12,
  deletions: 0,
  changedFiles: 2,
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
        "+    buildFromGit: https://gitea.example/snap/mail",
        "+    zeropsSetup: mail",
        "+    enableSubdomainAccess: true",
      ];
    })
    .join("\n");
}

/** What a recipe change touching `tiers` reads as: each tier's recipe, and its diff. */
function recipeRead(tiers: ReadonlyArray<string>): Partial<ChangeReviewViewProps["readout"]> {
  return {
    files: {
      kind: "read",
      value: tiers.map((tier) => ({
        filename: `${tier}/import.yaml`,
        previousFilename: undefined,
        status: "modified",
        additions: 6,
        deletions: 0,
      })),
    },
    diff: { kind: "read", value: { files: parseChangeDiff(recipeDiff(tiers)), cut: false } },
    commits: {
      kind: "read",
      value: [
        { sha: `7d1e0a4${"d".repeat(33)}`, subject: "Add a mail service", at: minutesAgo(6) },
      ],
    },
  };
}

/** The owner's case: two recipes nothing in the project is made from. */
const UNUSED_TIERS = ["1 — Remote (CDE)", "2 — Local"];
/** The two recipes a stage and a production are made from. */
const MADE_FROM_TIERS = ["3 — Stage", "4 — Small Production"];

/** Everything Gitea answers, still on its way: what the flow knew paints, the rest holds its room. */
const ALL_READING = {
  files: { kind: "reading" },
  commits: { kind: "reading" },
} as const;
const ALL_FAILED = {
  files: { kind: "failed", reason: "Gitea did not answer in time." },
  commits: { kind: "failed", reason: "Gitea did not answer in time." },
} as const;

function Change({
  over,
  mainSince,
  readout,
  press = IDLE,
  open = NONE_OPEN,
  run = RUN,
  conversation = TALKING,
  environments = STAGE_AND_PRODUCTION,
  frame,
}: {
  readonly over?: Partial<FlowPullRequest>;
  readonly mainSince?: ReadonlyArray<GiteaCommit>;
  /** What was read of it, where that is not everything. */
  readonly readout?: Partial<ChangeReviewViewProps["readout"]>;
  readonly press?: ReviewPress;
  readonly open?: ReadonlyArray<string>;
  readonly run?: { readonly words: string | undefined; readonly reading: boolean };
  readonly conversation?: ZeropsChangeComments;
  readonly environments?: ChangeReviewViewProps["environments"];
  readonly frame?: ChangeReviewViewProps["frame"];
}) {
  const value = pull(over);
  return (
    <ChangeReviewView
      comments={conversation}
      environments={environments}
      frame={frame}
      giteaOrigin={HARNESS_GITEA}
      initiallyOpen={open}
      live="v0.1.0"
      mate={value.mateProjectId === undefined ? undefined : NOVA}
      now={NOW}
      onAsk={async () => {}}
      onClose={noop}
      onOpenPage={frame === "page" ? undefined : noop}
      onRetry={noop}
      remarks={remarksOf(conversation)}
      onFix={noop}
      onMerge={noop}
      onOpenRun={run.words === undefined && value.description === undefined ? undefined : noop}
      onReviewRelease={noop}
      pictures={HARNESS_PICTURES}
      press={press}
      pull={value}
      readout={{
        ...READ,
        ...readout,
        mainSince: mainSince === undefined ? READ.mainSince : { kind: "read", value: mainSince },
      }}
      run={run}
      waitingForProduction={0}
    />
  );
}

const RELEASE_ROWS = [
  {
    key: "a1",
    title: "#54 Performance tuning across the storefront and backend",
    change: { repository: "appdev", number: 54 },
    mateProjectId: "p-juno",
    mergedAt: minutesAgo(60 * 26),
    stage: "on-stage" as const,
    face: { tint: "sky" as const },
    sub: "Juno · merged 1 day ago",
  },
  {
    key: "b2",
    title: "#55 Clearer copy on the admin sign-in",
    change: { repository: "appdev", number: 55 },
    mateProjectId: "p-cleo",
    mergedAt: minutesAgo(90),
    stage: "on-stage" as const,
    face: { tint: "sand" as const },
    sub: "Cleo · merged 1 hour ago",
  },
];

const WHERE = [
  { service: "app", line: "redeploys from 3fa9c21" },
  { service: "api", line: "redeploys from 3fa9c21" },
];

function Release({
  outcome = OFFERED,
  press = IDLE,
  titleId,
  onOpenChange,
  onClose = noop,
}: {
  readonly outcome?: Parameters<typeof ReleaseReviewView>[0]["outcome"];
  readonly press?: ReviewPress;
  readonly titleId?: string | undefined;
  readonly onOpenChange?: Parameters<typeof ReleaseReviewView>[0]["onOpenChange"];
  readonly onClose?: () => void;
}) {
  return (
    <ReleaseReviewView
      onOpenChange={onOpenChange}
      titleId={titleId}
      fixer="Juno"
      gate={{ allowed: true }}
      hasStage
      replaces="v0.1.56"
      name="Beviro"
      now={NOW}
      onClose={onClose}
      onFix={noop}
      onRelease={noop}
      outcome={outcome}
      press={press}
      rows={RELEASE_ROWS}
      services={["app", "api"]}
      tag="v0.1.57"
      where={WHERE}
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
 * description's pictures refused at their preflight, as a browser's are today — so the first
 * frame can be set against the settled one.
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
        commentCount: TALK.length,
      }}
      readout={read ? { commits: { kind: "read", value: commits(19) } } : ALL_READING}
    />
  );
}

/** How long a settling review's reads take, as a slow Gitea answers. */
const SETTLE_MS = 1_500;

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
        readout={{ commits: { kind: "read", value: commits(19) } }}
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
    label: "The change's page, everything Gitea answers still being read",
    page: true,
    node: (
      <Change
        conversation={comments({ kind: "reading" })}
        frame="page"
        over={{ commentCount: 2 }}
        readout={ALL_READING}
        run={{ words: undefined, reading: true }}
      />
    ),
  },
  {
    id: "page-wide",
    label: "The change's page, a diff with lines wider than its column open",
    page: true,
    node: (
      <Change
        frame="page"
        open={["server/index.ts"]}
        over={{ additions: 2, deletions: 1, changedFiles: 1 }}
        readout={WIDE}
      />
    ),
  },
  {
    id: "settle",
    label: "Its reads landing after 1.5 s",
    node: <Settling after={SETTLE_MS} frame="dialog" />,
  },
  { id: "ready", label: "A change, ready", node: <Change open={["src/server/index.ts"]} /> },
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
    id: "description-today",
    label: "Its description as a browser reads it today: every picture refused at its preflight",
    node: <Change over={{ description: harnessDescription({ after: 120, unreadable: true }) }} />,
  },
  {
    id: "no-words",
    label: "No description, and the run said nothing of it",
    node: <Change run={{ words: undefined, reading: false }} />,
  },
  {
    id: "reading",
    label: "Everything Gitea answers, still being read",
    node: (
      <Change
        conversation={comments({ kind: "reading" })}
        over={{ commentCount: 2 }}
        readout={ALL_READING}
        run={{ words: undefined, reading: true }}
      />
    ),
  },
  {
    id: "unread",
    label: "Nothing Gitea answers could be read",
    node: (
      <Change
        conversation={comments({ kind: "failed", reason: "Gitea did not answer in time." })}
        readout={ALL_FAILED}
      />
    ),
  },
  {
    id: "many-commits",
    label: "Nineteen commits, the newest five shown",
    node: <Change readout={{ commits: { kind: "read", value: commits(19) } }} />,
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
      <Change
        open={["pnpm-lock.yaml", "src/server/index.ts", "src/web/app.tsx"]}
        over={{ additions: 2_615, deletions: 6 }}
        readout={LONG}
      />
    ),
  },
  {
    id: "wide",
    label: "A diff with lines wider than the review",
    node: (
      <Change
        open={["server/index.ts"]}
        over={{ additions: 2, deletions: 1, changedFiles: 1 }}
        readout={WIDE}
      />
    ),
  },
  {
    id: "unchecked",
    label: "Ready, nothing checked",
    node: (
      <Change
        over={{
          checks: "none",
          checkRows: [],
          mateProjectId: undefined,
          author: "ada",
          headBranch: "ada/status-page",
        }}
      />
    ),
  },
  {
    id: "behind-clean",
    label: "Behind main, still merges",
    node: (
      <Change
        mainSince={[
          { sha: "c1", subject: "Tidy the README (#4)", files: ["README.md"] },
          { sha: "c2", subject: "Health routes (#5)", files: ["src/server/health.ts"] },
        ]}
        over={{ baseSha: "c2" }}
      />
    ),
  },
  {
    id: "conflict",
    label: "A change, blocked: a conflict",
    node: (
      <Change
        mainSince={[
          {
            sha: "c2",
            subject: "Health routes (#5)",
            at: minutesAgo(20),
            files: ["src/server/index.ts"],
          },
        ]}
        over={{ mergeability: "conflicting", baseSha: "c2" }}
      />
    ),
  },
  {
    id: "behind",
    label: "Behind main, no longer merges",
    node: <Change over={{ mergeability: "conflicting", baseSha: "main-now" }} />,
  },
  {
    id: "checks-failed",
    label: "Checks failing",
    node: (
      <Change
        over={{
          checks: "failing",
          checkRows: [
            { name: "build", tone: "failed", word: "Failed", description: "tsc exited 2 · 41s" },
            { name: "lint", tone: "ok", word: "Passed", description: "oxlint · 3s" },
          ],
        }}
      />
    ),
  },
  {
    id: "checks-running",
    label: "Checks running",
    node: (
      <Change
        over={{
          checks: "pending",
          checkRows: [
            { name: "build", tone: "busy", word: "Running", description: "pnpm build" },
            { name: "e2e", tone: "busy", word: "Running", description: "3 of 12 pages" },
          ],
        }}
        run={{ words: undefined, reading: true }}
      />
    ),
  },
  { id: "merging", label: "Merging", node: <Change press={{ kind: "running" }} /> },
  {
    id: "refused",
    label: "Refused",
    node: (
      <Change
        press={{
          kind: "refused",
          reason: "This pull request changed since you opened it — review it again.",
        }}
      />
    ),
  },
  { id: "merged", label: "After Merge", node: <Change press={{ kind: "done" }} /> },
  {
    id: "closed",
    label: "Closed without merging",
    node: <Change over={{ state: "closed", merged: false }} />,
  },
  {
    id: "recipe",
    label: "A recipe change, ready: a service added to recipes nothing is made from",
    node: (
      <Change
        conversation={comments({ kind: "read", comments: [] })}
        open={[`${UNUSED_TIERS[0]}/import.yaml`]}
        over={RECIPE}
        readout={recipeRead(UNUSED_TIERS)}
        run={{ words: undefined, reading: false }}
      />
    ),
  },
  {
    id: "recipe-merged-unused",
    label: "A recipe change after Merge, to recipes nothing is made from: no release",
    node: (
      <Change
        conversation={comments({ kind: "read", comments: [] })}
        over={RECIPE}
        press={{ kind: "done" }}
        readout={recipeRead(UNUSED_TIERS)}
        run={{ words: undefined, reading: false }}
      />
    ),
  },
  {
    id: "recipe-merged",
    label: "A recipe change after Merge: the stage and production get what it adds",
    node: (
      <Change
        conversation={comments({ kind: "read", comments: [] })}
        over={{ ...RECIPE, title: "Add a mail service to the stage and production recipes" }}
        press={{ kind: "done" }}
        readout={recipeRead(MADE_FROM_TIERS)}
        run={{ words: undefined, reading: false }}
      />
    ),
  },
  {
    id: "recipe-merged-none",
    label: "A recipe change after Merge, in a project with no stage or production yet",
    node: (
      <Change
        conversation={comments({ kind: "read", comments: [] })}
        environments={NO_ENVIRONMENTS}
        over={{ ...RECIPE, title: "Add a mail service to the stage and production recipes" }}
        press={{ kind: "done" }}
        readout={recipeRead(MADE_FROM_TIERS)}
        run={{ words: undefined, reading: false }}
      />
    ),
  },
  { id: "release", label: "A release", node: <Release /> },
  {
    id: "releasing",
    label: "Releasing",
    node: (
      <Release
        outcome={{ kind: "releasing", progress: "Production redeploys from v0.1.57 · 1:12" }}
        press={{ kind: "done" }}
      />
    ),
  },
  {
    id: "released",
    label: "Released",
    node: <Release outcome={{ kind: "released", at: minutesAgo(3) }} press={{ kind: "done" }} />,
  },
  {
    id: "release-failed",
    label: "Release failed",
    node: (
      <Release
        outcome={{
          kind: "failed",
          detail: "The deploy of app failed",
          service: "app",
          at: minutesAgo(2),
        }}
        press={{ kind: "done" }}
      />
    ),
  },
  {
    id: "rollback",
    label: "Roll back",
    node: (
      <RollbackReviewView
        line="app 7e1c0d2 · api 7e1c0d2"
        live="v0.1.57"
        mayRelease
        name="Beviro"
        nextTag="v0.1.58"
        now={NOW}
        onClose={noop}
        onRollBack={noop}
        outcome={OFFERED}
        press={IDLE}
        services={["app", "api"]}
        tag="v0.1.55"
        where={[
          { service: "app", line: "goes back to 7e1c0d2" },
          { service: "api", line: "goes back to 7e1c0d2" },
        ]}
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
        <div className="rv" style={{ maxHeight: "none" }}>
          {children}
        </div>
      </div>
    </section>
  );
}

/** How long the dialog's change takes to read its files, as a quick Gitea answers. */
const TRY_READ_MS = 600;

/**
 * The real dialog, opened from a button, to try its motion, its focus and its keys — its files
 * arriving a moment after it opens, as they do from Gitea, so Merge turns pressable then.
 */
export function ReviewDialogTry() {
  const [from, setFrom] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
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
      <button
        className="rv-btn2"
        data-review-harness-open="ready"
        onClick={(event) => {
          setFrom(event.currentTarget);
          setRead(false);
          setOpen(true);
        }}
        type="button"
      >
        Open the review as a dialog
      </button>
      <ZeropsReviewDialog
        from={from}
        labelledBy="review-try-title"
        onClosed={noop}
        onOpenChange={setOpen}
        open={open}
      >
        <ChangeReviewView
          comments={read ? TALKING : comments({ kind: "reading" })}
          environments={STAGE_AND_PRODUCTION}
          giteaOrigin={HARNESS_GITEA}
          live="v0.1.0"
          mate={NOVA}
          now={NOW}
          onAsk={async () => {}}
          onOpenPage={() => {
            setOpen(false);
          }}
          remarks={read ? remarksOf(TALKING) : []}
          onClose={() => {
            setOpen(false);
          }}
          onFix={noop}
          onMerge={noop}
          onOpenRun={noop}
          onReviewRelease={noop}
          pictures={HARNESS_PICTURES}
          press={IDLE}
          pull={pull({
            description: harnessDescription({ after: TRY_READ_MS }),
            commentCount: TALK.length,
          })}
          readout={read ? READ : { ...READ, ...ALL_READING }}
          run={RUN}
          titleId="review-try-title"
          waitingForProduction={0}
        />
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

/** The harness's release and the change a row steps into. */
function ReleaseTrySteps({ onClose }: { readonly onClose: () => void }) {
  const steps = useReleaseSteps();
  const onChange = steps.step.view === "change";
  const shown = steps.shown;
  return (
    <ZeropsReleaseSteps
      change={
        shown === undefined ? null : (
          <ChangeReviewView
            comments={TALKING}
            environments={STAGE_AND_PRODUCTION}
            giteaOrigin={HARNESS_GITEA}
            live="v0.1.56"
            mate={NOVA}
            now={NOW}
            onAsk={async () => {}}
            onBack={steps.back}
            onClose={onClose}
            onFix={noop}
            onMerge={noop}
            onOpenPage={onClose}
            onOpenRun={noop}
            onReviewRelease={noop}
            pictures={HARNESS_PICTURES}
            press={IDLE}
            pull={pull({
              ...RELEASED[shown.number],
              description: harnessDescription({ after: 0 }),
              commentCount: TALK.length,
            })}
            readout={READ}
            remarks={remarksOf(TALKING)}
            run={RUN}
            titleId={onChange ? "release-try-title" : undefined}
            waitingForProduction={2}
          />
        )
      }
      release={
        <Release
          onClose={onClose}
          onOpenChange={steps.open}
          titleId={onChange ? undefined : "release-try-title"}
        />
      }
      steps={steps}
    />
  );
}

/**
 * The release's dialog, opened from a button, to step into a change it carries and back: the
 * slide, the height, the focus and Esc twice. `?release=open` opens it as the page loads.
 */
export function ReleaseDialogTry({ openAtStart }: { readonly openAtStart: boolean }) {
  const [from, setFrom] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(openAtStart);
  const close = () => {
    setOpen(false);
  };
  return (
    <div className="flex gap-3 px-2">
      <button
        className="rv-btn2"
        data-review-harness-open="release"
        onClick={(event) => {
          setFrom(event.currentTarget);
          setOpen(true);
        }}
        type="button"
      >
        Open the release as a dialog
      </button>
      <ZeropsReviewDialog
        from={from}
        labelledBy="release-try-title"
        onClosed={noop}
        onOpenChange={setOpen}
        open={open}
      >
        <ReleaseTrySteps onClose={close} />
      </ZeropsReviewDialog>
    </div>
  );
}

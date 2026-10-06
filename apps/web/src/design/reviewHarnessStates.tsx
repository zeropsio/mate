/**
 * The review in every state it reaches (pass 16, R1–R8), for `design-change.html`: the views
 * the app runs, with made-up reads. Fixtures only — no route imports this module.
 */
import {
  changeReadout,
  changeRemarks,
  releaseVersionField,
  type ChangeReadout,
  type FlowPullRequest,
  type ReviewClose,
  type ReviewPress,
} from "@t3tools/client-runtime/zerops";
import type { HqDeployAnswer } from "@t3tools/shared/hqDeploys";
import type { CrewTask } from "@t3tools/contracts";
import type {
  ChangeCommit,
  ChangeDetailResponse,
  ChangeFile,
  HqChange,
  HqChangeComment,
} from "@t3tools/shared/hqChanges";
import { useEffect, useState, type ReactNode } from "react";

import {
  ChangeReviewView,
  type ChangeReviewViewProps,
} from "~/components/zerops/review/ZeropsChangeReview";
import { CrewTaskReviewView } from "~/components/zerops/review/ZeropsCrewTaskReview";
import {
  ReleaseReviewView,
  RollbackReviewView,
  type RollbackList,
} from "~/components/zerops/review/ZeropsReleaseReview";
import { useReleaseSteps, ZeropsReleaseSteps } from "~/components/zerops/review/ZeropsReleaseSteps";
import { ZeropsReviewDialog } from "~/components/zerops/review/ZeropsReviewDialog";
import { ZeropsHostedFrame } from "~/components/zerops/landing/ZeropsHostedFrame";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "~/components/WorkspaceBreadcrumb";
import type { ChangeDiscussion } from "~/zerops/useChangeDiscussion";
import type { ZeropsChangeOffers } from "~/zerops/useChangeOffers";
import type { ReadoutPart } from "~/zerops/useZeropsChangeDetail";

import { HARNESS_HQ, HARNESS_PICTURES, harnessDescription } from "./reviewHarnessPictures";

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

/**
 * A `git diff` of several files as HQ hands it over: one patch per file, with the lines it adds
 * and deletes. Where HQ's read stopped (`cutAt`), that file's patch is cut, and the ones after it
 * were not read.
 */
function hqFiles(
  diff: string,
  counts: ReadonlyArray<readonly [path: string, added: number, deleted: number]>,
  cutAt?: number,
): ReadonlyArray<ChangeFile> {
  const patches = diff.split(/\n(?=diff --git )/u);
  return counts.map(([path, added, deleted], index) => ({
    path,
    added,
    deleted,
    hunks: cutAt !== undefined && index > cutAt ? "" : (patches[index] ?? ""),
    binary: false,
    truncated: cutAt !== undefined && index >= cutAt,
  }));
}

const FILES = hqFiles(DIFF, [
  ["src/server/routes/status.ts", 38, 0],
  ["src/server/index.ts", 3, 2],
  [".nvmrc", 1, 1],
]);

const WORDS =
  "Adds a /status route that lists the app's uptime and its last deploy, refreshed on each visit. It stays behind the sign-in, like the rest of the admin pages.";

const HEAD = "b21d904cb21d904cb21d904cb21d904cb21d904c";
/** `main` as the change was cut from it, and `main` two changes later. */
const BASE = "ba5e000ba5e000ba5e000ba5e000ba5e000ba5e";
const MAIN_NOW = "c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2";

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
    headBranch: "mate/p-nova/2",
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

/** HQ's detail of the change, `over` it, as its review reads it (`changeReadout`). */
function detail(over: Partial<ChangeDetailResponse> = {}): ReadoutPart<ChangeReadout> {
  return {
    kind: "read",
    value: changeReadout({
      change: CHANGE,
      mainHead: BASE,
      mergeBase: BASE,
      mergeability: { kind: "clean" },
      files: FILES,
      filesTruncated: false,
      commits: commits(3),
      commitsTruncated: false,
      ...over,
    }),
  };
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

const IDLE: ReviewPress = { kind: "idle" };
/** Nobody asked to close it. */
const OPEN: ReviewClose = { kind: "idle" };
/** All HQ's rule offers a developer of the application: comment, Merge, Close. */
const DEVELOPS: ZeropsChangeOffers = {
  read: true,
  comment: true,
  merge: true,
  close: true,
  redeploy: true,
  why: {},
  readRefused: false,
};
/** Merged a minute ago: the review says what happened, and offers the release's review. */
const MERGED_NOW: Partial<FlowPullRequest> = {
  state: "closed",
  merged: true,
  mergedAt: minutesAgo(1),
  updatedAt: minutesAgo(1),
};
const NONE_OPEN: ReadonlyArray<string> = [];
const RUN = { words: WORDS, reading: false } as const;
const OFFERED = { kind: "offered" } as const;

/** A change whose diff was too long to read whole: a lockfile first, the read stopping after. */
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
  title: "Add a mail service to the Remote (CDE) and Local recipes",
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

/** HQ's detail, still on its way: what the flow knew paints, the rest holds its room. */
const READING = { kind: "reading" } as const;
const UNREAD = { kind: "failed", reason: "HQ is not answering right now." } as const;

function Change({
  over,
  readout = READ,
  open = NONE_OPEN,
  run = RUN,
  conversation = TALKING,
  environments = STAGE_AND_PRODUCTION,
  offers = DEVELOPS,
  press = IDLE,
  closing = OPEN,
  frame,
  addable,
}: {
  readonly over?: Partial<FlowPullRequest>;
  /** HQ's detail of it, where it is not the one every state shares. */
  readonly readout?: ChangeReviewViewProps["readout"];
  readonly open?: ReadonlyArray<string>;
  readonly run?: { readonly words: string | undefined; readonly reading: boolean };
  readonly conversation?: ChangeDiscussion;
  readonly environments?: ChangeReviewViewProps["environments"];
  readonly offers?: ChangeReviewViewProps["offers"];
  readonly press?: ReviewPress;
  readonly closing?: ReviewClose;
  readonly frame?: ChangeReviewViewProps["frame"];
  /** The environments the one question after a first merge may offer. */
  readonly addable?: ChangeReviewViewProps["addable"];
}) {
  const value = pull(over);
  return (
    <ChangeReviewView
      addable={addable}
      closing={closing}
      comments={conversation}
      environments={environments}
      onAddEnvironment={noop}
      productionHeld={false}
      frame={frame}
      hqAddress={HARNESS_HQ}
      initiallyOpen={open}
      live="v0.1.0"
      mate={NOVA}
      now={NOW}
      onAsk={async () => {}}
      onClose={noop}
      onOpenPage={frame === "page" ? undefined : noop}
      onRetry={noop}
      remarks={remarksOf(conversation)}
      onFix={noop}
      onClosing={noop}
      onMerge={noop}
      onOpenRun={run.words === undefined && value.description === undefined ? undefined : noop}
      offers={offers}
      pictures={HARNESS_PICTURES}
      press={press}
      pull={value}
      readout={readout}
      run={run}
      waitingForProduction={0}
      release={{ allowed: true }}
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
      where={[
        { service: "app", line: "goes back to 7e1c0d2" },
        { service: "api", line: "goes back to 7e1c0d2" },
      ]}
    />
  );
}

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
  over,
  initialVersion,
}: {
  readonly initialVersion?: string;
  readonly over?: Partial<Parameters<typeof ReleaseReviewView>[0]>;
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
      replaces={{ kind: "release", tag: "v0.1.56" }}
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
        run={{ words: undefined, reading: true }}
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
    label: "No description, and the run said nothing of it",
    node: <Change run={{ words: undefined, reading: false }} />,
  },
  {
    id: "reading",
    label: "Everything HQ answers, still being read",
    node: (
      <Change
        conversation={comments({ kind: "reading" })}
        readout={READING}
        run={{ words: undefined, reading: true }}
      />
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
    node: <Change readout={detail({ mainHead: MAIN_NOW })} />,
  },
  {
    id: "conflict",
    label: "A change, blocked: a conflict",
    node: (
      <Change
        readout={detail({
          mainHead: MAIN_NOW,
          mergeability: { kind: "conflict", paths: ["src/server/index.ts"] },
        })}
      />
    ),
  },
  {
    id: "behind",
    label: "Behind main, no longer merges",
    node: (
      <Change
        readout={detail({ mainHead: MAIN_NOW, mergeability: { kind: "conflict", paths: [] } })}
      />
    ),
  },
  {
    id: "empty",
    label: "Nothing in it main does not have",
    node: <Change readout={detail({ mergeability: { kind: "empty" } })} />,
  },
  {
    id: "not-offered",
    label: "Ready, to a person HQ's rule offers neither Merge nor Close",
    node: <Change offers={{ ...DEVELOPS, merge: false, close: false, redeploy: false }} />,
  },
  { id: "merging", label: "Merging", node: <Change press={{ kind: "running" }} /> },
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
  { id: "merged-now", label: "After Merge", node: <Change press={{ kind: "done" }} /> },
  { id: "merged", label: "Merged", node: <Change over={MERGED_NOW} /> },
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
    label: "A recipe change merged, to recipes nothing is made from: no release",
    node: (
      <Change
        conversation={comments({ kind: "read", comments: [] })}
        over={{ ...RECIPE, ...MERGED_NOW }}
        readout={recipeRead(UNUSED_TIERS)}
        run={{ words: undefined, reading: false }}
      />
    ),
  },
  {
    id: "recipe-merged",
    label: "A recipe change merged: the stage and production get what it adds",
    node: (
      <Change
        conversation={comments({ kind: "read", comments: [] })}
        over={{
          ...RECIPE,
          ...MERGED_NOW,
          title: "Add a mail service to the stage and production recipes",
        }}
        readout={recipeRead(MADE_FROM_TIERS)}
        run={{ words: undefined, reading: false }}
      />
    ),
  },
  {
    id: "recipe-merged-none",
    label: "A recipe change merged, in a project with no stage or production yet",
    node: (
      <Change
        conversation={comments({ kind: "read", comments: [] })}
        environments={NO_ENVIRONMENTS}
        over={{
          ...RECIPE,
          ...MERGED_NOW,
          title: "Add a mail service to the stage and production recipes",
        }}
        readout={recipeRead(MADE_FROM_TIERS)}
        run={{ words: undefined, reading: false }}
      />
    ),
  },
  {
    id: "release-deploy-answer",
    label: "Release · xyz v0.1.2, app building",
    node: (
      <Release
        press={{ kind: "done", deploys: DEPLOY_ANSWER }}
        outcome={{ kind: "releasing", progress: "Production redeploys from v0.1.2 · 0:10" }}
        over={{
          name: "xyz",
          tag: "v0.1.2",
          replaces: { kind: "release", tag: "v0.1.1" },
          services: ["app"],
          untold: ["app"],
          where: [{ service: "app", line: "redeploys from 96e2309" }],
        }}
      />
    ),
  },
  {
    id: "release-deploy-queued",
    label: "Release · multiple environments, queued and skipped",
    node: (
      <Release press={{ kind: "done", deploys: QUEUED_ANSWER }} outcome={{ kind: "releasing" }} />
    ),
  },
  {
    id: "release-deploy-refused",
    label: "Release · deploy refused",
    node: (
      <Release
        press={{
          kind: "done",
          deploys: {
            ...DEPLOY_ANSWER,
            jobs: DEPLOY_ANSWER.jobs.map((job) => ({
              ...job,
              state: "refused",
              processId: null,
              reason: "Zerops did not answer: timeout.",
            })),
          },
        }}
        outcome={{ kind: "releasing" }}
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
    label: "Recipe merged · services being added",
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
  { id: "release", label: "A release", node: <Release /> },
  {
    id: "release-version",
    label: "The person's version, with the code's declaration",
    node: <Release initialVersion="1.0.0" />,
  },
  {
    id: "release-version-invalid",
    label: "A version that already exists",
    node: <Release initialVersion="0.1.56" />,
  },
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
        <div className="rv" style={{ maxHeight: "none" }}>
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
          })}
          readout={read ? READ : READING}
          run={RUN}
          titleId="review-try-title"
          waitingForProduction={0}
          release={{ allowed: true }}
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
            run={RUN}
            titleId={onChange ? "release-try-title" : undefined}
            waitingForProduction={2}
            release={{ allowed: true }}
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

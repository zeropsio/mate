/**
 * The review in every state it reaches (pass 16, R1–R8), for `design-change.html`: the views
 * the app runs, with made-up reads. Fixtures only — no route imports this module.
 */
import {
  parseChangeDiff,
  type FlowPullRequest,
  type GiteaChangedFile,
  type GiteaCommit,
  type ReviewPress,
} from "@t3tools/client-runtime/zerops";
import type { CrewTask } from "@t3tools/contracts";
import { useState, type ReactNode } from "react";

import { ChangeReviewView } from "~/components/zerops/review/ZeropsChangeReview";
import { CrewTaskReviewView } from "~/components/zerops/review/ZeropsCrewTaskReview";
import {
  ReleaseReviewView,
  RollbackReviewView,
} from "~/components/zerops/review/ZeropsReleaseReview";
import { ZeropsReviewDialog } from "~/components/zerops/review/ZeropsReviewDialog";

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
  "Adds a /status route on the server that renders the hostname, the Node version and the server time, updating every second. It's public and shows nothing secret, as you asked.";

function pull(over: Partial<FlowPullRequest> = {}): FlowPullRequest {
  return {
    repository: "appdev",
    number: 2,
    title: "Add a /status page showing hostname, Node version and server time",
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
    createdAt: minutesAgo(30),
    ...over,
  };
}

const READ = {
  files: { kind: "read", value: FILES },
  diff: { kind: "read", value: parseChangeDiff(DIFF) },
  commits: { kind: "read", value: 1 },
  mainSince: { kind: "none" },
} as const;

const NOVA = { name: "Nova", tint: "slate", mine: true } as const;
const ROUTE = {
  service: "appstage",
  port: 3000,
  url: "https://appstage-1a2b-3000.example.app/status",
  host: "appstage-1a2b-3000.example.app/status",
};

const IDLE: ReviewPress = { kind: "idle" };
const NONE_OPEN: ReadonlyArray<string> = [];
const RUN = { words: WORDS, reading: false } as const;
const OFFERED = { kind: "offered" } as const;

function Change({
  over,
  mainSince,
  press = IDLE,
  open = NONE_OPEN,
  run = RUN,
}: {
  readonly over?: Partial<FlowPullRequest>;
  readonly mainSince?: ReadonlyArray<GiteaCommit>;
  readonly press?: ReviewPress;
  readonly open?: ReadonlyArray<string>;
  readonly run?: { readonly words: string | undefined; readonly reading: boolean };
}) {
  const value = pull(over);
  return (
    <ChangeReviewView
      downstream={{ production: true, stage: true }}
      initiallyOpen={open}
      live="v0.1.0"
      mate={value.mateProjectId === undefined ? undefined : NOVA}
      now={NOW}
      onAskChanges={noop}
      onClose={noop}
      onFix={noop}
      onMerge={noop}
      onOpenRun={noop}
      onReviewRelease={noop}
      press={press}
      pull={value}
      readout={{
        ...READ,
        mainSince: mainSince === undefined ? READ.mainSince : { kind: "read", value: mainSince },
      }}
      route={value.merged ? undefined : ROUTE}
      run={run}
      waitingForProduction={0}
    />
  );
}

const RELEASE_ROWS = [
  {
    key: "a1",
    title: "#54 Performance tuning across the storefront and backend",
    mateProjectId: "p-juno",
    mergedAt: minutesAgo(60 * 26),
    stage: "on-stage" as const,
    face: { tint: "sky" as const },
    sub: "Juno · merged 1 day ago",
  },
  {
    key: "b2",
    title: "#55 Clearer copy on the admin sign-in",
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
}: {
  readonly outcome?: Parameters<typeof ReleaseReviewView>[0]["outcome"];
  readonly press?: ReviewPress;
}) {
  return (
    <ReleaseReviewView
      fixer="Juno"
      gate={{ allowed: true }}
      hasStage
      live="v0.1.56"
      name="Beviro"
      now={NOW}
      onClose={noop}
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
      branch="crew/juno"
      conflicts={conflicts}
      face={{ name: "Juno", tint: "sky", face: "idle" }}
      onAsk={noop}
      onClose={noop}
      onLand={noop}
      press={{ kind: "idle" }}
      task={task(over)}
    />
  );
}

export const REVIEW_STATES: ReadonlyArray<{
  readonly id: string;
  readonly label: string;
  readonly node: ReactNode;
}> = [
  { id: "ready", label: "A change, ready", node: <Change open={["src/server/index.ts"]} /> },
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
        over={{ baseSha: "main-now" }}
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
        over={{ mergeability: "conflicting", baseSha: "main-now" }}
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

/** The real dialog, opened from a button, to try its motion, its focus and its keys. */
export function ReviewDialogTry() {
  const [from, setFrom] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <div className="flex gap-3 px-2">
      <button
        className="rv-btn2"
        data-review-harness-open="ready"
        onClick={(event) => {
          setFrom(event.currentTarget);
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
          downstream={{ production: true, stage: true }}
          live="v0.1.0"
          mate={NOVA}
          now={NOW}
          onAskChanges={noop}
          onClose={() => {
            setOpen(false);
          }}
          onFix={noop}
          onMerge={noop}
          onOpenRun={noop}
          onReviewRelease={noop}
          press={IDLE}
          pull={pull()}
          readout={READ}
          route={ROUTE}
          run={RUN}
          titleId="review-try-title"
          waitingForProduction={0}
        />
      </ZeropsReviewDialog>
    </div>
  );
}

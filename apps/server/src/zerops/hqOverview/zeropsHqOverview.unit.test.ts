import {
  ConversationRow,
  CrewSnapshot,
  OrchestrationThreadShell,
  ZeropsAgentAuthSnapshot,
  ZeropsUserId,
} from "@t3tools/contracts";
import { linkFrameBytes, MateOverview, type OverviewIdentity } from "@t3tools/shared/mateLink";
import * as Schema from "effect/Schema";
import { expect, it } from "vite-plus/test";

import { mateOverviewOf } from "./zeropsHqOverview.ts";

const decodeShell = Schema.decodeUnknownSync(OrchestrationThreadShell);
const decodeCrew = Schema.decodeUnknownSync(CrewSnapshot);
const decodeAuth = Schema.decodeUnknownSync(ZeropsAgentAuthSnapshot);
/** Every overview here must be one the link can send: decoded by the contract. */
const decodeOverview = Schema.decodeUnknownSync(MateOverview);
const decodeRow = Schema.decodeUnknownSync(ConversationRow);

/** An engine conversation's row, at rest unless `extra` says otherwise. */
const row = (id: string, extra: object = {}) =>
  decodeRow({
    conversationId: id,
    agent: null,
    revision: { environmentId: "env-1", epoch: 1, seq: 1 },
    state: { kind: "idle" },
    activeRunId: null,
    latestRun: null,
    subject: `Task ${id}`,
    snippet: null,
    at: 1_791_000_000_000,
    askedAt: null,
    ...extra,
  });

const shell = (id: string, extra: object = {}) =>
  decodeShell({
    id,
    projectId: "project-1",
    title: id,
    modelSelection: { instanceId: "claudeAgent", model: "claude-opus-5" },
    runtimeMode: "approval-required",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    session: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...extra,
  });

const IDENTITY: OverviewIdentity = Schema.decodeUnknownSync(MateOverview.fields.identity)({
  environmentId: "env-1",
  serverVersion: "0.11.90",
  update: null,
});
const NO_LOGINS: ZeropsAgentAuthSnapshot = { available: true, agents: [] };

const CREW_OFF_SNAPSHOT: CrewSnapshot = {
  status: "off",
  seq: 0,
  crew: null,
  crewmates: [],
  hosts: [],
  board: { tasks: [] },
  run: null,
  attention: [],
  devHosts: [],
  landedNotDelivered: 0,
  lastError: null,
};

const overviewOf = (
  threads: ReadonlyArray<OrchestrationThreadShell>,
  crew: CrewSnapshot = CREW_OFF_SNAPSHOT,
) => decodeOverview(mateOverviewOf({ identity: IDENTITY, threads, auth: NO_LOGINS, crew }));

/** A crewmate on the wire, its current stint's chat `thread`. */
const crewmate = (
  handle: string,
  kind: "lead" | "writer",
  thread: string | null,
  login: { readonly id: string; readonly agent: string },
) => ({
  handle,
  displayName: handle === "lead" ? "Lead" : "Backend",
  tint: handle === "lead" ? "violet" : "sky",
  kind,
  jobFirstLine: "",
  jobVersion: 1,
  promptVersions: { running: null, current: { brief: 1, job: 1 } },
  login: { ...login, label: "" },
  model: null,
  effort: null,
  readOnly: kind !== "writer",
  host: kind === "writer" ? "appdev" : null,
  currentThreadId: thread,
  stints:
    thread === null
      ? []
      : [
          {
            stint: 1,
            threadId: thread,
            state: "active",
            reason: null,
            lastCompactSummary: null,
            startedAt: "2026-10-02T08:00:00Z",
            retiredAt: null,
          },
        ],
  context: null,
  compactions: 0,
  memory: { entries: 0, unfiled: 0 },
  openTaskId: null,
  queuedTaskIds: [],
  lane:
    kind === "writer"
      ? {
          branch: `crew/${handle}`,
          ahead: 0,
          insertions: 0,
          deletions: 0,
          check: null,
          state: "ready",
          detail: null,
        }
      : null,
  app: kind === "writer" ? { state: "none", port: null, url: null } : null,
});

const task = (id: string, owner: string, state: string) => ({
  id,
  number: 1,
  title: id,
  owner,
  state,
  source: "you",
  createdBy: null,
  createdAt: "2026-10-02T08:00:00Z",
  dependsOn: [],
  fresh: false,
  brief: "",
  doneWhen: "",
  attempts: 0,
  reason: null,
  question: null,
  waitingOn: [],
  diffStat: null,
  report: null,
  check: null,
  review: null,
  landedCommit: null,
  delivered: false,
});

/** An applied crew: the lead on the default Claude login, a writer on a second one. */
const CREW = decodeCrew({
  ...CREW_OFF_SNAPSHOT,
  status: "applied",
  crew: { name: "Shop", briefTitle: "", briefVersion: 1, briefExcerpt: "" },
  crewmates: [
    crewmate("lead", "lead", "crew-lead-1", { id: "claudeAgent", agent: "claude-code" }),
    crewmate("backend", "writer", null, { id: "claudeAgent-work", agent: "claude-code" }),
  ],
  board: { tasks: [task("task-1", "backend", "ready"), task("task-2", "backend", "working")] },
  attention: [
    {
      id: "question:task-2",
      kind: "question",
      handle: "backend",
      taskId: "task-2",
      text: "Which table?",
      paths: [],
      host: null,
      at: "2026-10-02T09:00:00Z",
    },
  ],
});

const RUNNING = {
  session: {
    threadId: "main",
    status: "running",
    providerName: null,
    activeTurnId: "turn-1",
    lastError: null,
    updatedAt: "2026-10-02T10:00:00Z",
  },
  latestTurn: {
    turnId: "turn-1",
    state: "running",
    requestedAt: "2026-10-02T10:00:00Z",
    startedAt: "2026-10-02T10:00:01Z",
    completedAt: null,
    assistantMessageId: null,
  },
};

const engineOverview = (rows: ReadonlyArray<ConversationRow>, maxBytes?: number) =>
  decodeOverview(
    mateOverviewOf(
      {
        identity: { ...IDENTITY, engine: { protocol: 1 } },
        threads: [shell("main")],
        auth: NO_LOGINS,
        crew: CREW_OFF_SNAPSHOT,
        conversations: rows,
      },
      maxBytes,
    ),
  );

// witness: apps/server/src/zerops/hqOverview/zeropsHqOverview.ts | latestUserMessagePreview: previewOf(thread.latestUserMessagePreview?.text), → latestUserMessagePreview: previewOf(thread.latestMessagePreview?.text),
it("HO1: HQ shows a Mate's main chat as the Mate's own menu row does: its session, its latest turn, the person's and the agent's last words, the plan's step and what the running turn is on", () => {
  const main = shell("main", {
    ...RUNNING,
    updatedAt: "2026-10-02T10:00:05Z",
    latestUserMessageAt: "2026-10-02T10:00:00Z",
    latestUserMessagePreview: {
      role: "user",
      text: "Add a login page",
      createdAt: "2026-10-02T10:00:00Z",
    },
    latestMessagePreview: {
      role: "assistant",
      text: "Reading the router",
      createdAt: "2026-10-02T10:00:04Z",
    },
    planProgress: { step: "Wire the form", completedSteps: 1, totalSteps: 3 },
    liveStep: { kind: "thinking", since: "2026-10-02T10:00:04Z" },
    usagePause: null,
  });
  const overview = overviewOf([main, shell("other")]);
  expect(overview.main).toEqual({
    id: "main",
    title: "main",
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    interactionMode: "default",
    backgroundLiveness: null,
    session: { status: "running", lastError: null },
    latestTurn: {
      turnId: "turn-1",
      state: "running",
      requestedAt: "2026-10-02T10:00:00Z",
      startedAt: "2026-10-02T10:00:01Z",
      completedAt: null,
    },
    latestUserMessageAt: "2026-10-02T10:00:00Z",
    updatedAt: "2026-10-02T10:00:05Z",
    latestUserMessagePreview: { text: "Add a login page" },
    latestMessagePreview: { role: "assistant", text: "Reading the router" },
    planProgress: { step: "Wire the form" },
    pendingQuestion: null,
    refusal: null,
    usagePause: null,
    liveStep: { kind: "thinking", since: "2026-10-02T10:00:04Z" },
  });
  expect(overview.identity).toEqual(IDENTITY);
});

// witness: apps/server/src/zerops/hqOverview/zeropsHqOverview.ts | completedAt: thread.latestTurn?.completedAt ?? null, → completedAt: thread.latestTurn?.startedAt ?? null,
it("HO2: A chat the Mate finished a turn in reads idle to HQ, never done or woke, with the turn's completion beside it; a chat that asks, runs or broke reads approval, working or failed", () => {
  const completed = {
    turnId: "turn-9",
    state: "completed",
    requestedAt: "2026-10-02T09:00:00Z",
    startedAt: "2026-10-02T09:00:01Z",
    completedAt: "2026-10-02T09:05:00Z",
    assistantMessageId: null,
  };
  const overview = overviewOf([
    shell("asks", { hasPendingApprovals: true }),
    shell("runs", RUNNING),
    shell("finished", { latestTurn: completed }),
    shell("broke", { session: { ...RUNNING.session, status: "error", lastError: "boom" } }),
  ]);
  const digest = (id: string) => overview.threads.list.find((entry) => entry.id === id);
  expect(digest("asks")?.kind).toBe("approval");
  expect(digest("runs")?.kind).toBe("working");
  expect(digest("broke")?.kind).toBe("failed");
  expect(digest("finished")).toEqual({
    id: "finished",
    title: "finished",
    kind: "idle",
    turnId: "turn-9",
    turnState: "completed",
    completedAt: "2026-10-02T09:05:00Z",
  });
});

// witness: apps/server/src/zerops/hqOverview/zeropsHqOverview.ts | ranked.slice(0, MATE_OVERVIEW_THREADS_MAX) → ranked.slice(0, MATE_OVERVIEW_THREADS_MAX - 1)
it("HO3: HQ lists every chat that is not idle, then the newest idle ones up to forty, and counts the rest", () => {
  const at = (minute: number) => `2026-10-02T10:${String(minute).padStart(2, "0")}:00Z`;
  const waiting = ["w1", "w2", "w3"].map((id) =>
    shell(id, { hasPendingUserInput: true, updatedAt: at(0) }),
  );
  const resting = Array.from({ length: 45 }, (_, index) =>
    shell(`r${String(index + 1)}`, { updatedAt: at(index + 1) }),
  );
  const { threads } = overviewOf([...resting, ...waiting]);
  const newest = Array.from({ length: 37 }, (_, index) => `r${String(45 - index)}`);
  expect(threads.list.map((entry) => entry.id)).toEqual(["w1", "w2", "w3", ...newest]);
  expect(threads.omitted).toBe(8);
});

// witness: apps/server/src/zerops/hqOverview/zeropsHqOverview.ts | if (crew === undefined) return { status: "off" }; → if (crew === undefined) return { status: "none" };
it("HO4: The crew reads off until the crew engine is heard from, and carries no digest until a crew is applied", () => {
  const crewOf = (crew: CrewSnapshot | undefined) =>
    decodeOverview(mateOverviewOf({ identity: IDENTITY, threads: [], auth: NO_LOGINS, crew })).crew;
  expect(crewOf(CREW_OFF_SNAPSHOT)).toEqual({ status: "off" });
  expect(crewOf({ ...CREW_OFF_SNAPSHOT, status: "none" })).toEqual({ status: "none" });
  expect(crewOf(undefined)).toEqual({ status: "off" });
});

// witness: apps/server/src/zerops/hqOverview/zeropsHqOverview.ts | thread.archivedAt === null && thread.crew === undefined; → thread.archivedAt === null;
it("HO5: A crewmate's chat is never listed among the person's chats; the crew digest shows each crewmate with its chat's kind and its login, the crew's attention, its ready tasks and whether the person lands", () => {
  const leadsChat = shell("crew-lead-1", {
    hasPendingApprovals: true,
    crew: { crew: "Shop", crewmate: "lead", stint: 1 },
  });
  const overview = overviewOf([shell("main"), leadsChat], CREW);
  expect(overview.threads.list.map((entry) => entry.id)).toEqual(["main"]);
  expect(overview.crew).toEqual({
    status: "applied",
    crewmates: [
      {
        handle: "lead",
        displayName: "Lead",
        tint: "violet",
        lead: true,
        threadId: "crew-lead-1",
        threadKind: "approval",
        loginKey: "claude-code",
      },
      {
        handle: "backend",
        displayName: "Backend",
        tint: "sky",
        lead: false,
        threadId: null,
        threadKind: null,
        loginKey: "claudeAgent-work",
      },
    ],
    attention: [{ id: "question:task-2", kind: "question", handle: "backend" }],
    readyTasks: [{ id: "task-1", owner: "backend" }],
    personLands: true,
  });
});

// witness: apps/server/src/zerops/hqOverview/zeropsHqOverview.ts | step.calls.slice(-MATE_LIVE_STEP_BOUNDS.calls) → step.calls.slice(0, MATE_LIVE_STEP_BOUNDS.calls)
it("HO6: A running turn's live step keeps its four newest calls, each of their words cut to what a row shows", () => {
  const call = (index: number) => ({
    id: `call-${String(index)}`,
    activityKind: "tool.updated",
    itemType: "command_execution",
    title: "Command run",
    detail: `Bash: ${"x".repeat(400)}`,
    toolName: "Bash",
    command: "y".repeat(300),
    input: Object.fromEntries(
      Array.from({ length: 6 }, (_, key) => [`key${String(key)}`, "z".repeat(200)]),
    ),
    files: ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"],
    startedAt: "2026-10-02T10:00:00Z",
  });
  const main = shell("main", {
    ...RUNNING,
    liveStep: {
      kind: "calls",
      since: "2026-10-02T10:00:05Z",
      calls: Array.from({ length: 6 }, (_, index) => call(index + 1)),
    },
  });
  const step = overviewOf([main]).main?.liveStep;
  if (step?.kind !== "calls") throw new Error("expected calls");
  expect(step.calls.map((entry) => entry.id)).toEqual(["call-3", "call-4", "call-5", "call-6"]);
  const [first] = step.calls;
  expect(first?.detail?.length).toBe(280);
  expect(first?.command?.length).toBe(200);
  expect(Object.keys(first?.input ?? {})).toEqual(["key0", "key1", "key2", "key3"]);
  expect(Object.values(first?.input ?? {}).every((value) => value.length === 120)).toBe(true);
  expect(first?.files).toEqual(["a.ts", "b.ts", "c.ts"]);
});

// witness: apps/server/src/zerops/hqOverview/zeropsHqOverview.ts | textOf(title, MATE_TITLE_MAX) ?? "…" → cut(title.trim(), MATE_TITLE_MAX) || "…"
it("HO7: A secret in a chat's title never leaves the Mate, in the main chat or in the list", () => {
  const secret = "DATABASE_PASSWORD=hunter2-rotated";
  const overview = overviewOf([shell("main", { title: `Rotate ${secret}` })]);
  expect(overview.main?.title).not.toContain("hunter2");
  expect(overview.threads.list[0]?.title).not.toContain("hunter2");
});

// witness: apps/server/src/zerops/hqOverview/zeropsHqOverview.ts | .filter((login) => !login.default) → .filter((login) => login.default)
it("HO8: Each login reaches HQ under the key its signer goes by, the agents' own first and the default logins left out, with who signed it in, whether its credential is there and whether it is an API key", () => {
  const agent = (agentId: "claude-code" | "codex", extra: object) => ({
    agentId,
    credPresent: false,
    flagOAuth: false,
    flagToken: false,
    providerAuth: "unknown",
    state: "not-authorized",
    ...extra,
  });
  const auth = decodeAuth({
    available: true,
    agents: [
      agent("claude-code", {
        credPresent: true,
        state: "authorized",
        authorizedBy: { subject: "user-ada" },
      }),
      agent("codex", { flagToken: true, state: "authorized-token" }),
    ],
    logins: [
      {
        id: "claudeAgent",
        agent: "claude-code",
        label: "",
        kind: "subscription",
        default: true,
        state: "authorized",
        token: false,
      },
      {
        id: "claudeAgent-work",
        agent: "claude-code",
        label: "work",
        kind: "subscription",
        default: false,
        state: "needs-reauth",
        token: false,
        signedInBy: "user-bo",
      },
    ],
  });
  const { logins } = decodeOverview(
    mateOverviewOf({ identity: IDENTITY, threads: [], auth, crew: CREW_OFF_SNAPSHOT }),
  );
  expect(Object.keys(logins)).toEqual(["claude-code", "codex", "claudeAgent-work"]);
  expect(logins["claude-code"]).toMatchObject({
    signedInBy: "user-ada",
    present: true,
    token: false,
  });
  expect(logins.codex).toMatchObject({ signedInBy: null, present: false, token: true });
  expect(logins["claudeAgent-work"]).toMatchObject({
    signedInBy: "user-bo",
    present: true,
    token: false,
  });
});

// witness: apps/server/src/zerops/hqOverview/zeropsHqOverview.ts | signedInBy: agent.authorizedBy?.subject ?? null, → signedInBy: agent.authorizedBy?.subject ?? lastSigners?.[agent.agentId] ?? null,
it("HO9: A signed-out login keeps its last signer for display and is signed in by nobody", () => {
  const auth = decodeAuth({
    available: true,
    agents: [
      {
        agentId: "claude-code",
        credPresent: false,
        flagOAuth: false,
        flagToken: false,
        providerAuth: "unknown",
        state: "not-authorized",
      },
    ],
  });
  const overview = decodeOverview(
    mateOverviewOf({
      identity: IDENTITY,
      threads: [],
      auth,
      crew: CREW_OFF_SNAPSHOT,
      lastSigners: { "claude-code": ZeropsUserId.make("user-ada") },
    }),
  );
  expect(Object.keys(overview.logins)).toEqual(["claude-code"]);
  expect(overview.logins["claude-code"]).toMatchObject({
    signedInBy: null,
    lastSignedInBy: "user-ada",
    present: false,
    token: false,
  });
});

// witness: apps/server/src/zerops/hqOverview/zeropsHqOverview.ts | let oldest = list.findLastIndex(isResting); → let oldest = list.findIndex(isResting);
it("HO10: An overview over the link's frame bound drops idle chats, oldest first, and counts them; the main chat and every chat that is not idle stay", () => {
  const at = (minute: number) => `2026-10-02T10:${String(minute).padStart(2, "0")}:00Z`;
  const threads = [
    shell("waits", { hasPendingUserInput: true, updatedAt: at(0) }),
    ...Array.from({ length: 5 }, (_, index) =>
      shell(`r${String(index + 1)}`, { updatedAt: at(index + 1) }),
    ),
  ];
  const fitted = (maxBytes: number) =>
    decodeOverview(
      mateOverviewOf(
        { identity: IDENTITY, threads, auth: NO_LOGINS, crew: CREW_OFF_SNAPSHOT },
        maxBytes,
      ),
    );
  const frameBytes = (overview: MateOverview) =>
    linkFrameBytes(JSON.stringify({ type: "overview", full: true, overview }));
  const whole = frameBytes(fitted(Number.MAX_SAFE_INTEGER));

  const tight = fitted(whole - 1);
  expect(frameBytes(tight)).toBeLessThanOrEqual(whole - 1);
  expect(tight.threads.list.map((entry) => entry.id)).toEqual(["waits", "r5", "r4", "r3", "r2"]);
  expect(tight.threads.omitted).toBe(1);

  // The main chat and the chats that wait are never dropped, whatever the bound.
  const none = fitted(1);
  expect(none.threads.list.map((entry) => entry.id)).toEqual(["waits"]);
  expect(none.threads.omitted).toBe(5);
  expect(none.main).not.toBeNull();
});

// witness: apps/server/src/zerops/hqOverview/zeropsHqOverview.ts | ...(rows === undefined ? {} : { conversations: rows }), → conversations: rows ?? [],
it("HO11: A V1 Mate's overview carries no conversation rows and names no engine", () => {
  const overview = overviewOf([shell("main")]);
  expect("conversations" in overview).toBe(false);
  expect("engine" in overview.identity).toBe(false);
});

// witness: apps/server/src/zerops/hqOverview/zeropsHqOverview.ts | .slice(0, MATE_OVERVIEW_CONVERSATIONS_MAX) → .slice(0, MATE_OVERVIEW_CONVERSATIONS_MAX - 1)
it("HO12: An engine Mate's overview carries every conversation that is not idle, then the newest, up to forty", () => {
  const rows = [
    row("old", { at: 1 }),
    row("works", { at: 2, state: { kind: "working", since: 2, waitsOnHelpers: false } }),
    ...Array.from({ length: 45 }, (_, n) => row(`r${String(n)}`, { at: 100 + n })),
  ];
  const overview = engineOverview(rows);
  expect(overview.identity.engine).toEqual({ protocol: 1 });
  const ids = overview.conversations?.map((each) => each.conversationId) ?? [];
  expect(ids).toHaveLength(40);
  expect(ids.slice(0, 3)).toEqual(["works", "r44", "r43"]);
  expect(ids).not.toContain("old");
});

// witness: apps/server/src/zerops/hqOverview/zeropsHqOverview.ts | cut(maskSecrets(value).trim(), MATE_LINK_TEXT_MAX) → cut(value.trim(), MATE_LINK_TEXT_MAX)
it("HO13: A conversation's error line and the words it waits on are masked and cut before they leave the Mate", () => {
  const secret = "sk-ant-api03-" + "x".repeat(40);
  const overview = engineOverview([
    row("fails", { state: { kind: "failed", errorLine: `${secret} ${"e".repeat(400)}` } }),
    row("asks", { state: { kind: "waiting", on: "question", words: "w".repeat(400) } }),
  ]);
  const [fails, asks] = overview.conversations ?? [];
  const errorLine = fails?.state.kind === "failed" ? fails.state.errorLine : "";
  expect(errorLine).toHaveLength(280);
  expect(errorLine).not.toContain(secret);
  expect(asks?.state.kind === "waiting" ? asks.state.words : "").toHaveLength(280);
});

// witness: apps/server/src/zerops/hqOverview/zeropsHqOverview.ts | restingRow(row) && (row.conversationId as string) !== overview.main?.id; → restingRow(row);
it("HO14: Over the frame bound, idle conversations go oldest first after the idle chats; the main chat's conversation and every one that is not idle stay", () => {
  const rows = [
    row("main", { at: 0 }),
    row("works", { at: 1, state: { kind: "working", since: 1, waitsOnHelpers: false } }),
    ...Array.from({ length: 4 }, (_, n) => row(`r${String(n)}`, { at: 10 + n })),
  ];
  const ids = (maxBytes: number) =>
    engineOverview(rows, maxBytes).conversations?.map((each) => each.conversationId);
  expect(ids(Number.MAX_SAFE_INTEGER)).toEqual(["works", "r3", "r2", "r1", "r0", "main"]);
  expect(ids(1)).toEqual(["works", "main"]);
});

// witness: apps/server/src/zerops/hqOverview/zeropsHqOverview.ts | resetsAt: limit.resetsAt, → resetsAt: thread.usagePause?.resetsAt ?? null,
it("HO15: A usage refusal reaches HQ as its provider and its reset, also after the scheduling pause clears, and the error words that told it are not sent", () => {
  const paused = overviewOf([
    shell("main", {
      session: {
        threadId: "main",
        status: "running",
        providerName: "claudeAgent",
        activeTurnId: "turn",
        lastError: null,
        updatedAt: "2026-10-08T14:20:00Z",
      },
      usagePause: {
        resetsAt: "2026-10-08T16:00:00Z",
        window: "5-hour",
        held: 0,
        pausedAt: "2026-10-08T14:20:00Z",
        autoResume: true,
      },
    }),
  ]);
  expect(paused.main).toMatchObject({
    refusal: { provider: "Claude", resetsAt: "2026-10-08T16:00:00Z" },
  });
  expect(paused.main?.session?.lastError).toBeNull();
  expect(paused.main?.usagePause).toEqual({
    resetsAt: "2026-10-08T16:00:00Z",
  });

  const cleared = overviewOf([
    shell("main", {
      session: {
        threadId: "main",
        status: "stopped",
        providerName: "claudeAgent",
        activeTurnId: null,
        lastError: "Claude usage limit reached.",
        usageLimitResetAt: "2026-10-07T02:00:00Z",
        updatedAt: "2026-10-07T02:00:30Z",
      },
      usagePause: null,
    }),
  ]);
  expect(cleared.main?.usagePause).toBeNull();
  expect(cleared.main).toMatchObject({
    refusal: { provider: "Claude", resetsAt: "2026-10-07T02:00:00Z" },
  });
  expect(cleared.main?.session?.lastError).toBeNull();

  const weekly = overviewOf([
    shell("main", {
      session: {
        ...RUNNING.session,
        providerName: "claudeAgent",
        lastError: "You've hit your weekly limit · resets 2am (UTC)",
        usageLimitResetAt: "2026-10-10T02:00:00Z",
      },
    }),
  ]);
  expect(weekly.main).toMatchObject({
    refusal: { provider: "Claude", resetsAt: "2026-10-10T02:00:00Z" },
  });
  expect(weekly.main?.session?.lastError).toBeNull();
  expect(weekly.main?.usagePause).toBeNull();
});

// witness: apps/server/src/zerops/hqOverview/zeropsHqOverview.ts | limit.kind !== "none" && thread.usagePause != null → thread.usagePause != null
it("HO16: A turn admitted after a usage refusal clears the refusal and the pause HQ shows, and the chat reads working", () => {
  const overview = overviewOf([
    shell("main", {
      latestTurn: {
        ...RUNNING.latestTurn,
        turnId: "admitted",
        startedAt: "2026-10-08T11:00:00Z",
        state: "running",
      },
      session: {
        ...RUNNING.session,
        providerName: "claudeAgent",
        lastError: "You've hit your weekly limit",
        updatedAt: "2026-10-08T10:00:00Z",
      },
      usagePause: {
        resetsAt: "2026-10-10T02:00:00Z",
        pausedAt: "2026-10-08T10:00:00Z",
        window: "7-day",
        held: 0,
        autoResume: false,
      },
    }),
  ]);
  expect(overview.main?.session?.lastError).toBeNull();
  expect(overview.main?.usagePause).toBeNull();
  expect(overview.main).toMatchObject({ refusal: null });
  expect(overview.threads.list.find((thread) => thread.id === "main")?.kind).toBe("working");
});

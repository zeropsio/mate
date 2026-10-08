import {
  ConversationRow,
  CrewSnapshot,
  OrchestrationThreadShell,
  ZeropsAgentAuthSnapshot,
} from "@t3tools/contracts";
import { linkFrameBytes, MateOverview, type OverviewIdentity } from "@t3tools/shared/mateLink";
import { maskSecrets } from "@t3tools/shared/messagePreview";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { CREW_OFF_SNAPSHOT } from "./crew/crewSnapshot.ts";
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

const IDENTITY: OverviewIdentity = {
  environmentId: "env-1" as OverviewIdentity["environmentId"],
  serverVersion: "0.11.90",
  update: null,
};
const NO_LOGINS: ZeropsAgentAuthSnapshot = { available: true, agents: [] };

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

describe("mateOverviewOf", () => {
  it("carries the main chat's shell fields the menu row reads", () => {
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

  // `done` and `woke` are the reader's, from their own visit (`viewerThreadKind`): a Mate that
  // finished a turn says `idle`, with the turn's completion beside it.
  it("resolves each thread's kind without a visit", () => {
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

  // A thread leaves the list only while idle, so a transition that alerts is never cut off.
  it("keeps every thread that is not idle and fills to forty with the newest, counting the rest", () => {
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

  // The menu's door to the crew (`mateCrewItem`) for a Mate nobody opened: crew mode off, on with
  // no crew yet, or a crew applied — its digest only then.
  it.each([
    { case: "crew mode off", crew: CREW_OFF_SNAPSHOT, status: "off" },
    {
      case: "crew mode on, no crew yet",
      crew: { ...CREW_OFF_SNAPSHOT, status: "none" as const },
      status: "none",
    },
    { case: "the engine not heard from yet", crew: undefined, status: "off" },
  ])("says the crew's status, and no digest without a crew: $case", ({ crew, status }) => {
    const overview = decodeOverview(
      mateOverviewOf({ identity: IDENTITY, threads: [], auth: NO_LOGINS, crew }),
    );
    expect(overview.crew).toEqual({ status });
  });

  // A crewmate's chat is the crew's, never the person's: it speaks through the crew digest.
  it("leaves crewmates' threads out of the list and in the crew", () => {
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

  // The row phrases a live step with the run card's own words (`liveStep.ts`): its calls travel
  // as facts, each cut to what a row can show.
  it("cuts a live step's calls to their caps", () => {
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

  // Titles sit in HQ's database and its backups: masked at the Mate, as the previews already are.
  it("masks a title", () => {
    const secret = "DATABASE_PASSWORD=hunter2-rotated";
    const overview = overviewOf([shell("main", { title: `Rotate ${secret}` })]);
    expect(overview.main?.title).not.toContain("hunter2");
    expect(overview.threads.list[0]?.title).not.toContain("hunter2");
    expect(overview.main?.title).toBe(maskSecrets(`Rotate ${secret}`));
  });

  // Whose each login is, and what its lock reads (`crewAccess.ts`, `mateAccess.ts`): the agent
  // rows by agent id, every other login by its own id.
  it("carries each login's signer, credential and token, the agents' own first", () => {
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
    expect(logins).toEqual({
      "claude-code": { signedInBy: "user-ada", present: true, token: false },
      codex: { signedInBy: null, present: false, token: true },
      "claudeAgent-work": { signedInBy: "user-bo", present: true, token: false },
    });
  });

  // The link's frame bound (`MATE_LINK_FRAME_MAX`, UTF-8 bytes) passed in smaller, to reach it.
  it("fits 64 KiB by dropping the oldest resting threads first", () => {
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
});

describe("mateOverviewOf — an engine Mate's own rows", () => {
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

  it("a V1 Mate's overview carries no rows and no engine", () => {
    const overview = overviewOf([shell("main")]);
    expect("conversations" in overview).toBe(false);
    expect("engine" in overview.identity).toBe(false);
  });

  it("carries every row that is not idle, then the newest, up to forty", () => {
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

  it("masks and cuts a row's error line and the words it waits on", () => {
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

  // The link's frame bound passed in smaller, to reach it.
  it("fits 64 KiB by dropping the oldest resting rows after the resting threads, never the main's", () => {
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
});

it("relays the last signer for display while a signed-out login vouches for nobody", () => {
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
      lastSigners: { "claude-code": "user-ada" },
    }),
  );
  expect(overview.logins["claude-code"]).toEqual({
    signedInBy: null,
    lastSignedInBy: "user-ada",
    present: false,
    token: false,
  });
});

it("HQ learns which provider paused the Mate, with the provider's reset", () => {
  const overview = overviewOf([
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
  expect(overview.main).toMatchObject({
    refusal: { provider: "Claude", resetsAt: "2026-10-08T16:00:00Z" },
  });
  expect(overview.main?.session?.lastError).toBeNull();
  expect(overview.main?.usagePause).toEqual({
    resetsAt: "2026-10-08T16:00:00Z",
  });
});

it("HQ carries restart interruption beside typed provider refusal", () => {
  const interruption = {
    turnId: "turn-1",
    restart: { cause: "restarted", at: "2026-10-08T14:20:00Z" },
    continuation: "manual",
  };
  const overview = overviewOf([
    shell("main", {
      ...RUNNING,
      updatedAt: "2026-10-08T14:20:00Z",
      session: {
        ...RUNNING.session,
        interruption,
        lastError: "Claude usage limit reached",
        updatedAt: "2026-10-08T14:20:00Z",
      },
    }),
  ]);
  expect(overview.main?.session?.interruption).toEqual(interruption);
  expect(overview.main?.session?.lastError).toBeNull();
  expect(overview.main?.refusal).toMatchObject({ provider: "Claude", resetsAt: null });
});

it("HQ keeps a provider deadline after the scheduling pause clears", () => {
  const overview = overviewOf([
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
  expect(overview.main?.usagePause).toBeNull();
  expect(overview.main).toMatchObject({
    refusal: { provider: "Claude", resetsAt: "2026-10-07T02:00:00Z" },
  });
  expect(overview.main?.session?.lastError).toBeNull();
});

it("a generic weekly refusal retains Claude's identity through HQ compaction", () => {
  const overview = overviewOf([
    shell("main", {
      session: {
        ...RUNNING.session,
        providerName: "claudeAgent",
        lastError: "You've hit your weekly limit · resets 2am (UTC)",
        usageLimitResetAt: "2026-10-10T02:00:00Z",
      },
    }),
  ]);
  expect(overview.main).toMatchObject({
    refusal: { provider: "Claude", resetsAt: "2026-10-10T02:00:00Z" },
  });
  expect(overview.main?.session?.lastError).toBeNull();
  expect(overview.main?.usagePause).toBeNull();
});

it("a newer admitted turn publishes no inherited refusal to existing HQ readers", () => {
  const overview = overviewOf([
    shell("main", {
      latestTurn: {
        ...RUNNING.latestTurn!,
        turnId: "admitted",
        startedAt: "2026-10-08T11:00:00Z",
        state: "running",
      },
      session: {
        ...RUNNING.session!,
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

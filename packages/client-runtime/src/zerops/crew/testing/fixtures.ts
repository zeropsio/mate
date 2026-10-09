/**
 * A realistic applied crew for client tests and stories: a lead and three
 * writers on `appdev` — `backend`, `frontend` and `erik` (who writes the
 * business plan, a file like any other) — with a run on, tasks spread over the
 * board's states and a row of every common *Waiting on you* kind.
 *
 * The snapshot keeps the wire's cross-field rules (`readOnly` is
 * `kind !== "writer"`, `jobVersion` is `promptVersions.current.job`, a
 * crewmate's open and queued tasks are its own); `fixtures.test.ts` pins them,
 * so a test that overrides one field can rely on the rest.
 */
import {
  ThreadId,
  type CrewSnapshot,
  type CrewStint,
  type CrewTask,
  type Crewmate,
} from "@t3tools/contracts";

const at = (time: string) => `2026-09-27T${time}:00.000Z`;

const stint = (handle: string, number: number, fields: Partial<CrewStint> = {}): CrewStint => ({
  stint: number,
  threadId: ThreadId.make(`thread-crew-${handle}-${number}`),
  state: "active",
  reason: null,
  lastCompactSummary: null,
  startedAt: at("08:00"),
  retiredAt: null,
  ...fields,
});

const claudeLogin = { id: "claudeAgent", label: "Claude Code", agent: "claude-code" } as const;

const noMemory = { entries: 0, unfiled: 0 } as const;

const lead: Crewmate = {
  handle: "lead",
  displayName: "Lead",
  tint: "violet",
  kind: "lead",
  jobFirstLine: "Plans the work, splits it into tasks and reviews each landing.",
  jobVersion: 1,
  promptVersions: { running: { brief: 4, job: 1 }, current: { brief: 4, job: 1 } },
  login: claudeLogin,
  model: null,
  effort: null,
  readOnly: true,
  host: null,
  currentThreadId: ThreadId.make("thread-crew-lead-1"),
  stints: [stint("lead", 1)],
  context: { tokens: 18_400, window: 200_000 },
  compactions: 0,
  memory: { entries: 3, unfiled: 0 },
  openTaskId: null,
  queuedTaskIds: [],
  lane: null,
  app: null,
};

const backend: Crewmate = {
  handle: "backend",
  displayName: "Backend",
  tint: "sky",
  kind: "writer",
  jobFirstLine: "Owns the API under src/api and its tests.",
  jobVersion: 5,
  promptVersions: { running: { brief: 4, job: 4 }, current: { brief: 4, job: 5 } },
  login: claudeLogin,
  model: "claude-opus-5-5",
  effort: "high",
  readOnly: false,
  host: "appdev",
  currentThreadId: ThreadId.make("thread-crew-backend-2"),
  stints: [
    stint("backend", 1, {
      state: "retired",
      lastCompactSummary: "Paginated /api/users; the cursor is the row id.",
      retiredAt: at("09:10"),
    }),
    stint("backend", 2, { reason: "You cleared its conversation", startedAt: at("09:10") }),
  ],
  context: { tokens: 64_200, window: 200_000 },
  compactions: 1,
  memory: { entries: 6, unfiled: 2 },
  openTaskId: "task-12",
  queuedTaskIds: [],
  lane: {
    branch: "crew/backend",
    ahead: 3,
    insertions: 214,
    deletions: 12,
    dirty: false,
    check: { state: "passed", output: "Tests  48 passed (48)" },
    state: "ready",
    detail: null,
  },
  app: { state: "running", port: 3001, url: "https://appdev-1df2-3001.prg1.zerops.app" },
};

const frontend: Crewmate = {
  handle: "frontend",
  displayName: "Frontend",
  tint: "coral",
  kind: "writer",
  jobFirstLine: "Owns the game UI: the camera, the HUD and their tests.",
  jobVersion: 2,
  promptVersions: { running: { brief: 4, job: 2 }, current: { brief: 4, job: 2 } },
  login: claudeLogin,
  model: null,
  effort: null,
  readOnly: false,
  host: "appdev",
  currentThreadId: ThreadId.make("thread-crew-frontend-1"),
  stints: [stint("frontend", 1)],
  context: { tokens: 97_800, window: 200_000 },
  compactions: 2,
  memory: { entries: 4, unfiled: 0 },
  openTaskId: "task-13",
  queuedTaskIds: ["task-15"],
  lane: {
    branch: "crew/frontend",
    ahead: 2,
    insertions: 88,
    deletions: 30,
    dirty: false,
    check: { state: "passed", output: "Tests  31 passed (31)" },
    state: "ready",
    detail: null,
  },
  app: { state: "stopped", port: 3002, url: "https://appdev-1df2-3002.prg1.zerops.app" },
};

const erik: Crewmate = {
  handle: "erik",
  displayName: "Erik",
  tint: "amber",
  kind: "writer",
  jobFirstLine: "Writes the business plan in docs/business-plan.md.",
  jobVersion: 1,
  promptVersions: { running: { brief: 4, job: 1 }, current: { brief: 4, job: 1 } },
  login: { id: "codex", label: "Codex", agent: "codex" },
  model: null,
  effort: null,
  readOnly: false,
  host: "appdev",
  currentThreadId: ThreadId.make("thread-crew-erik-1"),
  stints: [stint("erik", 1)],
  context: { tokens: 22_100, window: 200_000 },
  compactions: 0,
  memory: noMemory,
  openTaskId: "task-14",
  queuedTaskIds: [],
  lane: {
    branch: "crew/erik",
    ahead: 1,
    insertions: 140,
    deletions: 0,
    dirty: false,
    check: null,
    state: "ready",
    detail: null,
  },
  app: { state: "none", port: 3003, url: "https://appdev-1df2-3003.prg1.zerops.app" },
};

const task = (
  fields: Pick<CrewTask, "id" | "number" | "title" | "owner" | "state"> & Partial<CrewTask>,
): CrewTask => ({
  source: "you",
  createdBy: "user-karel",
  createdAt: at("08:30"),
  dependsOn: [],
  fresh: false,
  brief: fields.title,
  doneWhen: "",
  note: null,
  attempts: 1,
  reason: null,
  question: null,
  waitingOn: [],
  diffStat: null,
  report: null,
  check: null,
  review: null,
  landedCommit: null,
  landedAt: null,
  delivered: false,
  ...fields,
});

const tasks: ReadonlyArray<CrewTask> = [
  task({
    id: "task-9",
    number: 9,
    title: "Rename the score endpoint",
    owner: "backend",
    state: "discarded",
    createdAt: at("07:40"),
  }),
  task({
    id: "task-10",
    number: 10,
    title: "Camera shake on hit",
    owner: "frontend",
    state: "landed",
    createdAt: at("07:50"),
    diffStat: { insertions: 42, deletions: 6 },
    report: "Shake runs 120 ms on a hit; tuned in camera.config.ts.",
    check: { state: "passed", output: "Tests  29 passed (29)" },
    review: { verdict: "accept", note: "Reads well.", by: "lead" },
    landedCommit: "9f3c2e1",
    landedAt: at("08:10"),
    delivered: true,
  }),
  task({
    id: "task-11",
    number: 11,
    title: "Health endpoint for the load balancer",
    owner: "backend",
    state: "landed",
    source: "lead",
    createdAt: at("08:00"),
    doneWhen: "GET /health answers 200",
    diffStat: { insertions: 35, deletions: 0 },
    report: "Added GET /health with a database ping.",
    check: { state: "passed", output: "Tests  46 passed (46)" },
    review: { verdict: "accept", note: "", by: "lead" },
    landedCommit: "a1b2c3d",
    landedAt: at("08:25"),
  }),
  task({
    id: "task-12",
    number: 12,
    title: "Add pagination to /api/items",
    owner: "backend",
    state: "working",
    source: "message",
    createdAt: at("09:12"),
    brief: "Add pagination to /api/items — cursor based, 50 per page.",
    diffStat: { insertions: 214, deletions: 12 },
  }),
  task({
    id: "task-13",
    number: 13,
    title: "HUD shows the ammo count",
    owner: "frontend",
    state: "waiting-on-you",
    createdAt: at("08:40"),
    doneWhen: "The HUD shows ammo; npm test passes",
    waitingOn: ["src/ui/hud.ts"],
    diffStat: { insertions: 88, deletions: 30 },
    report: "Ammo counter in the HUD, updated on fire and reload.",
    check: { state: "passed", output: "Tests  31 passed (31)" },
  }),
  task({
    id: "task-14",
    number: 14,
    title: "Write the business plan",
    owner: "erik",
    state: "blocked",
    source: "lead",
    createdAt: at("08:45"),
    doneWhen: "docs/business-plan.md covers pricing, market and costs",
    question: "Pricing in CZK or EUR?",
    diffStat: { insertions: 140, deletions: 0 },
  }),
  task({
    id: "task-15",
    number: 15,
    title: "Camera rig follows the player",
    owner: "frontend",
    state: "queued",
    source: "lead",
    createdAt: at("08:50"),
    dependsOn: ["task-12"],
    attempts: 0,
    doneWhen: "The camera follows the player; npm test passes",
  }),
  task({
    id: "task-16",
    number: 16,
    title: "Rate-limit the public API",
    owner: "backend",
    state: "proposed",
    source: "lead",
    createdBy: null,
    createdAt: at("09:20"),
    attempts: 0,
  }),
  task({
    id: "task-17",
    number: 17,
    title: "Cost table for the plan",
    owner: "erik",
    state: "parked",
    source: "lead",
    createdAt: at("08:20"),
    attempts: 2,
    reason: "the check timed out twice",
  }),
];

const appliedCrew: CrewSnapshot = {
  status: "applied",
  seq: 214,
  crew: {
    name: "game",
    briefTitle: "Camera and HUD rework",
    briefVersion: 4,
    briefExcerpt:
      "The camera follows the player and the HUD shows health and ammo.\nKeep the API backwards compatible.",
  },
  crewmates: [lead, backend, frontend, erik],
  hosts: [
    {
      host: "appdev",
      integration: { branch: "main", head: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678" },
      crewPorts: [
        { port: 3001, routed: true },
        { port: 3002, routed: true },
        { port: 3003, routed: true },
        { port: 3004, routed: true },
      ],
      served: { by: "tree" },
      claim: { state: "requested", handle: "backend", grantWaiting: false },
    },
  ],
  board: { tasks },
  run: {
    id: "run-3",
    state: "running",
    reason: null,
    reasonDetail: null,
    startedBy: "user-karel",
    startedAt: at("08:00"),
    elapsedMs: 72 * 60_000,
    spentUsd: 6.4,
    usagePercent: 54,
    options: {
      budgetUsd: 20,
      timeLimitHours: 8,
      stopAtUsagePercent: 80,
      landing: "person",
      devGrant: false,
      leadMayStart: false,
    },
  },
  attention: [
    {
      id: "question:task-14",
      kind: "question",
      handle: "erik",
      taskId: "task-14",
      text: "Pricing in CZK or EUR?",
      paths: [],
      host: null,
      at: at("09:02"),
    },
    {
      id: "landing-wait:task-13",
      kind: "landing-wait",
      handle: "frontend",
      taskId: "task-13",
      text: null,
      paths: ["src/ui/hud.ts"],
      host: null,
      at: at("09:05"),
    },
    {
      id: "plan:lead",
      kind: "plan",
      handle: "lead",
      taskId: null,
      text: null,
      paths: [],
      host: null,
      at: at("09:20"),
    },
    {
      id: "show-on-dev:appdev",
      kind: "show-on-dev",
      handle: "backend",
      taskId: "task-12",
      text: null,
      paths: [],
      host: "appdev",
      at: at("09:22"),
    },
    {
      id: "parked:task-17",
      kind: "parked",
      handle: "erik",
      taskId: "task-17",
      text: "the check timed out twice",
      paths: [],
      host: null,
      at: at("08:58"),
    },
  ],
  devHosts: [{ host: "appdev", database: false }],
  landedNotDelivered: 1,
  lastError: null,
};

/** The applied crew above, with any top-level field replaced. */
export const crewSnapshotFixture = (overrides: Partial<CrewSnapshot> = {}): CrewSnapshot => ({
  ...appliedCrew,
  ...overrides,
});

/** A crewmate's one engine conversation in the applied crew above (`crew-<crew>-<handle>-<n>`). */
export const crewConversationId = (handle: string): ThreadId =>
  ThreadId.make(`crew-game-${handle}-1`);

/**
 * The applied crew above as the engine's crew serves it: a revision under the Mate's epoch, each
 * crewmate in its one conversation (`currentThreadId` repeats it), its sessions counted, no
 * stints. Backend's conversation was cleared once.
 */
export const crewEngineSnapshotFixture = (overrides: Partial<CrewSnapshot> = {}): CrewSnapshot => ({
  ...appliedCrew,
  revision: { epoch: 3, seq: 41 },
  crewmates: appliedCrew.crewmates.map((mate) => ({
    ...mate,
    conversationId: crewConversationId(mate.handle),
    currentThreadId: crewConversationId(mate.handle),
    stints: [],
    sessions:
      mate.handle === "backend"
        ? { count: 2, lastReason: "cleared" as const }
        : { count: 1, lastReason: null },
  })),
  ...overrides,
});

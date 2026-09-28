import {
  CrewAttentionKind,
  CrewRefusalReason,
  CrewTaskState,
  type CrewLaneSummary,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { crewSnapshotFixture } from "./testing/fixtures.ts";
import {
  CREW_ATTENTION_VERBS,
  CREW_BOARD_COLUMNS,
  CREW_CREWMATES_WORD,
  CREW_LEAD_WORD,
  CREW_IDLE_WORD,
  CREW_LANE_VERBS,
  crewAheadWord,
  crewAppWord,
  crewConflictWord,
  crewDevHostDatabaseWord,
  crewDiffStatWord,
  crewEarlierStintNotice,
  crewJobVersionWord,
  crewLandedAsWord,
  crewMessagePlaceholder,
  crewPendingNotice,
  crewStintWord,
  crewTaskSourceWord,
  crewApplyWord,
  crewAskToFixWord,
  crewAskToResolveWord,
  crewAttentionSentence,
  crewBoardLinkWord,
  crewCommitEditAsk,
  crewDeliverAsk,
  crewDescribeAsk,
  crewLandedWord,
  crewLaneWord,
  crewNoDevHostWord,
  crewRunsOnWord,
  crewPendingWord,
  crewPortsAsk,
  crewPortsOffWord,
  crewServedWord,
  crewBoardColumn,
  crewCheckWord,
  crewPersonLands,
  crewQueuedReason,
  crewRefusalSentence,
  crewRunMeters,
  crewStateWord,
  crewTaskWord,
} from "./phrases.ts";

const crew = crewSnapshotFixture();
const tasks = crew.board.tasks;
const taskOf = (id: string) => tasks.find((task) => task.id === id)!;
const working = taskOf("task-12");
const run = crew.run!;

describe("CREW_BOARD_COLUMNS", () => {
  it("titles the board's columns in PRD §4.4's order", () => {
    expect(CREW_BOARD_COLUMNS.map((column) => column.title)).toEqual([
      "Waiting on you",
      "Working",
      "In review",
      "Queued",
      "Landed",
    ]);
  });
});

describe("crewBoardColumn", () => {
  it.each([
    ["proposed", "waiting-on-you"],
    ["queued", "queued"],
    ["working", "working"],
    ["rework", "working"],
    ["blocked", "waiting-on-you"],
    ["merging", "working"],
    ["checking", "working"],
    ["review", "in-review"],
    ["landing", "working"],
    ["waiting-on-you", "waiting-on-you"],
    ["landed", "landed"],
    ["parked", "waiting-on-you"],
    ["discarded", null],
  ] as const)("puts %s in %s", (state, column) => {
    expect(crewBoardColumn(state, true)).toBe(column);
    expect(crewBoardColumn(state, false)).toBe(column);
  });

  it("puts a ready task on you when you land, in review when the run lands it", () => {
    expect(crewBoardColumn("ready", true)).toBe("waiting-on-you");
    expect(crewBoardColumn("ready", false)).toBe("in-review");
  });

  it("gives every state but discarded a column", () => {
    const columns = new Set(CREW_BOARD_COLUMNS.map((column) => column.id));
    const placed = CrewTaskState.literals.filter((state) => {
      const column = crewBoardColumn(state, true);
      return column !== null && columns.has(column);
    });
    expect(placed).toEqual(CrewTaskState.literals.filter((state) => state !== "discarded"));
  });
});

describe("crewTaskWord", () => {
  const context = {
    tasks,
    hasLead: true,
    threadStatusWord: "Connecting",
    ownerOpenTaskId: null,
  };

  it.each([
    ["proposed", {}, "Proposed"],
    ["queued", {}, "Queued"],
    [
      "rework",
      { reason: "the check fails on /api/items" },
      "Rework: the check fails on /api/items",
    ],
    ["rework", { reason: null }, "Rework"],
    ["blocked", {}, "Asks a question"],
    ["merging", {}, "Checking"],
    ["checking", {}, "Checking"],
    ["review", {}, "In review by lead"],
    ["ready", {}, "Ready to land"],
    ["landing", {}, "Landing"],
    ["waiting-on-you", { waitingOn: ["src/ui/hud.ts"] }, "Waits on your tree: src/ui/hud.ts"],
    [
      "waiting-on-you",
      { waitingOn: ["src/ui/hud.ts", "src/ui/ammo.ts", "README.md"] },
      "Waits on your tree: src/ui/hud.ts +2",
    ],
    ["landed", { delivered: false }, "Landed · not delivered"],
    ["landed", { delivered: true }, "Delivered"],
    ["parked", { reason: "The check timed out twice" }, "Stopped: The check timed out twice"],
    ["parked", { reason: null }, "Stopped"],
    ["discarded", {}, "Discarded"],
  ] as const)("words %s %j as %s", (state, fields, word) => {
    expect(crewTaskWord({ ...working, dependsOn: [], state, ...fields }, context)).toBe(word);
  });

  it("names the first dependency a queued task still waits for", () => {
    expect(crewTaskWord(taskOf("task-15"), context)).toBe("Queued · after #12");
    const afterLanded = { ...taskOf("task-15"), dependsOn: ["task-11", "task-12"] };
    expect(crewTaskWord(afterLanded, context)).toBe("Queued · after #12");
    expect(crewTaskWord({ ...afterLanded, dependsOn: ["task-11"] }, context)).toBe("Queued");
  });

  it("names what a queued task waits for: a dependency first, else its owner's open task", () => {
    const behindOwner = { ...context, ownerOpenTaskId: "task-13" };
    const noDependency = { ...taskOf("task-15"), dependsOn: [] };
    expect(crewTaskWord(noDependency, behindOwner)).toBe("Queued · waits for #13");
    expect(crewQueuedReason(noDependency, behindOwner)).toBe("waits for #13");
    expect(crewTaskWord(taskOf("task-15"), behindOwner)).toBe("Queued · after #12");
    expect(crewQueuedReason(taskOf("task-15"), behindOwner)).toBe("after #12");
    expect(crewQueuedReason(noDependency, context)).toBeNull();
    expect(crewQueuedReason(noDependency, { ...context, ownerOpenTaskId: "task-404" })).toBeNull();
  });

  it("words a working task with its thread's own status word", () => {
    expect(crewTaskWord(working, { ...context, threadStatusWord: "Pending Approval" })).toBe(
      "Pending Approval",
    );
  });

  it("says who reviews only when the crew has a lead", () => {
    expect(crewTaskWord({ ...working, state: "review" }, { ...context, hasLead: false })).toBe(
      "In review",
    );
  });
});

describe("crewStateWord", () => {
  it.each([
    [null, 0, "Idle"],
    [null, 2, "2 working"],
    [{ ...run, state: "finished" }, 1, "1 working"],
    [run, 0, "Running · 1 h 12 m"],
    [{ ...run, elapsedMs: 45 * 60_000 }, 0, "Running · 45 m"],
    [{ ...run, elapsedMs: 8 * 3_600_000 }, 0, "Running · 8 h"],
    [{ ...run, state: "paused", reason: "budget" }, 0, "Paused · budget reached"],
    [{ ...run, state: "paused", reason: "time" }, 0, "Paused · time limit reached"],
    [{ ...run, state: "paused", reason: "usage" }, 0, "Paused · usage at 80 %"],
    [{ ...run, state: "paused", reason: "person" }, 0, "Paused"],
    [
      { ...run, state: "paused", reason: "refused", reasonDetail: "backend's login is not yours" },
      0,
      "Paused · backend's login is not yours",
    ],
    [{ ...run, state: "finishing" }, 3, "Finishing"],
  ] as const)("reads %j with %i working as %s", (latestRun, workingCount, word) => {
    expect(crewStateWord({ run: latestRun, workingCount })).toBe(word);
  });
});

describe("crewPersonLands", () => {
  const landing = (mode: "person" | "lead" | "check") => ({
    ...run,
    options: { ...run.options, landing: mode },
  });

  it.each([
    [null, true],
    [landing("person"), true],
    [landing("lead"), false],
    [{ ...landing("check"), state: "paused" }, false],
    [{ ...landing("lead"), state: "stopped" }, true],
  ] as const)("with run %j: %s", (latestRun, lands) => {
    expect(crewPersonLands(latestRun)).toBe(lands);
  });
});

describe("crewCheckWord", () => {
  it.each([
    ["running", "Checking"],
    ["passed", "Check passed"],
    ["failed", "Check failed"],
  ] as const)("words a %s check as %s", (state, word) => {
    expect(crewCheckWord({ state, output: "" })).toBe(word);
  });
});

describe("crewRunMeters", () => {
  it("reads spend, time and usage against their limits", () => {
    expect(crewRunMeters(run)).toEqual({
      spend: "Spend $6.40 of $20",
      time: "Time 1 h 12 m of 8 h",
      usage: "Usage 54 %, stops at 80",
    });
  });

  it("says no limit where the run has none", () => {
    const unlimited = {
      ...run,
      usagePercent: null,
      options: { ...run.options, budgetUsd: "unlimited", timeLimitHours: "unlimited" },
    } as const;
    expect(crewRunMeters(unlimited)).toEqual({
      spend: "Spend $6.40 · no limit",
      time: "Time 1 h 12 m · no limit",
      usage: null,
    });
  });

  it("drops the stop mark when the usage option is off", () => {
    const noStop = { ...run, options: { ...run.options, stopAtUsagePercent: null } };
    expect(crewRunMeters(noStop).usage).toBe("Usage 54 %");
  });
});

describe("crewAttentionSentence", () => {
  const rowOf = (kind: CrewAttentionKind) => crew.attention.find((row) => row.kind === kind)!;
  const sentence = (row: (typeof crew.attention)[number]) => crewAttentionSentence(row, crew);

  it.each([
    ["question", "Erik asks: Pricing in CZK or EUR?"],
    ["landing-wait", "Frontend's landing waits: src/ui/hud.ts is edited in your tree"],
    ["plan", "Lead proposes 1 task"],
    ["show-on-dev", "Backend asks to show its work on appdev"],
    ["parked", "Erik stopped: The check timed out twice"],
  ] as const)("words the fixture's %s row", (kind, words) => {
    expect(sentence(rowOf(kind))).toBe(words);
  });

  it.each([
    [
      { kind: "ready-to-land", handle: "frontend", taskId: "task-13" },
      "Frontend's #13 is ready to land",
    ],
    [
      { kind: "cant-start", handle: "backend", text: "the login is not yours" },
      "Can't start Backend: the login is not yours",
    ],
    [
      {
        kind: "cant-start",
        handle: "backend",
        text: "Backend's login was signed in by another member. Only their crews can use it.",
      },
      "Can't start Backend: Backend's login was signed in by another member. Only their crews can use it.",
    ],
    [
      { kind: "conflict", handle: "backend", paths: ["src/api/items.ts"] },
      "Backend's copy conflicts with what landed: src/api/items.ts",
    ],
    [{ kind: "check-failed", handle: "backend" }, "Backend's check failed"],
    [
      { kind: "landing-wait", handle: "frontend", paths: ["src/ui/hud.ts", "src/ui/ammo.ts"] },
      "Frontend's landing waits: src/ui/hud.ts and 1 more are edited in your tree",
    ],
    [{ kind: "question", handle: "gone", text: "Still there?" }, "@gone asks: Still there?"],
  ] as const)("words %j", (fields, words) => {
    const row = {
      ...rowOf("question"),
      taskId: null,
      text: null,
      paths: [],
      ...fields,
    };
    expect(sentence(row)).toBe(words);
  });

  it("counts every proposed task in the lead's plan", () => {
    const threeProposed = {
      ...crew,
      board: {
        tasks: [
          ...tasks,
          { ...taskOf("task-16"), id: "task-18", number: 18 },
          { ...taskOf("task-16"), id: "task-19", number: 19 },
        ],
      },
    };
    expect(crewAttentionSentence(rowOf("plan"), threeProposed)).toBe("Lead proposes 3 tasks");
  });

  it("words every attention kind", () => {
    for (const kind of CrewAttentionKind.literals) {
      expect(sentence({ ...rowOf("question"), kind }), kind).toMatch(/\S/);
    }
  });
});

describe("crewRefusalSentence", () => {
  it("refuses a Tell the crew without a mention in PRD §5.3's words", () => {
    expect(crewRefusalSentence("no-mention", null)).toBe(
      "Name a crewmate with @, or add a lead to split the work.",
    );
  });

  it("appends the engine's detail once", () => {
    expect(crewRefusalSentence("invalid-definition", "backend has no check command.")).toBe(
      "The crew files need a fix: backend has no check command.",
    );
  });

  it("words every refusal reason as one sentence", () => {
    for (const reason of CrewRefusalReason.literals) {
      expect(crewRefusalSentence(reason, null), reason).toMatch(/^[A-Z].*\.$/);
    }
  });
});

describe("the section's words (PRD §4.3)", () => {
  const lane = (fields: Partial<CrewLaneSummary>): CrewLaneSummary => ({
    branch: "crew/backend",
    ahead: 0,
    insertions: 0,
    deletions: 0,
    dirty: false,
    check: null,
    state: "ready",
    detail: null,
    ...fields,
  });

  it.each<readonly [string, CrewLaneSummary, string | null]>([
    ["nothing ahead", lane({}), null],
    ["commits ahead", lane({ ahead: 3 }), "3 ahead"],
    ["conflicts", lane({ ahead: 3, state: "conflicts" }), "Conflicts"],
    ["being created", lane({ state: "creating" }), "Creating its copy of the code"],
    ["setting up", lane({ state: "setting-up", detail: "npm ci" }), "Running npm ci"],
    ["setting up, no command", lane({ state: "setting-up" }), "Setting up its copy"],
    ["service redeploying", lane({ state: "frozen" }), "Its service is redeploying"],
    ["gone", lane({ state: "missing" }), "Its copy is missing"],
    ["failed", lane({ state: "failed", detail: "No free disk" }), "Its copy failed: No free disk"],
  ])("a copy: %s", (_name, input, word) => {
    expect(crewLaneWord(input)).toBe(word);
  });

  it.each([
    [{ job: 5, brief: null }, "v5 at next turn"],
    [{ job: null, brief: 5 }, "Brief v5 at next turn"],
    [{ job: 3, brief: 5 }, "v3 at next turn"],
    [{ job: null, brief: null }, null],
  ] as const)("pending %j reads %j", (pending, word) => {
    expect(crewPendingWord(pending)).toBe(word);
  });

  it("names the lead apart from the crewmates, and on the logins it runs on", () => {
    expect([CREW_LEAD_WORD, CREW_CREWMATES_WORD]).toEqual(["Lead", "Crewmates"]);
    expect(crewRunsOnWord(["lead", "backend"], "lead")).toBe("Runs: lead (lead), backend");
    expect(crewRunsOnWord(["backend"], null)).toBe("Runs: backend");
  });

  it("says why a writer has no service to pick yet", () => {
    expect(crewNoDevHostWord("Fen")).toBe(
      "No dev service is mounted yet — ask Fen to start development first.",
    );
  });

  it("words an idle crewmate as the idle crew", () => {
    expect(CREW_IDLE_WORD).toBe(crewStateWord({ run: null, workingCount: 0 }));
  });

  it("words Apply's progress per crewmate (PRD §4.7)", () => {
    const backend = crew.crewmates[1]!;
    expect(crewApplyWord({ ...backend, lane: lane({ state: "creating" }) })).toBe(
      "Creating Backend's copy of the code",
    );
    expect(
      crewApplyWord({ ...backend, lane: lane({ state: "setting-up", detail: "npm ci" }) }),
    ).toBe("Running npm ci");
    expect(crewApplyWord({ ...backend, lane: lane({ state: "failed", detail: "No disk" }) })).toBe(
      "No disk",
    );
    expect(crewApplyWord({ ...backend, lane: lane({}) })).toBe("Ready");
    expect(crewApplyWord(crew.crewmates[0]!)).toBe("Ready");
  });

  it("words the footer", () => {
    const host = crew.hosts[0]!;
    expect(crewBoardLinkWord(7)).toBe("Board · 7 tasks");
    expect(crewBoardLinkWord(1)).toBe("Board · 1 task");
    expect(crewLandedWord(3)).toBe("Landed, not delivered · 3");
    expect(crewPortsOffWord("appdev")).toBe("appdev · Crew ports: off");
    expect(crewServedWord(host, crew.crewmates)).toBe("appdev serves: your tree");
    expect(
      crewServedWord({ ...host, served: { by: "crewmate", handle: "frontend" } }, crew.crewmates),
    ).toBe("appdev serves: Frontend's copy");
    expect(crewServedWord({ ...host, served: { by: "unknown" } }, crew.crewmates)).toBeNull();
  });

  it("words the Waiting on you presses", () => {
    expect(Object.values(CREW_ATTENTION_VERBS)).toEqual([
      "Answer",
      "Commit my edit",
      "Land",
      "Review plan",
      "Allow",
      "Not now",
      "Try again",
    ]);
    expect(crewAskToResolveWord("Backend")).toBe("Ask Backend to resolve");
    expect(crewAskToFixWord("Backend")).toBe("Ask Backend to fix");
  });
});

describe("the drafts a crew surface hands the Mate", () => {
  it("asks for a local commit of the paths a landing waits on", () => {
    expect(crewCommitEditAsk(["src/ui/hud.ts"])).toBe(
      "Commit my edit to src/ui/hud.ts locally, without pushing: a crew landing waits on it.",
    );
    expect(crewCommitEditAsk(["a.ts", "b.ts"])).toBe(
      "Commit my edits to a.ts and b.ts locally, without pushing: a crew landing waits on them.",
    );
  });

  it("delivers the landed, undelivered tasks and names the tree's own dirty paths", () => {
    expect(crewDeliverAsk(crew, [])).toBe(
      "Ship the crew's landed work on appdev: #11 Health endpoint for the load balancer.",
    );
    expect(crewDeliverAsk(crew, ["src/ui/hud.ts", "README.md"])).toBe(
      "Ship the crew's landed work on appdev: #11 Health endpoint for the load balancer. My own edits in src/ui/hud.ts and README.md ship too.",
    );
  });

  it("asks for crew ports as one range (PRD §5.7)", () => {
    expect(crewPortsAsk("appdev", [3001, 3002, 3003, 3004])).toBe(
      "Add crew ports 3001–3004 (httpSupport) to appdev's dev setup in zerops.yaml, self-deploy appdev, then make sure each new port is routed on the subdomain.",
    );
    expect(crewPortsAsk("appdev", [3001])).toBe(
      "Add crew port 3001 (httpSupport) to appdev's dev setup in zerops.yaml, self-deploy appdev, then make sure the new port is routed on the subdomain.",
    );
  });

  it("asks the Mate to set up a described crew (PRD §4.7)", () => {
    expect(crewDescribeAsk("  a builder and a reviewer ")).toBe(
      "Set up a crew for this project: a builder and a reviewer",
    );
  });
});

describe("the chat's words (PRD §4.5, §5.6, §5.7)", () => {
  it("says how far a copy is ahead of your tree, and its change", () => {
    expect([0, 1, 3].map(crewAheadWord)).toEqual([
      null,
      "1 change ahead of your tree",
      "3 changes ahead of your tree",
    ]);
    expect(crewDiffStatWord({ insertions: 214, deletions: 12 })).toBe("+214 \u221212");
  });

  it("names the files a merge-in stopped on", () => {
    expect(crewConflictWord([])).toBe("Conflicts with what landed");
    expect(crewConflictWord(["src/api/items.ts", "src/api/users.ts"])).toBe(
      "Conflicts with what landed: src/api/items.ts and 1 more",
    );
  });

  it("names a landing by its task and its commit's short sha", () => {
    expect(crewLandedAsWord({ number: 11, landedCommit: "a1b2c3d" })).toBe(
      "Task #11 landed as a1b2c3d",
    );
    expect(
      crewLandedAsWord({ number: 11, landedCommit: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678" }),
    ).toBe("Task #11 landed as a1b2c3d");
  });

  it.each([
    [{ kind: "running", port: 3001 }, "App on :3001"],
    [{ kind: "stopped" }, "App stopped"],
    [{ kind: "no-crew-ports", host: "appdev" }, "No crew ports on appdev"],
    [{ kind: "no-free-port" }, "No free crew port"],
  ] as const)("says a crewmate's app %o", (app, word) => {
    expect(crewAppWord(app)).toBe(word);
  });

  it("names the lane bar's presses", () => {
    expect(CREW_LANE_VERBS).toEqual({
      showOnDev: "Show on dev",
      backToTree: "Back to my tree",
      landNow: "Land now",
      addCrewPorts: "Add crew ports",
    });
  });

  it("says where a task came from", () => {
    expect((["you", "lead", "message", "issue"] as const).map(crewTaskSourceWord)).toEqual([
      "from you",
      "from lead",
      "from a message",
      "from an issue",
    ]);
  });

  it("heads a crewmate's chat with its job's version and its conversations", () => {
    expect(crewJobVersionWord(4)).toBe("Job v4");
    expect(crewStintWord(2, true)).toBe("Conversation 2 · current");
    expect(crewStintWord(1, false)).toBe("Conversation 1");
    expect(crewMessagePlaceholder("Backend")).toBe("Message Backend…");
  });

  it.each([
    [{ brief: null, job: 5 }, "Job updated to v5 — the next turn starts a fresh conversation"],
    [{ brief: 5, job: null }, "Brief updated to v5 — the next turn starts a fresh conversation"],
    [
      { brief: 5, job: 6 },
      "Job updated to v6 and brief to v5 — the next turn starts a fresh conversation",
    ],
    [{ brief: null, job: null }, null],
  ] as const)("says what a pending prompt does at the next turn: %o", (pending, word) => {
    expect(crewPendingNotice(pending)).toBe(word);
  });

  it("points an earlier conversation at the current one", () => {
    expect(crewEarlierStintNotice("backend")).toEqual({
      text: "An earlier conversation with @backend — it goes on in a newer one.",
      sendBlock: "Write to @backend in its current conversation",
    });
  });
});

describe("crewDevHostDatabaseWord", () => {
  it.each([
    [true, "Has a database"],
    [false, "No database"],
    [null, "Database unknown"],
  ] as const)("says a dev service's database %s as %s", (database, word) => {
    expect(crewDevHostDatabaseWord(database)).toBe(word);
  });
});

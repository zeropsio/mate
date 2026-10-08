import { crewSnapshotFixture } from "@t3tools/client-runtime/zerops/crew/testing/fixtures";
import {
  deriveCrewView,
  type CrewShellInput,
  type CrewThreadRead,
} from "@t3tools/client-runtime/zerops/projections/crew";
import { crewAccess, type CrewLock } from "@t3tools/client-runtime/zerops/crew/crewAccess";
import {
  CrewAttentionKind,
  type CrewAttention,
  type CrewSnapshot,
  type CrewTask,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  CREW_ROW_NO_THREAD,
  crewActionOffered,
  crewNeedsByHandle,
  crewRowModel,
  type CrewRowAction,
  type CrewRowModel,
  type CrewRowThread,
} from "./CrewRows.logic";

const IDLE: CrewThreadRead = {
  status: { kind: "idle", toneId: "neutral" },
  word: null,
  working: false,
};

const base = crewSnapshotFixture();

/** The snapshot with no needs, every task but those named dropped from the board. */
const quiet = (fields: Partial<CrewSnapshot> = {}): CrewSnapshot =>
  crewSnapshotFixture({
    attention: [],
    hosts: base.hosts.map((host) => ({
      ...host,
      claim: { state: "none", handle: null, grantWaiting: false },
    })),
    ...fields,
  });

const AT_REST: CrewRowThread = { ...CREW_ROW_NO_THREAD, at: "2026-09-27T09:00:00.000Z" };
const AT_WORK: CrewRowThread = {
  face: "working",
  working: true,
  at: "2026-09-27T09:10:00.000Z",
  liveStep: { words: "Running the tests" },
  asked: null,
};

function rowOf(
  snapshot: CrewSnapshot,
  handle: string,
  thread: CrewRowThread = AT_REST,
): CrewRowModel {
  const shells: ReadonlyArray<CrewShellInput> = snapshot.crewmates.flatMap((mate) =>
    mate.currentThreadId === null
      ? []
      : [{ id: mate.currentThreadId, archivedAt: null, crew: null }],
  );
  const view = deriveCrewView(snapshot, shells, () => IDLE);
  const row = view.crewmates.find((entry) => entry.crewmate.handle === handle)!;
  return crewRowModel({
    row,
    snapshot,
    view,
    thread,
    attention: crewNeedsByHandle(snapshot.attention, snapshot.crewmates).get(handle) ?? [],
    mateName: "Fen",
  });
}

/** One need on Backend's open task (`task-12`), the snapshot otherwise quiet. */
function needing(
  kind: CrewAttention["kind"],
  fields: Partial<CrewAttention> = {},
  snapshot = quiet(),
) {
  const row: CrewAttention = {
    id: `${kind}:task-12`,
    kind,
    handle: "backend",
    taskId: "task-12",
    text: null,
    paths: [],
    host: null,
    at: "2026-09-27T09:20:00.000Z",
    ...fields,
  };
  return rowOf({ ...snapshot, attention: [row] }, "backend");
}

const lines = (model: CrewRowModel) => ({
  line2: model.line2 && [model.line2.text, model.line2.tone],
  line3: model.line3 && [model.line3.text, model.line3.tone],
  needs: model.needs.map((need) => [
    need.line.text,
    need.line.tone,
    need.actions.map((action) => action.label),
  ]),
});

describe("crewRowModel: a crewmate at rest and at work", () => {
  it("says its job, muted, while it is on nothing", () => {
    const model = rowOf(
      quiet({
        board: { tasks: [] },
        crewmates: base.crewmates.map((mate) => ({ ...mate, openTaskId: null, queuedTaskIds: [] })),
      }),
      "backend",
    );
    expect(lines(model)).toEqual({
      line2: ["Owns the API under src/api and its tests.", "muted"],
      line3: null,
      needs: [],
    });
    expect([model.pose, model.needsYou, model.slot]).toEqual([
      "idle",
      false,
      { kind: "age", at: "2026-09-27T09:00:00.000Z" },
    ]);
  });

  it("says what it is on and its step while it works, the clock counting", () => {
    const model = rowOf(quiet(), "backend", AT_WORK);
    expect(lines(model)).toEqual({
      line2: ["Add pagination to /api/items", "ink-2"],
      line3: ["Running the tests", "muted"],
      needs: [],
    });
    expect([model.pose, model.slot]).toEqual([
      "working",
      { kind: "clock", since: "2026-09-27T09:10:00.000Z" },
    ]);
  });

  it("holds no third line while it works and the server relays no step", () => {
    expect(rowOf(quiet(), "backend", { ...AT_WORK, liveStep: null }).line3).toBeNull();
  });

  it("says what it does next, its queue in order", () => {
    expect(rowOf(quiet(), "frontend").next).toBe("Camera rig follows the player");
  });

  it("dates nothing before its first turn", () => {
    expect(rowOf(quiet(), "backend", CREW_ROW_NO_THREAD).slot).toEqual({ kind: "none" });
  });
});

describe("crewRowModel: where its task stands while it is not at it", () => {
  const standing = (state: CrewTask["state"], fields: Partial<CrewTask> = {}, snapshot = quiet()) =>
    rowOf(
      {
        ...snapshot,
        board: {
          tasks: snapshot.board.tasks.map((task) =>
            task.id === "task-12" ? { ...task, state, ...fields } : task,
          ),
        },
      },
      "backend",
    ).line3;

  it.each<[string, CrewTask["state"], Partial<CrewTask>, CrewSnapshot, string | null]>([
    ["checked", "checking", {}, quiet(), "Checking its work"],
    ["merged in and checked", "merging", {}, quiet(), "Checking its work"],
    ["reported, the lead checks it", "review", {}, quiet(), "Done · the lead is checking it"],
    [
      "reported, no lead",
      "review",
      {},
      quiet({ crewmates: base.crewmates.filter((mate) => mate.kind !== "lead") }),
      "Done · waiting for its review",
    ],
    [
      "finished, a run puts it in",
      "ready",
      {},
      quiet({ run: { ...base.run!, options: { ...base.run!.options, landing: "check" } } }),
      "Done · going into Fen's code",
    ],
    ["going in", "landing", {}, quiet(), "Going into Fen's code"],
    [
      "asking the lead first",
      "blocked",
      { question: "Cursor or offset?" },
      quiet(),
      "Asked the lead: Cursor or offset?",
    ],
    [
      "sent back, a run sends it on",
      "rework",
      { reason: "the cursor skips rows" },
      quiet(),
      "Sent back: the cursor skips rows",
    ],
    ["working with no turn running", "working", {}, quiet(), null],
  ])("%s", (_, state, fields, snapshot, words) => {
    expect(standing(state, fields, snapshot)?.text ?? null).toBe(words);
  });

  it("says a broken copy in red, over anything else", () => {
    const broken = quiet({
      crewmates: base.crewmates.map((mate) =>
        mate.handle === "backend"
          ? { ...mate, lane: { ...mate.lane!, state: "failed", detail: "No free disk" } }
          : mate,
      ),
    });
    expect(rowOf(broken, "backend", AT_WORK).line3).toEqual({
      text: "Its copy of Fen's code failed: No free disk",
      tone: "failed",
    });
  });

  it("says its copy is on its way while Apply makes it", () => {
    const readying = quiet({
      crewmates: base.crewmates.map((mate) =>
        mate.handle === "backend" ? { ...mate, lane: { ...mate.lane!, state: "creating" } } : mate,
      ),
    });
    expect(rowOf(readying, "backend").line3).toEqual({
      text: "Getting its copy ready…",
      tone: "muted",
    });
  });

  // A crewmate on its way up wears the pose of every Mate coming up (`matePose`).
  it.each(["creating", "setting-up"] as const)("wakes while its copy is %s", (state) => {
    const readying = quiet({
      crewmates: base.crewmates.map((mate) =>
        mate.handle === "backend" ? { ...mate, lane: { ...mate.lane!, state } } : mate,
      ),
    });
    expect(rowOf(readying, "backend").pose).toBe("waking");
    expect(rowOf(quiet(), "backend").pose).toBe("idle");
  });
});

describe("crewRowModel: what it needs from you", () => {
  it.each<[CrewAttention["kind"], Partial<CrewAttention>, ReadonlyArray<unknown>]>([
    ["question", { text: "Cursor or offset?" }, ["Cursor or offset?", "ink", ["Answer"]]],
    [
      "landing-wait",
      { paths: ["src/ui/hud.ts"] },
      [
        "Can't go into Fen's code yet: Fen has uncommitted edits to hud.ts.",
        "ink",
        ["Ask Fen to commit them"],
      ],
    ],
    [
      "ready-to-land",
      {},
      ["Done, in its own copy · not in Fen's code yet", "muted", ["Review", "Try it"]],
    ],
    [
      "show-on-dev",
      { host: "appdev" },
      ["Wants to show its work at Fen's dev address.", "ink", ["Let it", "Not now"]],
    ],
    [
      "parked",
      { text: "the check timed out" },
      ["Stopped: the check timed out.", "ink", ["Try again", "Drop it"]],
    ],
    [
      "cant-start",
      { text: "its login is signed out" },
      ["Couldn't start: its login is signed out.", "ink", ["Try again"]],
    ],
    [
      "conflict",
      { paths: ["src/api/items.ts"] },
      [
        "Clashes with what's now in Fen's code, in src/api/items.ts.",
        "ink",
        ["Ask it to sort it out"],
      ],
    ],
    [
      "check-failed",
      { text: "2 tests failed" },
      ["Its checks fail: 2 tests failed.", "failed", ["Ask it to fix them"]],
    ],
    [
      "stalled",
      { text: "when the $20 ran out" },
      [
        "Stopped mid-way when the $20 ran out.",
        "ink",
        ["Continue", "Review what it has", "Drop it"],
      ],
    ],
    [
      "review-wait",
      {},
      ["Waits for the lead's review.", "ink", ["Ask the lead", "Review it yourself"]],
    ],
    [
      "sent-back",
      { text: "the cursor skips rows" },
      ["The lead sent it back: the cursor skips rows.", "ink", ["Ask it to rework", "Drop it"]],
    ],
    ["dependency-gone", {}, ["Waits for work that won't go in.", "ink", ["Drop it"]]],
  ])("%s", (kind, fields, need) => {
    const model = needing(kind, fields);
    expect(lines(model).needs).toEqual([need]);
    expect(model.needsYou).toBe(true);
    // The row is on the task the need is about: its title, and no second word on where it stands.
    expect(model.line2).toEqual({ text: "Add pagination to /api/items", tone: "ink-2" });
    expect(model.line3).toBeNull();
  });

  it("covers every kind the crew can need you for", () => {
    for (const kind of CrewAttentionKind.literals) {
      const model = needing(kind, { text: "why", paths: ["a.ts"], host: "appdev" });
      expect(model.needsYou, kind).toBe(true);
    }
  });

  it("asks with its face, and is happy while all it has is finished work", () => {
    expect(needing("question", { text: "?" }).pose).toBe("needs");
    expect(needing("ready-to-land").pose).toBe("done");
  });

  it("carries finished work's size", () => {
    expect(needing("ready-to-land").needs[0]?.line.diff).toEqual({
      insertions: 214,
      deletions: 12,
    });
  });

  it("names the task a need is about when the row is on another", () => {
    const model = rowOf(
      quiet({
        attention: [
          {
            id: "parked:task-17",
            kind: "parked",
            handle: "erik",
            taskId: "task-17",
            text: "the check timed out twice",
            paths: [],
            host: null,
            at: "2026-09-27T08:58:00.000Z",
          },
        ],
      }),
      "erik",
    );
    expect(lines(model)).toMatchObject({
      line2: ["Write the business plan", "ink-2"],
      needs: [
        [
          "Cost table for the plan · Stopped: the check timed out twice.",
          "ink",
          ["Try again", "Drop it"],
        ],
      ],
    });
  });

  it("offers a crewmate that only reads no copy of the app to try", () => {
    const reader = quiet({
      crewmates: base.crewmates.map((mate) =>
        mate.handle === "backend"
          ? { ...mate, kind: "reader", readOnly: true, lane: null, app: null }
          : mate,
      ),
    });
    expect(
      needing("ready-to-land", {}, reader).needs[0]?.actions.map((action) => action.label),
    ).toEqual(["Review"]);
  });

  it("takes back a Let it that waits for the current step", () => {
    const waiting = quiet({
      hosts: base.hosts.map((host) => ({
        ...host,
        claim: { state: "requested", handle: "backend", grantWaiting: true },
      })),
    });
    expect(lines(needing("show-on-dev", { host: "appdev" }, waiting)).needs).toEqual([
      ["Shows its work at Fen's dev address once its current step ends.", "ink", ["Not now"]],
    ]);
  });

  it("an edit sends what the board showed", () => {
    const snapshot = quiet();
    const tasks = snapshot.board.tasks.map((task) =>
      task.id === "task-12"
        ? { ...task, state: "queued" as const, attempts: 2, dependsOn: ["task-17"] }
        : task.id === "task-17"
          ? { ...task, state: "discarded" as const }
          : task,
    );
    const [startAnyway] = needing(
      "dependency-gone",
      {},
      { ...snapshot, board: { ...snapshot.board, tasks } },
    ).needs[0]!.actions;
    expect(startAnyway).toMatchObject({
      kind: "command",
      command: {
        _tag: "taskEdit",
        taskId: "task-12",
        dependsOn: [],
        seen: { state: "queued", attempts: 2 },
      },
    });
  });

  it("sends each press as the crew command it names", () => {
    const [carryOn, review, drop] = needing("stalled", { text: "why" }).needs[0]!.actions;
    expect([carryOn, review, drop]).toMatchObject([
      {
        kind: "command",
        command: { _tag: "message", handle: "backend", text: "Carry on with your task." },
      },
      { kind: "review", taskId: "task-12" },
      { kind: "command", command: { _tag: "discard", taskId: "task-12" } },
    ]);
  });
});

describe("crewRowModel: the lead", () => {
  it("says its job while at rest", () => {
    expect(lines(rowOf(quiet(), "lead"))).toEqual({
      line2: ["Plans the work, splits it into tasks and reviews each landing.", "muted"],
      line3: null,
      needs: [],
    });
  });

  it("holds its plan in its row, asking, with what you asked it", () => {
    const model = rowOf(
      crewSnapshotFixture({ attention: base.attention.filter((row) => row.kind === "plan") }),
      "lead",
      {
        ...AT_REST,
        asked: "Add seasons to the world",
      },
    );
    expect([model.plan, model.pose, model.needsYou, model.line2?.text]).toEqual([
      true,
      "needs",
      true,
      "Add seasons to the world",
    ]);
    expect(model.needs).toEqual([]);
  });

  it("says what it checks while it works", () => {
    const reviewing = quiet({
      board: {
        tasks: base.board.tasks.map((task) =>
          task.id === "task-12" ? { ...task, state: "review" } : task,
        ),
      },
    });
    expect(rowOf(reviewing, "lead", AT_WORK).line2).toEqual({
      text: "Checking Add pagination to /api/items",
      tone: "ink-2",
    });
  });

  it("says whose question it answers while it works", () => {
    const answering = quiet();
    expect(rowOf(answering, "lead", AT_WORK).line2).toEqual({
      text: "Answering Erik's question",
      tone: "ink-2",
    });
  });

  it("answers its own question right in its row", () => {
    const model = rowOf(
      quiet({
        attention: [
          {
            id: "question:lead",
            kind: "question",
            handle: "lead",
            taskId: null,
            text: "Should the old worlds get seasons too?",
            paths: [],
            host: null,
            at: "2026-09-27T09:30:00.000Z",
          },
        ],
      }),
      "lead",
    );
    expect(lines(model).needs).toEqual([
      ["Should the old worlds get seasons too?", "ink", ["Answer"]],
    ]);
    expect(model.needs[0]?.actions[0]).toMatchObject({
      kind: "answer",
      handle: "lead",
      taskId: null,
    });
  });

  it("says what nobody on the crew is named for, in the lead's row", () => {
    const orphan: CrewAttention = {
      id: "parked:gone",
      kind: "parked",
      handle: "someone-gone",
      taskId: null,
      text: "gone",
      paths: [],
      host: null,
      at: "2026-09-27T09:30:00.000Z",
    };
    expect(crewNeedsByHandle([orphan], base.crewmates).get("lead")).toEqual([orphan]);
    expect(
      crewNeedsByHandle(
        [orphan],
        base.crewmates.filter((mate) => mate.kind !== "lead"),
      ).get("backend"),
    ).toEqual([orphan]);
  });
});

describe("crewRowModel: the Mate's dev address", () => {
  it("says it shows this crewmate's work, with the way back", () => {
    const served = quiet({
      hosts: base.hosts.map((host) => ({ ...host, served: { by: "crewmate", handle: "backend" } })),
    });
    expect(rowOf(served, "backend").served).toMatchObject({
      line: { text: "Fen's dev address shows Backend's work", tone: "muted" },
      action: { label: "Back to Fen's", command: { _tag: "claimRelease", host: "appdev" } },
    });
    expect(rowOf(served, "frontend").served).toBeNull();
  });
});

describe("crewRowModel: never the engine's words", () => {
  it("draws no version, handle, task number or status word in any row", () => {
    const words = base.crewmates.flatMap((mate) => {
      const model = rowOf(base, mate.handle, AT_WORK);
      return [
        model.line2?.text,
        model.line3?.text,
        model.next,
        ...model.needs.flatMap((need) => [
          need.line.text,
          ...need.actions.map((action) => action.label),
        ]),
      ];
    });
    for (const word of words) {
      if (word === undefined || word === null) continue;
      expect(word).not.toMatch(/\bv\d+\b|@[a-z]|#\d+|\bIdle\b|\byour tree\b/u);
    }
  });
});

describe("crewActionOffered — a row's presses for a viewer who may not run its crewmate (D6)", () => {
  const lock = {
    login: "claudeAgent_eva",
    agentId: "claude-code",
    ownership: "someone-else",
  } as const;
  /** Backend's login is closed to the viewer; the rest of the crew is theirs. */
  const access = crewAccess({
    snapshot: crewSnapshotFixture({
      crewmates: base.crewmates.map((mate) =>
        mate.handle === "backend"
          ? { ...mate, login: { id: "claudeAgent_eva", label: "eva", agent: "claude-code" } }
          : mate,
      ),
    }),
    lockOf: (login) => (login === "claudeAgent_eva" ? lock : null),
    defaultLogin: "claudeAgent",
    reading: false,
  });
  const labelled = { label: "x", line: "x" };

  it.each([
    [
      "a command on Backend's task",
      { kind: "command", ...labelled, command: { _tag: "discard", taskId: "task-12" } },
      null,
      false,
      false,
    ],
    [
      "a command on Frontend's task",
      { kind: "command", ...labelled, command: { _tag: "askFix", taskId: "task-13" } },
      null,
      false,
      true,
    ],
    [
      "an answer to Backend",
      { kind: "answer", ...labelled, handle: "backend", taskId: "task-12" },
      null,
      false,
      false,
    ],
    [
      "an answer to Erik",
      { kind: "answer", ...labelled, handle: "erik", taskId: "task-14" },
      null,
      false,
      true,
    ],
    [
      "the review of Backend's work",
      { kind: "review", ...labelled, taskId: "task-12" },
      null,
      false,
      false,
    ],
    [
      "the review of Frontend's work",
      { kind: "review", ...labelled, taskId: "task-13" },
      null,
      false,
      true,
    ],
    [
      "an ask for the Mate in a chat the viewer runs",
      { kind: "ask", ...labelled, ask: "x" },
      null,
      false,
      true,
    ],
    [
      "an ask for the Mate in a chat they may not run",
      { kind: "ask", ...labelled, ask: "x" },
      lock,
      false,
      false,
    ],
    [
      "Try it that would start something",
      { kind: "try", ...labelled, handle: "backend" },
      null,
      false,
      false,
    ],
    [
      "Try it that opens what runs",
      { kind: "try", ...labelled, handle: "backend" },
      null,
      true,
      true,
    ],
  ] as const satisfies ReadonlyArray<
    readonly [string, CrewRowAction, CrewLock | null, boolean, boolean]
  >)("%s", (_name, action, askLock, tryOffered, offered) => {
    expect(crewActionOffered(action, access, askLock, tryOffered)).toBe(offered);
  });
});

it("shows the current and crew paths and offers a selected copy assignment", () => {
  const snapshot = needing("conversation-copy", {
    taskId: null,
    copyAssignment: {
      threadId: base.crewmates[0]!.currentThreadId!,
      currentPath: "/chosen/copy",
      crewPath: "/crew/copy",
      source: "crew-stint",
    },
  });
  const row = snapshot;
  expect(row.needs[0]?.line.text).toBe("Conversation points elsewhere");
  expect(row.needs[0]?.detail).toBe(
    "Current copy: /chosen/copy · Crew copy: /crew/copy · Crew copy set when the conversation opened",
  );
  expect(row.needs[0]?.actions).toEqual([
    {
      kind: "command",
      label: "Use crew copy",
      line: "This conversation uses its crew copy.",
      command: {
        _tag: "useCrewCopy",
        handle: "backend",
        threadId: base.crewmates[0]!.currentThreadId!,
        expectedPath: "/chosen/copy",
      },
    },
  ]);
});

it.each(
  Array.from(["dispatch", "checkpoint", "check", "landing"] as const, (kind) => ({
    title: `offers Continue for interrupted ${kind}, with Drop it only before landing`,
    kind,
  })),
)("$title", ({ kind }) => {
  const operation = {
    id: "op-1",
    crew: "crew",
    handle: "backend",
    taskId: "task-12",
    kind,
    stage: "dispatching",
    confirmedStage: "prepared",
    status: "interrupted" as const,
    startedBy: "person",
    resumeState: "working" as const,
    targets: {
      host: "appdev",
      path: "/crew/copy",
      ref: "crew/backend",
      threadId: null,
      commandId: null,
      attempt: 1,
    },
    result: null,
    detail: null,
    startedAt: "2026-10-03T10:00:00.000Z",
    updatedAt: "2026-10-03T10:00:00.000Z",
  };
  const row = needing("interrupted", { operation });
  expect(row.needs[0]?.actions.map((action) => action.label)).toEqual(
    kind === "landing" ? ["Continue"] : ["Continue", "Drop it"],
  );
  expect(row.needs[0]?.detail).toContain("Last confirmed: ready to start");
});

it("offers Continue for work the engine's crew could not finish, and Drop it for its task", () => {
  const engine = quiet({ revision: { epoch: 3, seq: 41 } });
  const row = (fields: Partial<CrewAttention>) =>
    needing(
      "interrupted",
      { id: "effect:crew.check:task-12", text: "the check could not run", ...fields },
      engine,
    ).needs[0];
  expect(row({})?.line.text).toBe("Interrupted · the check could not run");
  expect(row({})?.actions).toMatchObject([
    {
      label: "Continue",
      command: {
        _tag: "operationContinue",
        handle: "backend",
        operationId: "effect:crew.check:task-12",
      },
    },
    {
      label: "Drop it",
      command: {
        _tag: "operationDiscard",
        handle: "backend",
        operationId: "effect:crew.check:task-12",
      },
    },
  ]);
  expect(row({ taskId: null })?.actions.map((action) => action.label)).toEqual(["Continue"]);
});

it("names a redeploy the engine's crew could not read, offering to thaw its service", () => {
  const engine = quiet({ revision: { epoch: 3, seq: 41 } });
  const [need] = needing(
    "deploy-unreadable",
    { id: "deploy-unreadable:appdev", taskId: null, host: "appdev" },
    engine,
  ).needs;
  expect(need?.line.text).toBe("The redeploy of appdev can't be read. Thaw it if it ended.");
  expect(need?.actions).toMatchObject([{ command: { _tag: "thawHost", host: "appdev" } }]);
});

it("offers a selected rebuild for a missing crew copy", () => {
  const row = needing("copy-missing", { taskId: null });
  expect(row.needs[0]?.actions.map((action) => action.label)).toEqual(["Rebuild crew copy"]);
});

it.each([
  ["checkpoint", "committing", "Preserving its work"],
  ["check", "checking", "Checking its work"],
  ["landing", "landing", "Adding its work to Fen's code"],
] as const)("shows a running %s even after the agent's turn ended", (kind, stage, words) => {
  const operation = {
    id: "pending",
    crew: "crew",
    handle: "backend",
    taskId: null,
    kind,
    stage,
    confirmedStage: "prepared",
    status: "running" as const,
    startedBy: "person",
    resumeState: "working" as const,
    targets: {
      host: "appdev",
      path: "/crew/copy",
      ref: "crew/backend",
      threadId: null,
      commandId: null,
      attempt: 1,
    },
    result: null,
    detail: null,
    startedAt: "2026-10-03T10:00:00.000Z",
    updatedAt: "2026-10-03T10:00:00.000Z",
  };
  const row = rowOf(
    quiet({ board: { ...base.board, tasks: [] }, operations: [operation] }),
    "backend",
  );
  expect(row.line3?.text).toBe(words);
  expect(row.pose).toBe("working");
});

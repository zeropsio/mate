import { ConversationId, RequestId, runId, type RunEnd } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import { conversationRowOf, restartLine } from "./conversationRow.ts";
import type { ConversationView, ViewRequest, ViewRun } from "./conversationView.ts";

const c = ConversationId.make("mate");
const ana = { kind: "person", subject: "zerops:ana" } as const;
/** A token shaped like GitHub's, made from parts. */
const token = ["ghp", "_", "Q".repeat(12), "7".repeat(12)].join("");
const revision = { environmentId: "env-1", epoch: 7 };

function run(n: number, patch: Partial<ViewRun> = {}): ViewRun {
  return {
    id: runId(c, n),
    ordinal: n,
    state: "running",
    trigger: { kind: "wake", cause: "standup", wakeId: null },
    principal: ana,
    end: null,
    endSource: null,
    queuedAt: 100,
    admittedAt: 110,
    startedAt: 120,
    endedAt: null,
    unresponsiveSince: null,
    ...patch,
  };
}

function ended(n: number, end: RunEnd): ViewRun {
  return run(n, { state: "ended", end, endSource: "agent", endedAt: 500 });
}

function view(patch: Partial<ConversationView> = {}): ConversationView {
  return {
    conversationId: c,
    seq: 42,
    agent: {
      instanceId: "claudeAgent",
      driver: "claudeAgent",
      model: "m1",
      profile: { kind: "mate" },
    },
    archived: false,
    createdAt: 1,
    updatedAt: 900,
    activeRun: null,
    queued: [],
    lastEnded: null,
    pausedUntil: null,
    openRequests: [],
    lastPerson:
      patch.lastPerson === undefined
        ? { text: "Deploy the api\nthen tell me", at: 100 }
        : patch.lastPerson,
    // What the person typed: their latest message, unless a case says a page sent it.
    lastAsked:
      patch.lastAsked === undefined
        ? patch.lastPerson === undefined
          ? { text: "Deploy the api\nthen tell me", at: 100 }
          : patch.lastPerson
        : patch.lastAsked,
    // The latest ask whoever made it: the person's, unless a case says another Mate asked since.
    latestAsk:
      patch.latestAsk !== undefined
        ? patch.latestAsk
        : patch.lastAsked === undefined
          ? patch.lastPerson === undefined
            ? { text: "Deploy the api\nthen tell me", at: 100 }
            : patch.lastPerson
          : patch.lastAsked,
    awaits: [],
    lastAgent: { text: `Deployed, pushed with ${token}.`, at: 400 },
    liveCall: null,
    background: null,
    ...patch,
  };
}

function request(ask: ViewRequest["ask"]): ViewRequest {
  return { id: RequestId.make("q1"), runId: runId(c, 1), at: 300, ask, answerable: true };
}

/** The agent asked the person for a value only they have. */
const stripeAsk: ViewRequest["ask"] = {
  kind: "vault",
  key: "STRIPE_SECRET_KEY",
  scope: { kind: "shared" },
  sensitive: true,
  reason: "Stripe charges cards.",
};

const helperWork = { title: "Review the diff", of: "helper", since: 450 } as const;

function job(title: string, since: number) {
  return { title, of: "mate", since } as const;
}

function cut(patch: Partial<Extract<RunEnd, { kind: "cut-by-restart" }>> = {}) {
  return {
    kind: "cut-by-restart" as const,
    continuedBy: null,
    words: "Fen was restarted by Ana at 2026-10-07T10:00:00.000Z.",
    ...patch,
  };
}

function stateOf(patch: Partial<ConversationView>) {
  return conversationRowOf(view(patch), revision).state;
}

// witness: apps/server/src/engine/read/conversationRow.ts | const words = rowText(messagePreviewText(line)); → const words = rowText(line);
it("RS4: A conversation's row is named by the first line of its latest ask that has words once its markdown is read, a rule or a code fence having none and a message of pictures alone reading as their count, never by a request a page sent for the person", () => {
  const typed = { text: "Build the tea catalog", at: 100 };
  const fromPanel = { text: "Open crew ports on appdev", at: 200 };
  const picture = [{ type: "image", mimeType: "image/png" }] as const;
  const rows: ReadonlyArray<[string, Partial<ConversationView>, string | null]> = [
    ["the person's latest message", {}, "Deploy the api"],
    ["typed beside a page's request", { lastPerson: fromPanel, lastAsked: typed }, typed.text],
    ["only a page's request", { lastPerson: fromPanel, lastAsked: null }, null],
    [
      "a picture and words",
      {
        lastPerson: {
          text: "[Picture 1]\nEngine check 9: what number is in the picture?",
          attachments: picture,
          at: 800,
        },
      },
      "Engine check 9: what number is in the picture?",
    ],
    [
      "a picture alone",
      { lastPerson: { text: "[Picture 1]", attachments: picture, at: 800 } },
      "1 image",
    ],
    [
      "words in markdown",
      { lastPerson: { text: "Deploy **the api**", attachments: [], at: 800 } },
      "Deploy the api",
    ],
    [
      "a rule before the words",
      { lastPerson: { text: "---\nDeploy the api", attachments: [], at: 800 } },
      "Deploy the api",
    ],
    [
      "a code fence before the words",
      { lastPerson: { text: "```sh\nnpm run build\n```", attachments: [], at: 800 } },
      "npm run build",
    ],
  ];
  for (const [name, patch, subject] of rows) {
    expect(conversationRowOf(view(patch), revision).subject, name).toBe(subject);
  }
});

// witness: apps/server/src/engine/read/conversationRow.ts | view.lastAgent !== null && view.latestAsk !== null && view.lastAgent.at < view.latestAsk.at → view.lastAgent !== null && view.latestAsk !== null && view.lastAgent.at > view.latestAsk.at
it("RS5: A row's snippet is the agent's latest words with their credentials masked, and none when those words came before the latest ask", () => {
  const asked = { text: "Add a print button to each tea's page", at: 100 };
  for (const [lastAgent, snippet] of [
    [{ text: "The tea catalog is live.", at: 400 }, "The tea catalog is live."],
    [{ text: "The shop front is built.", at: 50 }, null],
  ] as const) {
    const row = conversationRowOf(
      view({
        lastPerson: asked,
        lastAsked: asked,
        lastAgent,
        lastEnded: ended(2, { kind: "stopped", by: ana }),
      }),
      revision,
    );
    expect(row.snippet, lastAgent.text).toBe(snippet);
  }

  const masked = conversationRowOf(view(), revision).snippet;
  expect(masked).toMatch(/^Deployed, pushed with /u);
  expect(masked).not.toContain(token);
});

// witness: apps/server/src/engine/read/conversationRow.ts | if (active !== null && (active.state === "running" || active.state === "waiting")) { → if (active !== null) {
it("RS6: While its run is on the row reads working since the run started, and queued since it was asked while the run is admitted, being sent or waiting its turn", () => {
  const rows: ReadonlyArray<[string, Partial<ConversationView>, unknown]> = [
    ["a run is on", { activeRun: run(1) }, { kind: "working", since: 120, waitsOnHelpers: false }],
    [
      "a run is being sent",
      { activeRun: run(1, { state: "sending", startedAt: null }) },
      { kind: "queued", since: 100 },
    ],
    [
      "a run waits its turn",
      { queued: [run(2, { state: "queued", queuedAt: 150 })] },
      { kind: "queued", since: 150 },
    ],
  ];
  for (const [name, patch, state] of rows) {
    expect(stateOf(patch), name).toEqual(state);
  }
});

// witness: apps/server/src/engine/read/conversationRow.ts | (request.runId === active?.id || helperWaitsOn(request)), → helperWaitsOn(request),
it("RS7: The row waits on a question or an approval its running turn asks, in the ask's words", () => {
  const rows: ReadonlyArray<[string, Partial<ConversationView>, unknown]> = [
    [
      "a question",
      {
        activeRun: run(1, { state: "waiting" }),
        openRequests: [
          request({
            kind: "question",
            questions: [{ question: "Which region?" }],
            dismissible: true,
          }),
        ],
      },
      { kind: "waiting", on: "question", words: "Which region?" },
    ],
    [
      "an approval",
      {
        activeRun: run(1, { state: "waiting" }),
        openRequests: [
          request({ kind: "approval", requestKind: "command", detail: "rm -rf dist" }),
        ],
      },
      { kind: "waiting", on: "approval", words: "rm -rf dist" },
    ],
  ];
  for (const [name, patch, state] of rows) {
    expect(stateOf(patch), name).toEqual(state);
  }
});

// witness: apps/server/src/engine/read/conversationRow.ts | const card = cardAsk(view); → const card = active === null ? undefined : cardAsk(view);
it("RS8: A value asked of the person makes the row wait on them in the ask's words once the run that asked ended, and the row reads working while the agent works on", () => {
  const rows: ReadonlyArray<[string, Partial<ConversationView>, unknown]> = [
    [
      "its run ended",
      { lastEnded: ended(1, { kind: "completed" }), openRequests: [request(stripeAsk)] },
      { kind: "waiting", on: "vault", words: "Stripe charges cards." },
    ],
    [
      "the agent works on",
      { activeRun: run(2), openRequests: [request(stripeAsk)] },
      { kind: "working", since: 120, waitsOnHelpers: false },
    ],
  ];
  for (const [name, patch, state] of rows) {
    expect(stateOf(patch), name).toEqual(state);
  }
});

// witness: apps/server/src/engine/read/conversationRow.ts | request.answerable && → request.answerable !== undefined &&
it("RS9: After its run ended, an approval or a question a helper waits on makes the row wait on the person, while a question asked by message or an ask nobody can answer any more leaves the helpers working", () => {
  const helperAsk = { kind: "approval", requestKind: "command", detail: "wc -l *" } as never;
  const helpersWorking = {
    kind: "working",
    since: 500,
    waitsOnHelpers: true,
    work: { items: [], count: 0, helpers: 0 },
  };
  const rows: ReadonlyArray<[string, ReadonlyArray<ViewRequest>, unknown]> = [
    [
      "a helper's approval",
      [request(helperAsk)],
      { kind: "waiting", on: "approval", words: "wc -l *" },
    ],
    [
      "a question asked by message",
      [
        request({
          kind: "question",
          questions: [{ question: "Which region?" }],
          dismissible: true,
        }),
      ],
      helpersWorking,
    ],
    [
      "an ask nobody can answer any more",
      [{ ...request(helperAsk), answerable: false }],
      helpersWorking,
    ],
  ];
  for (const [name, openRequests, state] of rows) {
    expect(
      stateOf({ lastEnded: ended(1, { kind: "completed" }), background: "working", openRequests }),
      name,
    ).toEqual(state);
  }
});

// witness: apps/server/src/engine/read/conversationRow.ts | if (view.pausedUntil !== null) { → if (typeof view.pausedUntil === "number") {
it("RS10: A usage limit holding the queue reads paused until its reset, and paused with no reset when the reset is unknown", () => {
  const rows: ReadonlyArray<[string, Partial<ConversationView>, unknown]> = [
    [
      "a known reset",
      { lastEnded: ended(1, { kind: "usage-limit", resetsAt: 9_000 }), pausedUntil: 9_000 },
      { kind: "paused", resetsAt: 9_000 },
    ],
    [
      "an unknown reset",
      { lastEnded: ended(1, { kind: "usage-limit", resetsAt: null }), pausedUntil: "unknown" },
      { kind: "paused", resetsAt: null },
    ],
  ];
  for (const [name, patch, state] of rows) {
    expect(stateOf(patch), name).toEqual(state);
  }
});

// witness: apps/server/src/engine/read/conversationRow.ts | items: [...helpers.slice(0, ROW_WORK_NAMED), ...jobs.slice(0, ROW_WORK_NAMED)] → items: work.slice(0, ROW_WORK_NAMED)
it("RS11: Work its turn started keeps the row working after the turn, naming the first five of its helpers and the first five of its own jobs apart, oldest first, each title cut to what shares a line, and counting them all and its helpers; the agent's own turn due on them reads working too", () => {
  const completed = ended(1, { kind: "completed" });
  expect(stateOf({ lastEnded: completed, turnDue: true }), "the agent's own turn is due").toEqual({
    kind: "working",
    since: 500,
    waitsOnHelpers: true,
    turnDue: true,
    work: { items: [], count: 0, helpers: 0 },
  });

  const helper = (n: number) => ({ ...helperWork, title: `Helper ${String(n)}`, since: 400 + n });
  const check = (n: number) => job(`Check ${String(n)}`, 400 + n);
  const rows: ReadonlyArray<[string, NonNullable<ConversationView["work"]>, unknown]> = [
    ["a helper", [helperWork], { items: [helperWork], count: 1, helpers: 1 }],
    [
      "few, oldest first",
      [job("Final batched browser check", 410), helperWork],
      { items: [job("Final batched browser check", 410), helperWork], count: 2, helpers: 1 },
    ],
    [
      "six of its own jobs",
      [1, 2, 3, 4, 5, 6].map(check),
      { items: [1, 2, 3, 4, 5].map(check), count: 6, helpers: 0 },
    ],
    [
      "six helpers and two of its own jobs",
      [
        ...[1, 2, 3, 4, 5, 6].map(helper),
        job("Run the test suite", 410),
        job("Serve the preview", 411),
      ],
      {
        items: [
          ...[1, 2, 3, 4, 5].map(helper),
          job("Run the test suite", 410),
          job("Serve the preview", 411),
        ],
        count: 8,
        helpers: 6,
      },
    ],
    [
      "a long title",
      [job(`Check ${"every page ".repeat(20)}`, 410)],
      { items: [job(`Check ${"every page ".repeat(10)}eve…`, 410)], count: 1, helpers: 0 },
    ],
  ];
  for (const [name, work, expected] of rows) {
    expect(stateOf({ lastEnded: completed, background: "working", work }), name).toEqual({
      kind: "working",
      since: 500,
      waitsOnHelpers: true,
      work: expected,
    });
  }
});

// witness: apps/server/src/engine/read/conversationRow.ts | return isRefusedAttempt(end) ? null : end.reason; → return isRefusedAttempt(end) ? end.reason : null;
it("RS12: A last run that failed or crashed reads failed with its reason, and a completed or stopped one reads idle, as does a conversation where nothing ever ran", () => {
  const rows: ReadonlyArray<[string, Partial<ConversationView>, unknown]> = [
    ["nothing ever ran", {}, { kind: "idle" }],
    [
      "failed",
      { lastEnded: ended(1, { kind: "failed", reason: "Model not found.", next: null }) },
      { kind: "failed", errorLine: "Model not found." },
    ],
    [
      "crashed",
      { lastEnded: ended(1, { kind: "crashed", reason: "Claude exited with code 1." }) },
      { kind: "failed", errorLine: "Claude exited with code 1." },
    ],
    ["completed", { lastEnded: ended(1, { kind: "completed" }) }, { kind: "idle" }],
    ["stopped", { lastEnded: ended(1, { kind: "stopped", by: ana }) }, { kind: "idle" }],
  ];
  for (const [name, patch, state] of rows) {
    expect(stateOf(patch), name).toEqual(state);
  }
});

// witness: apps/server/src/engine/read/conversationRow.ts | const stopping = view.stopping === true ? { stopping: true as const } : {}; → const stopping = active !== null && view.stopping === true ? { stopping: true as const } : {};
it("RS13: A person's Stop in force says stopping on the working row, of its run or of the helpers its turn left, and a Stop with nothing left to end reads idle", () => {
  const rows: ReadonlyArray<[string, Partial<ConversationView>, unknown]> = [
    [
      "the run on",
      { activeRun: run(1), stopping: true },
      { kind: "working", since: 120, waitsOnHelpers: false, stopping: true },
    ],
    [
      "the helpers its turn left",
      {
        lastEnded: ended(1, { kind: "stopped", by: ana }),
        background: "working",
        work: [helperWork],
        stopping: true,
      },
      {
        kind: "working",
        since: 500,
        waitsOnHelpers: true,
        stopping: true,
        work: { items: [helperWork], count: 1, helpers: 1 },
      },
    ],
    [
      "nothing left to end",
      { lastEnded: ended(1, { kind: "stopped", by: ana }), stopping: true },
      { kind: "idle" },
    ],
  ];
  for (const [name, patch, state] of rows) {
    expect(stateOf(patch), name).toEqual(state);
  }
});

// witness: apps/server/src/engine/read/conversationRow.ts | if (view.runDue === true) { → if (view.runDue === true && view.background === "working") {
it("RS14: Answering a request takes the row from waiting straight to working, never through idle", () => {
  const answered = ended(1, { kind: "completed" });
  const valueCommits = [
    view({ lastEnded: answered, openRequests: [request(stripeAsk)] }),
    view({ lastEnded: answered, runDue: true }),
    view({ lastEnded: answered, activeRun: run(2) }),
  ];
  const rows: ReadonlyArray<[string, ReadonlyArray<ConversationView>]> = [
    ["a value saved", valueCommits],
    ["a value declined", valueCommits],
    [
      "a question answered",
      [
        view({
          activeRun: run(1, { state: "waiting" }),
          openRequests: [
            request({
              kind: "question",
              questions: [{ question: "Which region?" }],
              dismissible: false,
            }),
          ],
        }),
        view({ activeRun: run(1, { state: "waiting" }) }),
        view({ activeRun: run(1) }),
      ],
    ],
  ];
  for (const [name, commits] of rows) {
    expect(
      commits.map((each) => conversationRowOf(each, revision).state.kind),
      name,
    ).toEqual(["waiting", "working", "working"]);
  }
});

// witness: apps/server/src/engine/read/conversationRow.ts | return end.notContinued === undefined → return end.continuedBy !== null
it("RS15: A run a restart cut says what the platform said and that it carries on while its continuation runs, or, when it was not continued, why, as the row's failure; without the platform's words it says the Mate restarted", () => {
  expect(restartLine(cut({ continuedBy: runId(c, 2) }))).toBe(
    "Fen was restarted by Ana at 2026-10-07T10:00:00.000Z. The run was cut and carries on where it stopped.",
  );
  expect(
    stateOf({ activeRun: run(2), lastEnded: ended(1, cut({ continuedBy: runId(c, 2) })) }).kind,
  ).toBe("working");

  expect(stateOf({ lastEnded: ended(1, cut({ notContinued: "a newer person message" })) })).toEqual(
    {
      kind: "failed",
      errorLine:
        "Fen was restarted by Ana at 2026-10-07T10:00:00.000Z. The run was cut and not continued (a newer person message): send a message to go on.",
    },
  );

  expect(restartLine({ kind: "cut-by-restart", continuedBy: null })).toBe(
    "The Mate restarted. The run was cut and carries on where it stopped.",
  );
});

// witness: apps/server/src/engine/read/conversationRow.ts | (latest, run) => (latest === null || run.ordinal > latest.ordinal ? run : latest), → (latest, run) => (latest === null || run.ordinal < latest.ordinal ? run : latest),
it("RS16: The row names the run on and, as its latest run, the one with the highest ordinal and how it ended", () => {
  const row = conversationRowOf(
    view({ activeRun: run(3), lastEnded: ended(2, { kind: "completed" }) }),
    revision,
  );
  expect(row.activeRunId).toBe(runId(c, 3));
  expect(row.latestRun).toEqual({
    id: runId(c, 3),
    end: null,
    endedAt: null,
    turnState: "running",
  });
});

// witness: apps/server/src/engine/read/conversationRow.ts | view.openRequests.find((request) => request.runId === view.activeRun?.id) ?? → view.openRequests.find((request) => request.runId !== view.activeRun?.id) ??
it("RS17: The row says when the agent asked what its running turn waits on", () => {
  const row = conversationRowOf(
    view({
      activeRun: run(1, { state: "waiting" }),
      openRequests: [request({ kind: "plan", planItemId: "p" as never })],
    }),
    revision,
  );
  expect(row.askedAt).toBe(300);
});

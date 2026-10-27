import { describe, expect, it } from "vite-plus/test";
import { ConversationId, RequestId, runId, type RunEnd } from "@t3tools/contracts";

import { conversationRowOf, restartLine } from "./conversationRow.ts";
import type { ConversationView, ViewRequest, ViewRun } from "./conversationView.ts";

const c = ConversationId.make("mate");
const ana = { kind: "person", subject: "zerops:ana" } as const;
/** A token shaped like GitHub's, made from parts. */
const token = ["ghp", "_", "Q".repeat(12), "7".repeat(12)].join("");

const run = (n: number, patch: Partial<ViewRun> = {}): ViewRun => ({
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
});

const ended = (n: number, end: RunEnd): ViewRun =>
  run(n, { state: "ended", end, endSource: "agent", endedAt: 500 });

const view = (patch: Partial<ConversationView> = {}): ConversationView => ({
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
  // What the person typed: their latest message, unless a test says a page sent it.
  lastAsked:
    patch.lastAsked === undefined
      ? patch.lastPerson === undefined
        ? { text: "Deploy the api\nthen tell me", at: 100 }
        : patch.lastPerson
      : patch.lastAsked,
  lastAgent: { text: `Deployed, pushed with ${token}.`, at: 400 },
  liveCall: null,
  background: null,
  ...patch,
});

const request = (ask: ViewRequest["ask"]): ViewRequest => ({
  id: RequestId.make("q1"),
  runId: runId(c, 1),
  at: 300,
  ask,
  answerable: true,
});

/** The agent asked the person for a value only they have. */
const stripeAsk: ViewRequest["ask"] = {
  kind: "vault",
  key: "STRIPE_SECRET_KEY",
  scope: { kind: "shared" },
  sensitive: true,
  reason: "Stripe charges cards.",
};

const revision = { environmentId: "env-1", epoch: 7 };

const helperWork = { title: "Review the diff", of: "helper", since: 450 } as const;

describe("the menu row", () => {
  it("reads the person's latest message's first line as its subject and the agent's last words, masked, as its snippet", () => {
    const row = conversationRowOf(view(), revision);
    expect(row.subject).toBe("Deploy the api");
    expect(row.snippet).toMatch(/^Deployed, pushed with /u);
    expect(row.snippet).not.toContain(token);
    expect(row.revision).toEqual({ environmentId: "env-1", epoch: 7, seq: 42 });
    expect(row.at).toBe(900);
  });

  // Run 2: a Stop before the Mate said anything left the row reading "now" over its answer to the
  // ask before, sixteen minutes old.
  it.each([
    {
      name: "its words answer the person's latest message",
      lastAgent: { text: "The tea catalog is live.", at: 400 },
      snippet: "The tea catalog is live.",
    },
    {
      name: "its words came before the person's latest message",
      lastAgent: { text: "The shop front is built.", at: 50 },
      snippet: null,
    },
  ])("carries the agent's words as its snippet only when $name", ({ lastAgent, snippet }) => {
    const asked = { text: "Add a print button to each tea's page", at: 100 };
    const row = conversationRowOf(
      view({
        lastPerson: asked,
        lastAsked: asked,
        lastAgent,
        lastEnded: ended(2, { kind: "stopped", by: ana }),
      }),
      revision,
    );
    expect(row.snippet).toBe(snippet);
  });

  it("never names the conversation by a request a page sent for the person", () => {
    const typed = { text: "Build the tea catalog", at: 100 };
    const fromPanel = { text: "Open crew ports on appdev", at: 200 };
    expect(
      conversationRowOf(view({ lastPerson: fromPanel, lastAsked: typed }), revision).subject,
    ).toBe("Build the tea catalog");
    expect(
      conversationRowOf(view({ lastPerson: fromPanel, lastAsked: null }), revision).subject,
    ).toBeNull();
  });

  it.each([
    {
      name: "Supervised once a person picked it",
      set: "approval-required",
      reads: "approval-required",
    },
    { name: "Full access once a person picked it", set: "full-access", reads: "full-access" },
    { name: "nothing while no person set it", set: null, reads: undefined },
  ] as const)("says the access its agent works with: $name", ({ set, reads }) => {
    expect(conversationRowOf(view({ runtimeMode: set }), revision).runtimeMode).toBe(reads);
  });

  it("names the pool container its agent leased, and nothing while it holds none", () => {
    const lease = { alias: "webpool-3", pool: "webpool", branch: "feat-x" };
    expect(conversationRowOf(view({ lease }), revision).lease).toEqual(lease);
    expect(conversationRowOf(view({ lease: null }), revision)).not.toHaveProperty("lease");
  });

  // Lab A.3, 2026-10-25: a conversation archived by Archive and start fresh read live in the menu
  // once nobody held it, so a review's Fix opened it on a hidden composer.
  it("says the conversation is archived, and nothing while it is not", () => {
    expect(conversationRowOf(view({ archived: true }), revision).archived).toBe(true);
    expect(conversationRowOf(view({ archived: false }), revision)).not.toHaveProperty("archived");
  });

  // Milo, 2026-10-08: the row read "[Picture 1]" for a pasted picture and its question.
  it.each([
    {
      name: "a picture and words",
      person: {
        text: "[Picture 1]\nEngine check 9: what number is in the picture?",
        attachments: [{ type: "image", mimeType: "image/png" }],
      },
      said: "Engine check 9: what number is in the picture?",
    },
    {
      name: "a picture alone",
      person: { text: "[Picture 1]", attachments: [{ type: "image", mimeType: "image/png" }] },
      said: "1 image",
    },
    {
      name: "words in markdown",
      person: { text: "Deploy **the api**", attachments: [] },
      said: "Deploy the api",
    },
    {
      name: "a rule before the words",
      person: { text: "---\nDeploy the api", attachments: [] },
      said: "Deploy the api",
    },
    {
      name: "a code fence before the words",
      person: { text: "```sh\nnpm run build\n```", attachments: [] },
      said: "npm run build",
    },
  ])(
    "reads the person's message as V1's row quotes it, never a picture's label: $name",
    ({ person, said }) => {
      const lastPerson = { ...person, at: 800 };
      expect(conversationRowOf(view({ lastPerson }), revision).subject).toBe(said);
    },
  );

  it.each<[string, Partial<ConversationView>, unknown]>([
    ["nothing ever ran: idle", {}, { kind: "idle" }],
    [
      "a run is on: working since it started",
      { activeRun: run(1) },
      { kind: "working", since: 120, waitsOnHelpers: false },
    ],
    [
      "a run is admitted or being sent: queued since it was asked",
      { activeRun: run(1, { state: "sending", startedAt: null }) },
      { kind: "queued", since: 100 },
    ],
    [
      "a run waits its turn: queued",
      { queued: [run(2, { state: "queued", queuedAt: 150 })] },
      { kind: "queued", since: 150 },
    ],
    [
      "the agent asks a question: waiting on it, in its words",
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
      "the agent asks for an approval: waiting on it",
      {
        activeRun: run(1, { state: "waiting" }),
        openRequests: [
          request({ kind: "approval", requestKind: "command", detail: "rm -rf dist" }),
        ],
      },
      { kind: "waiting", on: "approval", words: "rm -rf dist" },
    ],
    [
      "the agent asked the person for a value and its run ended: waiting on them, in the ask's words",
      {
        lastEnded: ended(1, { kind: "completed" }),
        openRequests: [request(stripeAsk)],
      },
      { kind: "waiting", on: "vault", words: "Stripe charges cards." },
    ],
    [
      "a value is asked while the agent works on: working, the ask waits for the run to end",
      { activeRun: run(2), openRequests: [request(stripeAsk)] },
      { kind: "working", since: 120, waitsOnHelpers: false },
    ],
    [
      "a usage limit holds the queue: paused until its reset",
      { lastEnded: ended(1, { kind: "usage-limit", resetsAt: 9_000 }), pausedUntil: 9_000 },
      { kind: "paused", resetsAt: 9_000 },
    ],
    [
      "a usage limit with no known reset: paused, reset unknown",
      { lastEnded: ended(1, { kind: "usage-limit", resetsAt: null }), pausedUntil: "unknown" },
      { kind: "paused", resetsAt: null },
    ],
    [
      "a helper works on after the turn: working, on helpers",
      { lastEnded: ended(1, { kind: "completed" }), background: "working", work: [helperWork] },
      {
        kind: "working",
        since: 500,
        waitsOnHelpers: true,
        work: { items: [helperWork], count: 1, helpers: 1 },
      },
    ],
    [
      "its helpers finished and the agent's own turn on them is due: working, on that turn",
      { lastEnded: ended(1, { kind: "completed" }), turnDue: true },
      {
        kind: "working",
        since: 500,
        waitsOnHelpers: true,
        turnDue: true,
        work: { items: [], count: 0, helpers: 0 },
      },
    ],
    [
      "the last run failed: failed, with its reason",
      { lastEnded: ended(1, { kind: "failed", reason: "Model not found.", next: null }) },
      { kind: "failed", errorLine: "Model not found." },
    ],
    [
      "the agent's process died: failed, with the bridge's words",
      { lastEnded: ended(1, { kind: "crashed", reason: "Claude exited with code 1." }) },
      { kind: "failed", errorLine: "Claude exited with code 1." },
    ],
    ["a completed run: idle", { lastEnded: ended(1, { kind: "completed" }) }, { kind: "idle" }],
    [
      "a stopped run: idle",
      { lastEnded: ended(1, { kind: "stopped", by: ana }) },
      { kind: "idle" },
    ],
    [
      "a person's Stop is ending the run on: working, and saying it is stopping",
      { activeRun: run(1), stopping: true },
      { kind: "working", since: 120, waitsOnHelpers: false, stopping: true },
    ],
    [
      "a person's Stop is ending the helpers its turn left: working on helpers, and saying it is stopping",
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
      "a Stop that has nothing left to end: idle, never stopping",
      { lastEnded: ended(1, { kind: "stopped", by: ana }), stopping: true },
      { kind: "idle" },
    ],
  ])("%s", (_title, patch, state) => {
    expect(conversationRowOf(view(patch), revision).state).toEqual(state);
  });

  it("names the run on and the latest run with how it ended", () => {
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

  it("says when the agent asked", () => {
    const row = conversationRowOf(
      view({
        activeRun: run(1, { state: "waiting" }),
        openRequests: [request({ kind: "plan", planItemId: "p" as never })],
      }),
      revision,
    );
    expect(row.askedAt).toBe(300);
  });
});

// Eli, 2026-10-14: the row read "Waiting for its helpers" over four of its own background checks,
// and the card at the conversation's end named none of them.
describe("the menu row while work its turn started runs on", () => {
  const job = (title: string, since: number) => ({ title, of: "mate", since }) as const;
  it.each([
    {
      name: "names each piece of what it waits on, oldest first, while there are few",
      work: [job("Final batched browser check", 410), helperWork],
      expected: {
        items: [job("Final batched browser check", 410), helperWork],
        count: 2,
        helpers: 1,
      },
    },
    {
      // The helpers panel lists each; the card lists five of them on rows of their own.
      name: "names the first five of what it waits on and counts them all",
      work: [1, 2, 3, 4, 5, 6].map((n) => job(`Check ${String(n)}`, 400 + n)),
      expected: {
        items: [1, 2, 3, 4, 5].map((n) => job(`Check ${String(n)}`, 400 + n)),
        count: 6,
        helpers: 0,
      },
    },
    {
      // Eli, 2026-10-14: three helpers and two of its own jobs read as "… · and 4 more — Its helpers".
      name: "names the first five of its helpers and of its own jobs apart, and counts its helpers",
      work: [
        ...[1, 2, 3, 4, 5, 6].map((n) => ({
          ...helperWork,
          title: `Helper ${String(n)}`,
          since: 400 + n,
        })),
        job("Run the test suite", 410),
        job("Serve the preview", 411),
      ],
      expected: {
        items: [
          ...[1, 2, 3, 4, 5].map((n) => ({
            ...helperWork,
            title: `Helper ${String(n)}`,
            since: 400 + n,
          })),
          job("Run the test suite", 410),
          job("Serve the preview", 411),
        ],
        count: 8,
        helpers: 6,
      },
    },
    {
      name: "cuts a long title to what shares a line",
      work: [job(`Check ${"every page ".repeat(20)}`, 410)],
      expected: {
        items: [job(`Check ${"every page ".repeat(10)}eve…`, 410)],
        count: 1,
        helpers: 0,
      },
    },
  ])("$name", ({ work, expected }) => {
    const row = conversationRowOf(
      view({ lastEnded: ended(1, { kind: "completed" }), background: "working", work }),
      revision,
    );
    expect(row.state).toEqual({
      kind: "working",
      since: 500,
      waitsOnHelpers: true,
      work: expected,
    });
  });
});

// Milo's final engine run (seg E +1:32): helpers waited on an approval while the face said
// "Waiting for its helpers", with nothing to press.
describe("the menu row while a helper asks", () => {
  const helperAsk = { kind: "approval", requestKind: "command", detail: "wc -l *" } as never;
  it.each([
    {
      name: "a helper's approval after its run ended waits on the person",
      openRequests: [request(helperAsk)],
      state: { kind: "waiting", on: "approval", words: "wc -l *" },
    },
    {
      name: "a question asked by message after its run ended leaves the helpers working",
      openRequests: [
        request({
          kind: "question",
          questions: [{ question: "Which region?" }],
          dismissible: true,
        }),
      ],
      state: {
        kind: "working",
        since: 500,
        waitsOnHelpers: true,
        work: { items: [], count: 0, helpers: 0 },
      },
    },
    {
      name: "an ask nobody can answer any more leaves the helpers working",
      openRequests: [{ ...request(helperAsk), answerable: false }],
      state: {
        kind: "working",
        since: 500,
        waitsOnHelpers: true,
        work: { items: [], count: 0, helpers: 0 },
      },
    },
  ])("$name", ({ openRequests, state }) => {
    const row = conversationRowOf(
      view({
        lastEnded: ended(1, { kind: "completed" }),
        background: "working",
        openRequests: openRequests as ReadonlyArray<ViewRequest>,
      }),
      revision,
    );
    expect(row.state).toEqual(state);
  });
});

// Milo's run 9 (0.15.38): saving a value took both faces needs → done → idle → working, a step per
// commit. The answer's own commit arms the wake that tells the agent, due at once, so it is work.
describe("the menu row as a request is answered", () => {
  const answered = ended(1, { kind: "completed" });
  it.each([
    {
      request: "a value saved",
      commits: [
        view({ lastEnded: answered, openRequests: [request(stripeAsk)] }),
        view({ lastEnded: answered, runDue: true }),
        view({ lastEnded: answered, activeRun: run(2) }),
      ],
    },
    {
      request: "a value declined",
      commits: [
        view({ lastEnded: answered, openRequests: [request(stripeAsk)] }),
        view({ lastEnded: answered, runDue: true }),
        view({ lastEnded: answered, activeRun: run(2) }),
      ],
    },
    {
      request: "a question answered",
      commits: [
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
    },
  ])(
    "answering a request takes the row from waiting straight to working, never through idle: $request",
    ({ commits }) => {
      expect(commits.map((each) => conversationRowOf(each, revision).state.kind)).toEqual([
        "waiting",
        "working",
        "working",
      ]);
    },
  );
});

describe("a run a restart cut", () => {
  const cut = (patch: Partial<Extract<RunEnd, { kind: "cut-by-restart" }>> = {}) => ({
    kind: "cut-by-restart" as const,
    continuedBy: null,
    words: "Fen was restarted by Ana at 2026-10-07T10:00:00.000Z.",
    ...patch,
  });

  it("says why it was cut and that it carries on, while its continuation runs", () => {
    expect(restartLine(cut({ continuedBy: runId(c, 2) }))).toBe(
      "Fen was restarted by Ana at 2026-10-07T10:00:00.000Z. The run was cut and carries on where it stopped.",
    );
    const row = conversationRowOf(
      view({ activeRun: run(2), lastEnded: { ...ended(1, cut({ continuedBy: runId(c, 2) })) } }),
      revision,
    );
    expect(row.state.kind).toBe("working");
  });

  it("says why it was cut and why it was not continued, as the row's failure", () => {
    const row = conversationRowOf(
      view({ lastEnded: ended(1, cut({ notContinued: "a newer person message" })) }),
      revision,
    );
    expect(row.state).toEqual({
      kind: "failed",
      errorLine:
        "Fen was restarted by Ana at 2026-10-07T10:00:00.000Z. The run was cut and not continued (a newer person message): send a message to go on.",
    });
  });

  it("without the platform's evidence, says the Mate restarted", () => {
    expect(restartLine({ kind: "cut-by-restart", continuedBy: null })).toBe(
      "The Mate restarted. The run was cut and carries on where it stopped.",
    );
  });
});

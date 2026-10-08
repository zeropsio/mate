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
  lastPerson: { text: "Deploy the api\nthen tell me", at: 100 },
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

const revision = { environmentId: "env-1", epoch: 7 };

describe("the menu row", () => {
  it("reads the person's latest message's first line as its subject and the agent's last words, masked, as its snippet", () => {
    const row = conversationRowOf(view(), revision);
    expect(row.subject).toBe("Deploy the api");
    expect(row.snippet).toMatch(/^Deployed, pushed with /u);
    expect(row.snippet).not.toContain(token);
    expect(row.revision).toEqual({ environmentId: "env-1", epoch: 7, seq: 42 });
    expect(row.at).toBe(900);
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
      { lastEnded: ended(1, { kind: "completed" }), background: "working" },
      { kind: "working", since: 500, waitsOnHelpers: true },
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

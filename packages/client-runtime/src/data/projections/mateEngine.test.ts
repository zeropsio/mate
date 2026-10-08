import type { ConversationRow, Item, Request, RunRecord } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { describe, expect, it } from "vite-plus/test";

import {
  engineConversationId,
  engineConversationScopes,
  engineFactId,
  engineRowsScope,
  type EngineConversationKey,
} from "../families/mateEngine.ts";
import { emptyAccount, type AccountState, type Revision } from "../model.ts";
import { reduceAccount, type AccountInput, type Row } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import {
  engineHeader,
  engineRequest,
  engineRow,
  engineRun,
  noteItem,
  personItem,
} from "../__fixtures__/mateEngine.ts";
import { engineRows, engineThread, overlayEngineRow, overlayEngineShell } from "./mateEngine.ts";

const ENV = "env-ada";
const key: EngineConversationKey = { environmentId: ENV, conversationId: "thread-ada" };
const run1 = "thread-ada/r/1";

const apply = (state: AccountState, inputs: ReadonlyArray<AccountInput>) =>
  inputs.reduce((next, input) => reduceAccount(next, input).state, state);
const revision = (seq: number): Revision => ({
  kind: "mate-conversation",
  environmentId: ENV,
  epoch: 1,
  seq,
});

function held(
  records: {
    readonly runs?: ReadonlyArray<RunRecord>;
    readonly items?: ReadonlyArray<Item>;
    readonly requests?: ReadonlyArray<Request>;
    readonly header?: Parameters<typeof engineHeader>[1];
  },
  extra: ReadonlyArray<AccountInput> = [],
): AccountState {
  const scopes = Object.values(engineConversationScopes(key));
  const rows: Row[] = [
    {
      family: "mateEngineConversation",
      id: engineConversationId(key),
      value: {
        environmentId: ENV,
        header: engineHeader("thread-ada", records.header),
        window: { oldestOrdinal: 1, earlier: false },
      },
      revision: revision(99),
    },
    ...(records.runs ?? []).map((run): Row => ({
      family: "mateEngineRun",
      id: engineFactId(ENV, run.id),
      value: { ...run, environmentId: ENV },
      revision: revision(run.rev),
    })),
    ...(records.items ?? []).map((item): Row => ({
      family: "mateEngineItem",
      id: engineFactId(ENV, item.id),
      value: { ...item, environmentId: ENV },
      revision: revision(item.rev),
    })),
    ...(records.requests ?? []).map((request): Row => ({
      family: "mateEngineRequest",
      id: engineFactId(ENV, request.id),
      value: { ...request, environmentId: ENV },
      revision: revision(request.rev),
    })),
  ];
  return apply(emptyAccount, [
    {
      kind: "delivery",
      via: "mate-direct",
      scopes: scopes.map((scope) => ({ scope, generation: 0 })),
      reset: true,
      partial: true,
      rows,
      removals: [],
    },
    ...extra,
  ]);
}

const thread = (state: AccountState) =>
  Option.getOrNull(engineThread.derive(readsOfState(state), key).data);

describe("an engine conversation as the thread the view draws", () => {
  it("shows the person's words under their send's id and the agent's note as its answer", () => {
    const state = held({
      runs: [engineRun("thread-ada", 1)],
      items: [
        personItem(run1, 1, "Deploy the api", { sendId: "op-7" as never }),
        noteItem(run1, 2, "Deployed."),
      ],
    });
    expect(
      thread(state)?.messages.map(({ id, role, text, turnId }) => ({ id, role, text, turnId })),
    ).toEqual([
      { id: "op-7", role: "user", text: "Deploy the api", turnId: run1 },
      { id: `${run1}/i/2`, role: "assistant", text: "Deployed.", turnId: run1 },
    ]);
  });

  it.each([
    {
      name: "an open approval is an ask the panel answers",
      request: engineRequest(run1, 1, {
        kind: "approval",
        requestKind: "command",
        detail: "vp run build",
      }),
      kinds: ["approval.requested"],
    },
    {
      name: "an answered approval is resolved",
      request: engineRequest(
        run1,
        1,
        { kind: "approval", requestKind: "command", detail: "vp run build" },
        {
          state: "answered",
          answer: { by: { kind: "person", subject: "u" }, at: 5, summary: "Approved" },
        },
      ),
      kinds: ["approval.requested", "approval.resolved"],
    },
    {
      name: "an open question is an ask",
      request: engineRequest(run1, 1, { kind: "question", questions: [], dismissible: true }),
      kinds: ["user-input.requested"],
    },
    {
      name: "a question its session can no longer take is resolved",
      request: engineRequest(
        run1,
        1,
        { kind: "question", questions: [], dismissible: true },
        { answerable: false },
      ),
      kinds: ["user-input.requested", "user-input.resolved"],
    },
  ])("$name", ({ request, kinds }) => {
    const state = held({ runs: [engineRun("thread-ada", 1)], requests: [request] });
    expect(thread(state)?.activities.map((activity) => activity.kind)).toEqual(kinds);
    expect(thread(state)?.activities[0]?.payload).toMatchObject({ requestId: request.id });
  });

  it.each([
    { run: { state: "running", end: null }, turn: "running", session: "running" },
    { run: { state: "waiting", end: null }, turn: "running", session: "running" },
    { run: { state: "ended", end: { kind: "completed" } }, turn: "completed", session: "ready" },
    {
      run: { state: "ended", end: { kind: "stopped", by: { kind: "person", subject: "u" } } },
      turn: "interrupted",
      session: "ready",
    },
    {
      run: { state: "ended", end: { kind: "failed", reason: "Boom", next: null } },
      turn: "error",
      session: "error",
    },
  ] as const)("a run $run.state ($run.end.kind) is a $turn turn", ({ run, turn, session }) => {
    const state = held({ runs: [engineRun("thread-ada", 1, run as Partial<RunRecord>)] });
    expect(thread(state)?.latestTurn).toMatchObject({ turnId: run1, state: turn });
    expect(thread(state)?.session?.status).toBe(session);
  });

  it("takes its model selection from the conversation's agent", () => {
    const state = held({
      header: {
        agent: {
          instanceId: "claudePersonal",
          driver: "claudeAgent",
          model: "claude-opus-4-1",
          profile: { kind: "mate" },
        },
      },
    });
    expect(thread(state)?.modelSelection).toMatchObject({
      instanceId: "claudePersonal",
      model: "claude-opus-4-1",
    });
  });

  it("is still opening before its window arrives", () => {
    const scope = engineConversationScopes(key).item;
    const state = apply(emptyAccount, [
      { kind: "stream", key: scope, now: 0, event: { kind: "demand", demanded: true } },
      { kind: "stream", key: scope, now: 0, event: { kind: "attempt" } },
    ]);
    expect(engineThread.derive(readsOfState(state), key)).toMatchObject({
      status: "synchronizing",
      data: Option.none(),
    });
  });

  it("names the update route when its Mate speaks a newer protocol", () => {
    const scope = engineConversationScopes(key).item;
    const state = apply(emptyAccount, [
      { kind: "stream", key: scope, now: 0, event: { kind: "demand", demanded: true } },
      {
        kind: "stream",
        key: scope,
        now: 0,
        event: {
          kind: "fault",
          jitter: 0,
          fault: { outcome: "definitive-refusal", code: "update", message: "unserved" },
        },
      },
    ]);
    expect(Option.getOrNull(engineThread.derive(readsOfState(state), key).error)).toMatch(
      /Update the app/,
    );
  });

  it("shows nothing it held while its Mate withholds access", () => {
    const scope = engineConversationScopes(key).item;
    const state = held({ runs: [engineRun("thread-ada", 1)] }, [
      { kind: "stream", key: scope, now: 0, event: { kind: "demand", demanded: true } },
      {
        kind: "stream",
        key: scope,
        now: 0,
        event: {
          kind: "fault",
          jitter: 0,
          fault: { outcome: "authoritative-denial", message: "No longer yours." },
        },
      },
    ]);
    expect(engineThread.derive(readsOfState(state), key).data).toEqual(Option.none());
  });
});

describe("an engine conversation's row in the menu", () => {
  const shellThread = {
    id: "thread-ada",
    projectId: "project-ada",
    title: "Ada",
    modelSelection: { instanceId: "codex", model: "gpt-5" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    session: {
      threadId: "thread-ada",
      status: "ready",
      providerName: "codex",
      runtimeMode: "full-access",
      activeTurnId: null,
      lastError: null,
      updatedAt: "2026-10-01T00:00:00.000Z",
    },
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
  } as unknown as Parameters<typeof overlayEngineRow>[0];

  it.each([
    {
      name: "working",
      row: { state: { kind: "working", since: 1, waitsOnHelpers: false }, activeRunId: run1 },
      expected: { session: "running", approvals: false, input: false },
    },
    {
      name: "waiting on an approval",
      row: { state: { kind: "waiting", on: "approval", words: "vp run build" } },
      expected: { session: "running", approvals: true, input: false },
    },
    {
      name: "waiting on a question",
      row: { state: { kind: "waiting", on: "question", words: null } },
      expected: { session: "running", approvals: false, input: true },
    },
    {
      name: "idle",
      row: { state: { kind: "idle" } },
      expected: { session: "ready", approvals: false, input: false },
    },
  ] as const)("lays a $name row over the thread shell, with its agent", ({ row, expected }) => {
    const overlaid = overlayEngineRow(
      shellThread,
      engineRow(ENV, "thread-ada", row as Partial<ConversationRow>),
    );
    expect(overlaid.session?.status).toBe(expected.session);
    expect(overlaid.hasPendingApprovals).toBe(expected.approvals);
    expect(overlaid.hasPendingUserInput).toBe(expected.input);
    expect(overlaid.modelSelection.instanceId).toBe("claudeAgent");
  });

  it("leaves a Mate's shell as it is until its rows arrive, then lays them over it", () => {
    const shellState = {
      snapshot: Option.some({
        snapshotSequence: 1,
        projects: [],
        threads: [shellThread],
        updatedAt: "2026-10-01T00:00:00.000Z",
      }),
      status: "live",
      error: Option.none(),
    } as unknown as Parameters<typeof overlayEngineShell>[0];
    expect(overlayEngineShell(shellState, engineRows.derive(readsOfState(emptyAccount), ENV))).toBe(
      shellState,
    );
    const withRows = apply(emptyAccount, [
      {
        kind: "delivery",
        via: "mate-direct",
        scopes: [{ scope: engineRowsScope(ENV), generation: 0 }],
        reset: true,
        rows: [
          {
            family: "mateEngineRow",
            id: engineFactId(ENV, "thread-ada"),
            value: {
              ...engineRow(ENV, "thread-ada", {
                state: { kind: "waiting", on: "approval", words: null },
              }),
              environmentId: ENV,
            },
            revision: revision(5),
          },
        ],
        removals: [],
      },
    ]);
    const overlaid = overlayEngineShell(shellState, engineRows.derive(readsOfState(withRows), ENV));
    expect(Option.getOrNull(overlaid.snapshot)?.threads[0]?.hasPendingApprovals).toBe(true);
  });
});

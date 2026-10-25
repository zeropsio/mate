import {
  MATE_TASKS_CONVERSATION_ID,
  RunId,
  importedCallFields,
  type ConversationRow,
  type Item,
  type Request,
  type RunRecord,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
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
import { derivePendingRequests } from "../../pendingRequests.ts";
import { foldSubagentActivities } from "../../state/subagentRuntime.ts";
import {
  callItem,
  engineHeader,
  engineRequest,
  engineRow,
  engineRun,
  markerItem,
  noteItem,
  personItem,
  thoughtItem,
  unknownItem,
  workItem,
} from "../__fixtures__/mateEngine.ts";
import { engineCardPagingOfRecords } from "../__fixtures__/engineThread.ts";
import {
  engineHeldTurns,
  engineResendId,
  engineRows,
  engineCardsShowError,
  engineRunCards,
  engineStopTarget,
  engineThread,
  overlayEngineRow,
  overlayEngineShell,
} from "./mateEngine.ts";

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
  at: EngineConversationKey = key,
): AccountState {
  const scopes = Object.values(engineConversationScopes(at));
  const active = records.runs?.findLast((run) => run.turnState === "running");
  const latest = active ?? records.runs?.findLast((run) => run.state === "ended");
  const rows: Row[] = [
    {
      family: "mateEngineConversation",
      id: engineConversationId(at),
      value: {
        environmentId: ENV,
        header: engineHeader(at.conversationId, {
          activeRunId: active?.id ?? null,
          latestRunId: latest?.id ?? null,
          runStatus:
            active !== undefined ? "running" : latest?.turnState === "error" ? "error" : "ready",
          ...records.header,
        }),
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

const thread = (state: AccountState, at: EngineConversationKey = key) =>
  Option.getOrNull(engineThread.derive(readsOfState(state), at).data);

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

  it("a message no agent has yet can be withdrawn; one the agent took cannot", () => {
    const run2 = "thread-ada/r/2";
    const state = held({
      runs: [
        engineRun("thread-ada", 1, { end: { kind: "usage-limit", resetsAt: 9 } }),
        engineRun("thread-ada", 2, { state: "queued", end: null, endedAt: null, startedAt: null }),
      ],
      items: [personItem(run1, 1, "Deploy the api"), personItem(run2, 1, "Still there?")],
      header: { pausedUntil: 9 },
    });
    expect(
      thread(state)?.messages.map((message) => [
        message.text,
        (message as { readonly heldRunId?: string }).heldRunId ?? null,
      ]),
    ).toEqual([
      ["Deploy the api", null],
      ["Still there?", run2],
    ]);
  });

  it("shows a message its steer missed, sent as the next run, under the message's own id", () => {
    const state = held({
      runs: [engineRun("thread-ada", 1)],
      items: [personItem(run1, 1, "And the worker", { sendId: engineResendId("op-7") as never })],
    });
    expect(thread(state)?.messages.map(({ id }) => id)).toEqual(["op-7"]);
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

  const stripe = {
    kind: "vault",
    key: "STRIPE_SECRET_KEY",
    scope: { kind: "shared" },
    sensitive: true,
    reason: "Stripe charges cards.",
  } as const;
  const ana = { kind: "person", subject: "user-ada" } as const;
  it.each([
    {
      name: "open: waiting on the person",
      request: engineRequest(run1, 1, stripe),
      said: { state: "open", answer: null },
    },
    {
      name: "saved: who and when",
      request: engineRequest(run1, 1, stripe, {
        state: "answered",
        answerable: true,
        answer: { by: ana, at: 9, summary: "Saved to Shared/STRIPE_SECRET_KEY" },
      }),
      said: { state: "saved", answer: { by: ana, at: 9 } },
    },
    {
      name: "declined: who and when",
      request: engineRequest(run1, 1, stripe, {
        state: "declined",
        answerable: false,
        answer: { by: ana, at: 9, summary: "Declined" },
      }),
      said: { state: "declined", answer: { by: ana, at: 9 } },
    },
  ])("a value asked of the person is one card in its run, $name", ({ request, said }) => {
    const state = held({ runs: [engineRun("thread-ada", 1)], requests: [request] });
    const activities = thread(state)?.activities ?? [];
    expect(activities.map((activity) => activity.kind)).toEqual(["vault.requested"]);
    expect(activities[0]?.payload).toEqual({
      requestId: request.id,
      key: "STRIPE_SECRET_KEY",
      label: null,
      scope: { kind: "shared" },
      sensitive: true,
      reason: "Stripe charges cards.",
      ...said,
    });
  });

  const mateOrigin = {
    kind: "origin",
    url: "https://github.com/zeropsio/mate",
    repo: "appdev",
    reason: "So finished work lands back on GitHub.",
  } as const;
  it.each([
    {
      name: "open: waiting on the person",
      request: engineRequest(run1, 1, mateOrigin),
      said: { state: "open", answer: null },
    },
    {
      name: "connected: who and when",
      request: engineRequest(run1, 1, mateOrigin, {
        state: "answered",
        answerable: true,
        answer: { by: ana, at: 9, summary: "Connected as appdev" },
      }),
      said: { state: "connected", answer: { by: ana, at: 9 } },
    },
    {
      name: "declined: who and when",
      request: engineRequest(run1, 1, mateOrigin, {
        state: "declined",
        answerable: false,
        answer: { by: ana, at: 9, summary: "Declined" },
      }),
      said: { state: "declined", answer: { by: ana, at: 9 } },
    },
  ])("an origin asked of the person is one card in its run, $name", ({ request, said }) => {
    const state = held({ runs: [engineRun("thread-ada", 1)], requests: [request] });
    const activities = thread(state)?.activities ?? [];
    expect(activities.map((activity) => activity.kind)).toEqual(["origin.requested"]);
    expect(activities[0]?.payload).toEqual({
      requestId: request.id,
      url: "https://github.com/zeropsio/mate",
      repo: "appdev",
      reason: "So finished work lands back on GitHub.",
      ...said,
    });
  });

  it("an answered question shows what the person answered and the pictures attached to it", () => {
    const preview = {
      type: "image" as const,
      id: "img-1",
      name: "question-preview.png",
      mimeType: "image/png",
      sizeBytes: 2048,
    };
    const question = { id: "target", header: "Target", question: "Which environment?" };
    const answered = engineRequest(
      run1,
      1,
      { kind: "question", questions: [question], dismissible: false },
      {
        state: "answered",
        answer: {
          by: { kind: "person", subject: "u" },
          at: 5,
          summary: "Answered",
          answers: { target: "Inspect the preview" },
          attachmentsByQuestionId: { target: [preview] } as never,
        },
      },
    );
    const state = held({ runs: [engineRun("thread-ada", 1)], requests: [answered] });
    const activities = thread(state)?.activities ?? [];
    expect(activities.map((activity) => activity.kind)).toEqual([
      "user-input.requested",
      "user-input.resolved",
      "user-input.answer-submitted",
    ]);
    expect(activities[1]?.payload).toMatchObject({ answers: { target: "Inspect the preview" } });
    expect(activities[2]?.payload).toEqual({
      requestId: answered.id,
      answers: { target: "Inspect the preview" },
      questionTextById: { target: "Which environment?" },
      attachmentsByQuestionId: { target: [preview] },
      detail: "question-preview.png",
    });
  });

  it.each([
    { dismissible: true, responseMode: "message" },
    { dismissible: false, responseMode: undefined },
  ])("a question its agent does not wait on can be dismissed ($dismissible)", (row) => {
    const request = engineRequest(run1, 1, {
      kind: "question",
      questions: [],
      dismissible: row.dismissible,
    });
    const state = held({ runs: [engineRun("thread-ada", 1)], requests: [request] });
    expect(thread(state)?.activities[0]?.payload).toEqual(
      row.responseMode === undefined
        ? { requestId: request.id, questions: [] }
        : { requestId: request.id, questions: [], responseMode: row.responseMode },
    );
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

  it.each([
    {
      name: "a message queued behind a working run leaves the working run the turn Stop ends",
      runs: [
        engineRun("thread-ada", 1, { state: "running", end: null, endedAt: null }),
        engineRun("thread-ada", 2, { state: "queued", end: null, endedAt: null, startedAt: null }),
      ],
      header: {},
      turn: { turnId: run1, state: "running" },
      session: "running",
      active: run1,
    },
    {
      name: "a message queued while a run is admitted keeps the admitted run the turn",
      runs: [
        engineRun("thread-ada", 1, { state: "admitted", end: null, endedAt: null }),
        engineRun("thread-ada", 2, { state: "queued", end: null, endedAt: null }),
        engineRun("thread-ada", 3, { state: "queued", end: null, endedAt: null }),
      ],
      header: {},
      turn: { turnId: run1, state: "running" },
      session: "running",
      active: run1,
    },
    {
      name: "a usage-limit pause holding a queued message shows no work and no Stop",
      runs: [
        engineRun("thread-ada", 1, { end: { kind: "usage-limit", resetsAt: 9 } }),
        engineRun("thread-ada", 2, { state: "queued", end: null, endedAt: null, startedAt: null }),
      ],
      header: { pausedUntil: 9 },
      turn: { turnId: run1, state: "interrupted" },
      session: "ready",
      active: null,
    },
    {
      name: "only queued messages are no work yet",
      runs: [engineRun("thread-ada", 1, { state: "queued", end: null, endedAt: null })],
      header: {},
      turn: null,
      session: "ready",
      active: null,
    },
  ] as const)("$name", ({ runs, header, turn, session, active }) => {
    const state = held({ runs: runs as ReadonlyArray<RunRecord>, header });
    if (turn === null) expect(thread(state)?.latestTurn).toBeNull();
    else expect(thread(state)?.latestTurn).toMatchObject(turn);
    expect(thread(state)?.session?.status).toBe(session);
    expect(thread(state)?.session?.activeTurnId ?? null).toBe(active);
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
        model: "claude-opus-4-1",
      },
    });
    expect(thread(state)?.modelSelection).toMatchObject({
      instanceId: "claudePersonal",
      model: "claude-opus-4-1",
    });
  });

  it("shows the model the conversation switched to, on the agent it runs", () => {
    const state = held({ header: { model: "claude-opus-4-1" } });
    expect(thread(state)?.modelSelection).toMatchObject({
      instanceId: "claudeAgent",
      model: "claude-opus-4-1",
    });
  });

  it("shows the files and pictures a person's message carried, as V1's message does", () => {
    const file = {
      type: "file",
      id: "file-1",
      name: "spec.pdf",
      mimeType: "application/pdf",
      sizeBytes: 9,
    } as const;
    const picture = {
      type: "image",
      id: "img-1",
      name: "a.png",
      mimeType: "image/png",
      sizeBytes: 3,
    } as const;
    const state = held({
      runs: [engineRun("thread-ada", 1)],
      items: [
        personItem(run1, 1, "Read these", {
          attachments: [file, picture, { type: "unknown", was: "audio" }] as never,
        }),
      ],
    });
    expect(thread(state)?.messages[0]?.attachments).toEqual([file, picture]);
  });

  it("shows the runtime mode the conversation runs in and its latest message's interaction mode", () => {
    const state = held({
      header: {
        runtimeMode: "approval-required",
        interactionMode: "plan",
        agent: {
          instanceId: "claudeAgent",
          driver: "claudeAgent",
          model: "claude-sonnet-4-5",
          options: [{ id: "effort", value: "max" }],
          profile: { kind: "mate" },
        },
      },
    });
    expect(thread(state)).toMatchObject({
      runtimeMode: "approval-required",
      interactionMode: "plan",
      modelSelection: { options: [{ id: "effort", value: "max" }] },
      session: { runtimeMode: "approval-required" },
    });
  });

  it("shows the default modes for a header naming modes this build does not know", () => {
    const state = held({ header: { runtimeMode: "unknown", interactionMode: "unknown" } });
    expect(thread(state)).toMatchObject({
      runtimeMode: "full-access",
      interactionMode: "default",
      session: { runtimeMode: "full-access" },
    });
  });

  it("gives the menu row the model its held conversation switched to", () => {
    const state = apply(held({ header: { model: "claude-opus-4-1" } }), [
      {
        kind: "delivery",
        via: "mate-direct",
        scopes: [{ scope: engineRowsScope(ENV), generation: 0 }],
        reset: true,
        rows: [
          {
            family: "mateEngineRow",
            id: engineFactId(ENV, "thread-ada"),
            value: { ...engineRow(ENV, "thread-ada"), environmentId: ENV },
            revision: revision(5),
          },
        ],
        removals: [],
      },
    ]);
    expect(engineRows.derive(readsOfState(state), ENV)[0]?.agent?.model).toBe("claude-opus-4-1");
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

  it("names the reload-or-update route when its Mate speaks a newer protocol", () => {
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
    expect(Option.getOrNull(engineThread.derive(readsOfState(state), key).error)).toBe(
      "This Mate speaks a newer conversation protocol. Reload or update this app to keep talking to it.",
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

describe("an engine run's work, as the run card draws the same work of a V1 run", () => {
  const activitiesOf = (items: ReadonlyArray<Item>, runs = [engineRun("thread-ada", 1)]) =>
    thread(held({ runs, items }))?.activities ?? [];
  const payloadOf = (items: ReadonlyArray<Item>, kind: string) =>
    activitiesOf(items).find((activity) => activity.kind === kind)?.payload as
      | Record<string, unknown>
      | undefined;

  it.each([
    {
      name: "a running call is a step still in progress",
      state: "running",
      kinds: ["tool.started", "tool.updated"],
      status: "inProgress",
    },
    {
      name: "a call that returned is a finished step",
      state: "done",
      kinds: ["tool.started", "tool.completed"],
      status: "completed",
    },
    {
      name: "a call that failed is a failed step",
      state: "failed",
      kinds: ["tool.started", "tool.completed"],
      status: "failed",
    },
    {
      name: "a call the person declined is a declined step",
      state: "declined",
      kinds: ["tool.started", "tool.completed"],
      status: "declined",
    },
    {
      name: "a call its run's stop cut is a stopped step",
      state: "stopped",
      kinds: ["tool.started", "tool.completed"],
      status: "stopped",
    },
  ] as const)("$name", ({ state, kinds, status }) => {
    const activities = activitiesOf([callItem(run1, 2, { state })]);
    expect(activities.map((activity) => activity.kind)).toEqual(kinds);
    expect(activities.at(-1)).toMatchObject({
      summary: "Ran command",
      payload: { status, toolCallId: `${run1}/i/2` },
    });
    expect(activities.map((activity) => activity.turnId)).toEqual([run1, run1]);
  });

  it("a call that never returned shows no result", () => {
    expect(payloadOf([callItem(run1, 2, { state: "unreturned" })], "tool.completed")).toMatchObject(
      { unreturned: true },
    );
  });

  it.each([
    { name: "command", step: "command", tool: { name: "Bash" }, itemType: "command_execution" },
    { name: "edit", step: "edit", tool: { name: "Edit" }, itemType: "file_change" },
    { name: "web search", step: "web", tool: { name: "WebSearch" }, itemType: "web_search" },
    { name: "look", step: "look", tool: { name: "view_image" }, itemType: "image_view" },
    {
      name: "helper launch",
      step: "helper",
      tool: { name: "spawn_agent" },
      itemType: "collab_agent_tool_call",
    },
    { name: "agent tool", step: "tool", tool: { name: "Skill" }, itemType: "dynamic_tool_call" },
    { name: "file read", step: "read", tool: { name: "Read" }, itemType: "dynamic_tool_call" },
    { name: "code search", step: "search", tool: { name: "Grep" }, itemType: "dynamic_tool_call" },
    {
      name: "MCP tool",
      step: "mcp",
      tool: { name: "zerops_deploy", server: "zerops" },
      itemType: "mcp_tool_call",
    },
    {
      name: "MCP tool an ACP agent ran as its own",
      step: "tool",
      tool: { name: "zerops_deploy", server: "zerops" },
      itemType: "dynamic_tool_call",
    },
  ])("a $name call is the step V1 draws for the same call", ({ step, tool, itemType }) => {
    expect(payloadOf([callItem(run1, 2, { step, tool })], "tool.completed")).toMatchObject({
      itemType,
      data: { toolName: tool.name, ...("server" in tool ? { server: tool.server } : {}) },
    });
  });

  it("a call's line and facts are what V1's row of the same call reads", () => {
    const shows = {
      toolName: "Bash",
      command: "npm run build",
      input: { description: "Build the api" },
      rawOutput: { content: "built in 41 s" },
    };
    const activities = activitiesOf([
      callItem(run1, 2, { input: "Bash: npm run build", shows, parts: ["detail"] }),
    ]);
    for (const activity of activities)
      expect(activity.payload).toMatchObject({ detail: "Bash: npm run build", data: shows });
  });

  it("a Zerops call's result is the result its card decodes, its pictures by reference", () => {
    const result = {
      toolName: "zerops_browser",
      resultText: '{"status":"ok"}',
      images: [
        {
          mimeType: "image/png",
          asset: {
            id: "a1",
            threadId: "mate/s/1",
            ownerId: "call-1",
            name: "tool-image",
            provenance: "capture",
            original: {
              status: "ready",
              digest: "a".repeat(64),
              mimeType: "image/png",
              sizeBytes: 68,
            },
          } as never,
        },
      ],
    };
    expect(
      payloadOf(
        [
          callItem(run1, 2, {
            step: "mcp",
            tool: { name: "zerops_browser", server: "zerops" },
            shows: { toolName: "mcp__zerops__zerops_browser" },
            result,
          }),
        ],
        "tool.completed",
      ),
    ).toMatchObject({ data: { toolName: "mcp__zerops__zerops_browser", zerops: result } });
  });

  // A V1 call the history import brought over: its item data is V1's projected payload.
  it.each([
    {
      name: "command",
      tool: { name: "Bash" },
      payload: {
        itemType: "command_execution",
        detail: "Bash: npm run build",
        data: { toolName: "Bash", command: "npm run build", rawOutput: { content: "built" } },
      },
    },
    {
      name: "file read",
      tool: { name: "Read" },
      payload: {
        itemType: "dynamic_tool_call",
        detail: 'Read: {"file_path":"/var/www/api/package.json"}',
        data: { toolName: "Read", input: { file_path: "/var/www/api/package.json" } },
      },
    },
    {
      name: "edit",
      tool: { name: "File change" },
      payload: {
        itemType: "file_change",
        data: { files: [{ path: "/var/www/api/src/main.ts" }], wrote: true },
      },
    },
    {
      name: "web search",
      tool: { name: "WebSearch" },
      payload: {
        itemType: "web_search",
        detail: "zerops nodejs",
        data: { toolName: "WebSearch", input: { query: "zerops nodejs" } },
      },
    },
    {
      name: "look",
      tool: { name: "view_image" },
      payload: { itemType: "image_view", data: { imagePath: "mate-asset:1f0e" } },
    },
    {
      name: "helper launch",
      tool: { name: "Agent" },
      payload: {
        itemType: "collab_agent_tool_call",
        detail: "Review the api",
        data: { toolName: "Agent", input: { description: "Review the api", name: "reviewer" } },
      },
    },
    {
      name: "Zerops deploy",
      tool: { name: "zerops_deploy", server: "zerops" },
      payload: {
        itemType: "mcp_tool_call",
        detail: 'mcp__zerops__zerops_deploy: {"targetService":"api"}',
        data: {
          toolName: "mcp__zerops__zerops_deploy",
          input: { targetService: "api" },
          zerops: { toolName: "zerops_deploy", resultText: '{"status":"DEPLOYED"}' },
        },
      },
    },
  ])("an imported V1 $name call is drawn as V1 drew it", ({ tool, payload }) => {
    const data = { source: "v1", kind: "tool.completed", summary: "Tool", payload };
    const drawn = payloadOf(
      [callItem(run1, 2, { tool, ...importedCallFields(data) })],
      "tool.completed",
    );
    expect(drawn).toMatchObject({
      itemType: payload.itemType,
      data: payload.data,
      ...("detail" in payload ? { detail: payload.detail } : {}),
    });
    expect(Object.keys(drawn?.data as object).sort()).toEqual(Object.keys(payload.data).sort());
  });

  it("a call keeps how its agent presents it", () => {
    const presentation = { title: "Deploy", server: "zerops" } as never;
    expect(
      activitiesOf([callItem(run1, 2, { words: null, presentation })]).find(
        (activity) => activity.kind === "tool.completed",
      ),
    ).toMatchObject({ summary: "Deploy", payload: { presentation } });
  });

  it("a helper's own call is the helper's, not its run's", () => {
    expect(
      payloadOf([callItem(run1, 2, { by: { kind: "helper", helperId: "h-1" } })], "tool.completed"),
    ).toMatchObject({ agentId: "h-1" });
  });

  it.each([
    {
      name: "a running helper is a helper on the run",
      item: { workKind: "helper", status: "running" },
      kinds: ["task.started"],
      payload: { taskId: "work-2", agentKind: "agent", taskType: "local_agent" },
    },
    {
      name: "a helper that finished has ended",
      item: { workKind: "helper", status: "completed" },
      kinds: ["task.started", "task.completed"],
      payload: { agentKind: "agent", status: "completed" },
    },
    {
      name: "a shell left running is a background job",
      item: { workKind: "shell", status: "running" },
      kinds: ["task.started"],
      payload: { taskType: "local_bash", title: "Review the api" },
    },
    {
      name: "a monitor is a job the Mate watches",
      item: { workKind: "monitor", status: "idle" },
      kinds: ["task.started"],
      payload: { taskType: "monitor" },
    },
    {
      name: "work its session lost ended unreported, never as stopped or done",
      item: { workKind: "shell", status: "lost" },
      kinds: ["task.started", "task.completed"],
      payload: { status: "lost" },
    },
    {
      name: "work that failed ended failed",
      item: { workKind: "shell", status: "failed" },
      kinds: ["task.started", "task.completed"],
      payload: { status: "failed" },
    },
  ] as const)("$name", ({ item, kinds, payload }) => {
    const activities = activitiesOf([workItem(run1, 2, item)]);
    expect(activities.map((activity) => activity.kind)).toEqual(kinds);
    expect(activities.at(-1)?.payload).toMatchObject(payload);
  });

  it("a helper is on the helpers' surface by its title, working until it ends", () => {
    const helpers = (status: string) =>
      foldSubagentActivities(
        activitiesOf([workItem(run1, 2, { status } as Partial<Extract<Item, { kind: "work" }>>)]),
      ).map(({ title, status }) => ({ title, status }));
    expect(helpers("running")).toEqual([{ title: "Review the api", status: "running" }]);
    expect(helpers("completed")).toEqual([{ title: "Review the api", status: "completed" }]);
  });

  it.each(["idle", "waiting"] as const)(
    "a helper the engine says is %s reads so on the helpers' surface, never working",
    (status) => {
      const [helper] = foldSubagentActivities(activitiesOf([workItem(run1, 2, { status })]));
      expect(helper?.status).toBe(status);
    },
  );

  // Milo, 2026-10-08: "Started a helper · 56c95419-…/s/1.2.w1".
  it("a helper its agent never named is on the helpers' surface in plain words, never its id", () => {
    const [helper] = foldSubagentActivities(
      activitiesOf([workItem(run1, 2, { work: `${run1}/s/1.2.w1`, title: null })]),
    );
    expect(helper?.title).toBe("A helper");
  });

  it("a thought is the run's reasoning, drawn from its first word while it is written", () => {
    const messages = (items: ReadonlyArray<Item>) =>
      thread(held({ runs: [engineRun("thread-ada", 1)], items }))?.messages.map(
        ({ id, role, text, streaming }) => ({ id, role, text, streaming }),
      );
    expect(messages([thoughtItem(run1, 2, "", { streaming: true })])).toEqual([
      { id: `${run1}/i/2`, role: "reasoning", text: "", streaming: true },
    ]);
    expect(messages([thoughtItem(run1, 2, "Checking the api's logs")])).toEqual([
      { id: `${run1}/i/2`, role: "reasoning", text: "Checking the api's logs", streaming: false },
    ]);
    expect(messages([thoughtItem(run1, 2, "")])).toEqual([]);
  });

  it("a streaming note is the agent's message from its first word", () => {
    expect(
      thread(
        held({
          runs: [engineRun("thread-ada", 1, { state: "running", end: null })],
          items: [noteItem(run1, 2, "", { streaming: true, answer: false })],
        }),
      )?.messages.map(({ role, text, streaming }) => ({ role, text, streaming })),
    ).toEqual([{ role: "assistant", text: "", streaming: true }]);
  });

  it.each([
    {
      marker: { kind: "compacted" },
      expected: { kind: "context-compaction", summary: "Context compacted", tone: "info" },
    },
    {
      marker: { kind: "error", reason: "The model refused." },
      expected: {
        kind: "runtime.error",
        tone: "error",
        payload: { message: "The model refused." },
      },
    },
    {
      marker: { kind: "warning", reason: "The model is overloaded; retrying." },
      expected: {
        kind: "runtime.warning",
        summary: "The model is overloaded; retrying.",
        tone: "info",
        payload: { message: "The model is overloaded; retrying." },
      },
    },
    {
      marker: { kind: "plan", reason: "Deploy the api, then check it." },
      expected: {
        kind: "turn.plan.updated",
        summary: "Plan updated",
        tone: "info",
        payload: { explanation: "Deploy the api, then check it." },
      },
    },
    {
      marker: { kind: "runtime.note", reason: "Resumed from a checkpoint" },
      expected: { kind: "runtime.note", summary: "Resumed from a checkpoint", tone: "info" },
    },
  ])("a $marker.kind marker is the event V1 draws for it", ({ marker, expected }) => {
    expect(activitiesOf([markerItem(run1, 2, marker)])).toMatchObject([expected]);
  });

  // Catches an imported conversation that hides where its earlier turns stayed behind.
  it("where the history import cut, a line at the top says what stayed behind", () => {
    const reason =
      "12 earlier turns stayed with the previous engine: this conversation starts here.";
    expect(activitiesOf([markerItem(run1, 1, { kind: "history-cut", reason })])).toMatchObject([
      { kind: "history.cut", summary: reason, tone: "info" },
    ]);
  });

  it("a marker this build does not know draws nothing", () => {
    expect(activitiesOf([markerItem(run1, 2, { kind: "rewound" })])).toEqual([]);
  });

  // Git is the record of what a turn changed: nothing says a workspace was or was not captured.
  it("a capture gap an earlier Mate recorded draws nothing", () => {
    const marker = { kind: "capture-gap", reason: "api: Snapshot refused: disk full" };
    expect(activitiesOf([markerItem(run1, 2, marker)])).toEqual([]);
  });

  it("an item of a newer build shows its summary, or nothing when it gives none", () => {
    expect(activitiesOf([unknownItem(run1, 2, "Plan updated")])).toMatchObject([
      { summary: "Plan updated", turnId: run1 },
    ]);
    expect(activitiesOf([unknownItem(run1, 2, null)])).toEqual([]);
  });

  it.each([{ end: { kind: "usage-limit", resetsAt: null }, turnEnd: "usage-limit" }] as const)(
    "a run that ended $end.kind ends with V1's break",
    ({ end, turnEnd }) => {
      const activities = activitiesOf([], [engineRun("thread-ada", 1, { end })]);
      expect(activities).toMatchObject([
        { kind: "runtime.error", tone: "error", turnId: run1, payload: { turnEnd } },
      ]);
    },
  );

  it.each([
    { end: { kind: "completed" } },
    { end: { kind: "stopped", by: { kind: "person", subject: "u" } } },
  ] as const)("a run that ended $end.kind has no break", ({ end }) => {
    expect(activitiesOf([], [engineRun("thread-ada", 1, { end })])).toEqual([]);
  });

  it("the context meter reads how full the agent's context is, and a call shows its progress", () => {
    const state = held({ runs: [engineRun("thread-ada", 1)], items: [callItem(run1, 2)] }, [
      {
        kind: "delivery",
        via: "mate-direct",
        scopes: [{ scope: engineConversationScopes(key).gauge, generation: 0 }],
        reset: false,
        rows: [
          {
            family: "mateEngineGauge",
            id: engineConversationId(key),
            value: {
              environmentId: ENV,
              usage: { usedTokens: 4_000, maxTokens: 200_000 },
              progress: { [`${run1}/i/2`]: { step: "deploy" } },
            },
            revision: { kind: "mate-link", sequence: 1 },
          },
        ],
        removals: [],
      },
    ]);
    const activities = thread(state)?.activities ?? [];
    expect(activities.slice(-2)).toMatchObject([
      {
        kind: "tool.progress",
        turnId: run1,
        payload: { toolCallId: `${run1}/i/2`, zeropsStandUp: { step: "deploy" } },
      },
      { kind: "context-window.updated", payload: { usedTokens: 4_000, maxTokens: 200_000 } },
    ]);
  });

  // Catches Stop aimed at the card: the card's root ended, the run on it works on.
  it("Stop on a card a continuing run shares ends the run that works", () => {
    const state = held({
      runs: [
        engineRun("thread-ada", 1),
        engineRun("thread-ada", 2, {
          joins: run1 as never,
          trigger: { kind: "wake", cause: "self", wakeId: null } as never,
          state: "running",
          end: null,
          endedAt: null,
        }),
      ],
    });
    expect(thread(state)?.session?.activeTurnId).toBe(run1);
    expect(engineStopTarget(readsOfState(state), key, run1)).toBe("thread-ada/r/2");
    expect(engineStopTarget(readsOfState(state), key, "thread-ada/r/9")).toBe("thread-ada/r/9");
  });

  it("a run that continues another shares its card, and is its latest turn", () => {
    const run2 = "thread-ada/r/2";
    const state = held({
      runs: [
        engineRun("thread-ada", 1),
        engineRun("thread-ada", 2, {
          joins: run1 as never,
          trigger: { kind: "wake", cause: "helper", wakeId: null } as never,
          state: "running",
          end: null,
          endedAt: null,
        }),
      ],
      items: [personItem(run1, 1, "Review the api"), callItem(run2, 1, { state: "running" })],
    });
    const drawn = thread(state);
    expect(drawn?.activities.map((activity) => activity.turnId)).toEqual([run1, run1]);
    expect(drawn?.latestTurn).toMatchObject({ turnId: run1, state: "running" });
    expect(drawn?.session?.activeTurnId).toBe(run1);
  });
});

describe("an engine card not held whole, as its worked line and its scroll read it", () => {
  const AT = 1_760_000_000_000;
  const long = (ordinal: number, patch: Partial<Parameters<typeof engineRun>[2]> = {}) =>
    engineRun("thread-ada", ordinal, {
      summary: {
        items: 1_700,
        calls: { command: 300, edit: 40, mcp: 12 },
        tools: { zerops_deploy: 4, zerops_workflow: 8 },
        edited: 9,
        answerItemId: null,
        lastItemSeq: 1_700,
      },
      ...patch,
    });
  const held = [personItem(run1, 1, "Bring it up"), callItem(run1, 2), callItem(run1, 200)];

  it("is none for a card read whole: its worked line counts its calls", () => {
    expect(engineCardPagingOfRecords(key, { runs: [long(1)], items: held })).toEqual({});
  });

  it("counts a finished card's effort from its summary and holds its lines from its start to the last read", () => {
    expect(
      engineCardPagingOfRecords(key, {
        runs: [long(1)],
        items: held,
        spans: [{ runId: run1, from: null, to: 200, reading: null }],
      }),
    ).toEqual({
      [run1]: {
        pageRuns: { earlier: null, later: run1 },
        counts: {
          calls: { command: 300, edit: 40, mcp: 12 },
          tools: { zerops_deploy: 4, zerops_workflow: 8 },
          edited: 9,
        },
        hasWork: true,
        holdsLines: true,
        since: null,
        through: DateTime.formatIso(DateTime.makeUnsafe(AT + 200)),
        reading: null,
      },
    });
  });

  it("holds none of a finished card's lines until it opens, and says whether it has work to open", () => {
    const quiet = engineRun("thread-ada", 1, {
      summary: { items: 2, calls: {}, answerItemId: `${run1}/i/2` as never, lastItemSeq: 2 },
    });
    const spans = [{ runId: run1, from: null, to: 0, reading: null }];
    expect(
      engineCardPagingOfRecords(key, { runs: [long(1)], items: held, spans })[run1],
    ).toMatchObject({ holdsLines: false, hasWork: true });
    // The person's words and its answer, nothing between: nothing to show.
    expect(engineCardPagingOfRecords(key, { runs: [quiet], items: [], spans })[run1]).toMatchObject(
      {
        holdsLines: false,
        hasWork: false,
      },
    );
  });

  // Catches a card left out on a cold open: a loose run (work V1 kept under no turn) has no
  // person's words, so its one call is all it holds.
  it.each([
    {
      name: "a loose imported run with one call",
      trigger: { kind: "imported", from: "v1", turn: null },
      items: [],
      summary: { items: 1, calls: { command: 1 }, answerItemId: null, lastItemSeq: 1 },
      hasWork: true,
    },
    {
      name: "an imported turn with only its message and answer",
      trigger: { kind: "imported", from: "v1", turn: "turn-1" },
      items: [personItem(run1, 1, "Hi")],
      summary: { items: 2, calls: {}, answerItemId: `${run1}/i/2`, lastItemSeq: 2 },
      hasWork: false,
    },
  ])("says whether $name has work to open", ({ trigger, items, summary, hasWork }) => {
    const run = engineRun("thread-ada", 1, { trigger, summary } as never);
    const spans = [{ runId: run1, from: null, to: 0, reading: null }];
    expect(engineCardPagingOfRecords(key, { runs: [run], items, spans })[run1]).toMatchObject({
      hasWork,
    });
  });

  it("holds a live card's lines from the earliest read to its end", () => {
    const paging = engineCardPagingOfRecords(key, {
      runs: [long(1, { state: "running", end: null, endedAt: null })],
      items: [personItem(run1, 1, "Go"), callItem(run1, 1_501), callItem(run1, 1_700)],
      spans: [{ runId: run1, from: 1_501, to: null, reading: "earlier" }],
    });
    expect(paging[run1]).toMatchObject({
      since: DateTime.formatIso(DateTime.makeUnsafe(AT + 1_501)),
      through: null,
      reading: "earlier",
    });
  });

  // Filip's card (Aleš, 2026-10-25): a person's message sent while a run worked goes on in that
  // run's card. Opened once that run had ended, the run is not read yet, and the live run holds its
  // newest lines from its window: the card held none of them, the live card opened onto its current
  // step alone and its Hide work folded nothing away.
  describe("a live card a queued message joined to a run not read yet", () => {
    const run2 = "thread-ada/r/2";
    const iso = (ms: number) => DateTime.formatIso(DateTime.makeUnsafe(ms));
    const worked = long(1, { startedAt: AT, endedAt: AT + 10_000 });
    const queued = (patch: Partial<Parameters<typeof engineRun>[2]>) =>
      long(2, {
        queuedAt: AT + 5_000,
        admittedAt: AT + 10_000,
        startedAt: AT + 10_000,
        summary: {
          items: 1_700,
          calls: { command: 800 },
          answerItemId: null,
          lastItemSeq: 3_700,
        },
        ...patch,
      });
    const working = queued({ state: "running", end: null, endedAt: null });
    const said = personItem(run2, 2_001, "GitHub is set", { at: AT + 5_000 });
    const tail = [
      callItem(run2, 3_661, { at: AT + 20_000 }),
      callItem(run2, 3_700, { at: AT + 30_000 }),
    ];
    const notRead = { runId: run1, from: null, to: 0, reading: null };

    it("holds its live run's newest lines through its end, and pages back from them", () => {
      const paging = engineCardPagingOfRecords(key, {
        runs: [worked, working],
        items: [...held, said, ...tail],
        spans: [notRead, { runId: run2, from: 3_661, to: null, reading: null }],
      });
      expect(paging[run1]).toMatchObject({
        pageRuns: { earlier: run2, later: null },
        holdsLines: true,
        since: iso(AT + 20_000),
        through: null,
      });
    });

    it.each([
      {
        name: "read back to its start",
        spans: [{ runId: run2, from: null, to: null, reading: null }],
      },
      { name: "held whole from its first line", spans: [] },
    ])("reaches back into the run before it once its live run is $name", ({ spans }) => {
      const paging = engineCardPagingOfRecords(key, {
        runs: [worked, working],
        items: [...held, said, ...tail],
        spans: [notRead, ...spans],
      });
      expect(paging[run1]).toMatchObject({
        pageRuns: { earlier: run1, later: null },
        holdsLines: true,
        since: iso(AT + 5_000),
        through: null,
      });
    });

    // Catches a card emptied under the person reading it: its live run, read back to its start,
    // settled while the run before it was still not read. A run that started after the
    // conversation opened (any new turn) has no span of its own: it was held whole as it came.
    it.each([
      {
        name: "holding its newest lines",
        spans: [{ runId: run2, from: 3_661, to: null, reading: null }],
        expected: { pageRuns: { earlier: run2, later: null }, since: iso(AT + 20_000) },
      },
      {
        name: "read back to its start",
        spans: [{ runId: run2, from: null, to: null, reading: null }],
        expected: { pageRuns: { earlier: run1, later: null }, since: iso(AT + 5_000) },
      },
      {
        name: "held whole from its first line",
        spans: [],
        expected: { pageRuns: { earlier: run1, later: null }, since: iso(AT + 5_000) },
      },
    ])("keeps what it holds as its live run settles, $name", ({ spans, expected }) => {
      const paging = engineCardPagingOfRecords(key, {
        runs: [worked, queued({ endedAt: AT + 40_000 })],
        items: [...held, said, ...tail],
        spans: [notRead, ...spans],
      });
      expect(paging[run1]).toMatchObject({ ...expected, holdsLines: true, through: null });
    });
  });

  it("keeps counting from the summary once every page is read, so its worked line never changes", () => {
    const paging = engineCardPagingOfRecords(key, {
      runs: [long(1)],
      items: held,
      spans: [{ runId: run1, from: null, to: null, reading: null }],
    });
    expect(paging[run1]).toMatchObject({ since: null, through: null, counts: { edited: 9 } });
  });

  it("counts every run a card draws: a wake that joined the long run adds its own", () => {
    const wake = engineRun("thread-ada", 2, {
      joins: run1 as never,
      summary: {
        items: 3,
        calls: { command: 2 },
        tools: {},
        edited: 1,
        answerItemId: null,
        lastItemSeq: 3,
      },
    });
    const paging = engineCardPagingOfRecords(key, {
      runs: [long(1), wake],
      items: held,
      spans: [{ runId: run1, from: null, to: 200, reading: null }],
    });
    expect(paging[run1]?.counts).toEqual({
      calls: { command: 302, edit: 40, mcp: 12 },
      tools: { zerops_deploy: 4, zerops_workflow: 8 },
      edited: 10,
    });
  });
});

it("a missing or future server run verdict does not guess work from the run records", () => {
  for (const runStatus of [undefined, "unknown"] as const) {
    const view = thread(
      held({
        runs: [engineRun("thread-ada", 1, { state: "running", end: null })],
        header: { runStatus, activeRunId: null, latestRunId: null },
      }),
    );
    expect(view?.session?.status).toBe("stopped");
    expect(view?.session?.lastError).toContain("does not provide the current run state");
    expect(view?.latestTurn).toBeNull();
  }
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
      // Its run has ended: the face reads needs you while the ask waits, never idle.
      name: "waiting on a value asked of the person",
      row: {
        state: { kind: "waiting", on: "vault", words: "Stripe charges cards." },
        runStatus: "ready",
      },
      expected: { session: "ready", approvals: false, input: true },
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
    expect(overlaid.pendingAsk ?? null).toBe(
      row.state.kind === "waiting" && row.state.on === "vault" ? "key" : null,
    );
    expect(overlaid.modelSelection.instanceId).toBe("claudeAgent");
  });

  it("names the pool container the conversation's agent leased, and none once the row names none", () => {
    const lease = { alias: "webpool-3", pool: "webpool", branch: "feat-x" };
    const leased = overlayEngineRow(
      shellThread,
      engineRow(ENV, "thread-ada", { state: { kind: "idle" }, lease } as Partial<ConversationRow>),
    );
    expect(leased.lease).toEqual(lease);
    expect(leased.worktreePath).toBeNull();
    expect(
      overlayEngineRow(leased, engineRow(ENV, "thread-ada", { state: { kind: "idle" } })).lease,
    ).toBeNull();
  });

  // Lab A.3, 2026-10-25: Archive and start fresh left the conversation reading live once nobody
  // held it, and a review's Fix asked it, on a hidden composer, rather than the live one.
  it.each([
    { name: "archived", row: { archived: true }, archived: true },
    { name: "live", row: {}, archived: false },
  ] as const)("reads a conversation nobody holds $name, as its row says", ({ row, archived }) => {
    const overlaid = overlayEngineRow(
      shellThread,
      engineRow(ENV, "thread-ada", {
        state: { kind: "idle" },
        ...row,
      } as Partial<ConversationRow>),
    );
    expect(overlaid.archivedAt != null).toBe(archived);
  });

  it("gives a thread shell that never had a session its row's: working, on its run", () => {
    const overlaid = overlayEngineRow(
      { ...shellThread, session: null },
      engineRow(ENV, "thread-ada", {
        state: { kind: "working", since: 1, waitsOnHelpers: false },
        activeRunId: run1 as never,
      }),
    );
    expect(overlaid.session).toMatchObject({
      threadId: "thread-ada",
      status: "running",
      activeTurnId: run1,
      providerName: "claudeAgent",
    });
  });

  // The V1 thread the engine took over keeps its last words from before the flip: a menu row read
  // off the shell showed them after a reload, days old, over the conversation's own.
  it("an engine Mate's menu reads its conversation's own words, never the V1 thread's from before the engine took it over", () => {
    const v1Thread = {
      ...shellThread,
      latestUserMessageAt: "2026-10-01T15:50:00.000Z",
      latestUserMessagePreview: {
        role: "user",
        text: "ok, should be working now, continue",
        createdAt: "2026-10-01T15:50:00.000Z",
      },
      latestMessagePreview: {
        role: "assistant",
        text: "I've rebuilt the first screen.",
        createdAt: "2026-10-01T15:53:00.000Z",
      },
      latestTurn: {
        turnId: "v1-turn",
        state: "completed",
        requestedAt: "2026-10-01T15:50:00.000Z",
        startedAt: "2026-10-01T15:50:00.000Z",
        completedAt: "2026-10-01T15:53:00.000Z",
        assistantMessageId: null,
      },
    } as unknown as Parameters<typeof overlayEngineRow>[0];
    const at = Date.parse("2026-10-08T18:00:00.000Z");
    const row = engineRow(ENV, "thread-ada", {
      at,
      latestRun: {
        id: run1 as never,
        end: { kind: "completed" },
        endedAt: at + 5,
        turnState: "completed",
      },
      subject: "Reply with the single word ROWS.",
      snippet: "ROWS",
    });
    const read = (thread: ReturnType<typeof overlayEngineRow>) => ({
      asked: thread.latestUserMessagePreview?.text,
      said: thread.latestMessagePreview,
      askedAt: thread.latestUserMessageAt,
      ended: thread.latestTurn?.completedAt,
    });
    const own = {
      asked: "Reply with the single word ROWS.",
      said: { role: "assistant", text: "ROWS", createdAt: "2026-10-08T18:00:00.000Z" },
      askedAt: "2026-10-08T18:00:00.000Z",
      ended: "2026-10-08T18:00:00.005Z",
    };
    expect(read(overlayEngineRow(v1Thread, row))).toEqual(own);
    // Held, before its records name a turn: still the row's run, never the V1 thread's turn.
    expect(
      read(
        overlayEngineRow(v1Thread, row, { latestTurn: null, status: "ready", activeTurnId: null }),
      ),
    ).toEqual(own);
  });

  // Milo, stress run 4B (2026-10-10): a restart rewrote the row, and its last change read as a
  // message just sent — "Working on a reply" over a clock at 0:00, no run on.
  it("a row a restart rewrote names no new message, and its helpers' work is the row's", () => {
    const end = Date.parse("2026-10-10T08:28:15.700Z");
    const restarted = Date.parse("2026-10-10T08:28:49.800Z");
    const overlaid = overlayEngineRow(
      shellThread,
      engineRow(ENV, "thread-ada", {
        state: { kind: "working", since: end as never, waitsOnHelpers: true },
        runStatus: "ready",
        latestRun: {
          id: run1 as never,
          end: { kind: "completed" },
          endedAt: end as never,
          turnState: "completed",
        },
        subject: "Start one helper",
        snippet: null,
        at: restarted as never,
      }),
    );
    expect({
      askedAt: overlaid.latestUserMessageAt,
      ended: overlaid.latestTurn?.completedAt,
      session: overlaid.session?.status,
      background: overlaid.backgroundLiveness,
    }).toEqual({
      askedAt: "2026-10-10T08:28:15.700Z",
      ended: "2026-10-10T08:28:15.700Z",
      session: "ready",
      background: "working",
    });
  });

  it("names the background work its row waits on on its shell, and none once it works on a turn", () => {
    const work = {
      items: [{ title: "Final batched browser check", of: "mate", since: 1 }],
      count: 4,
    } as const;
    const after = overlayEngineRow(
      shellThread,
      engineRow(ENV, "thread-ada", {
        state: { kind: "working", since: 1 as never, waitsOnHelpers: true, work },
      }),
    );
    expect(after.backgroundWork).toEqual(work);
    const turn = overlayEngineRow(
      { ...shellThread, backgroundWork: work },
      engineRow(ENV, "thread-ada", {
        state: { kind: "working", since: 1 as never, waitsOnHelpers: false },
        activeRunId: run1 as never,
      }),
    );
    expect(turn.backgroundWork).toBeUndefined();
  });

  it.each([
    {
      when: "a Stop is ending its run",
      state: { kind: "working", since: 1, waitsOnHelpers: false, stopping: true },
      stopping: true,
    },
    {
      when: "a Stop is ending the helpers its turn left",
      state: { kind: "working", since: 1, waitsOnHelpers: true, stopping: true },
      stopping: true,
    },
    {
      when: "it works with no Stop in force",
      state: { kind: "working", since: 1, waitsOnHelpers: true },
      stopping: false,
    },
    { when: "nothing runs", state: { kind: "idle" }, stopping: false },
  ] as const)("says on its shell whether a person's Stop is in force: $when", (row) => {
    const overlaid = overlayEngineRow(
      shellThread,
      engineRow(ENV, "thread-ada", { state: row.state as never }),
    );
    expect(overlaid.stopping === true).toBe(row.stopping);
  });

  it("starts a working row's turn at its run's start, never at the row's last change", () => {
    const start = Date.parse("2026-10-10T08:27:44.600Z");
    const overlaid = overlayEngineRow(
      shellThread,
      engineRow(ENV, "thread-ada", {
        state: { kind: "working", since: start as never, waitsOnHelpers: false },
        activeRunId: run1 as never,
        latestRun: { id: run1 as never, end: null, endedAt: null, turnState: "running" },
        at: Date.parse("2026-10-10T08:28:49.800Z") as never,
      }),
    );
    expect(overlaid.latestTurn?.startedAt).toBe("2026-10-10T08:27:44.600Z");
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

  // Catches the view reading the turn from the menu row, which names a run, not the card it draws
  // on: a live run that continues another drew folded, hiding the person's answer (journey 9).
  it.each([
    {
      name: "a run that continues another is live on its root's card",
      runs: [
        engineRun("thread-ada", 1),
        engineRun("thread-ada", 2, {
          joins: run1 as never,
          trigger: { kind: "wake", cause: "self", wakeId: null } as never,
          state: "running",
          end: null,
          endedAt: null,
        }),
      ],
      row: {
        state: { kind: "working", since: 1, waitsOnHelpers: false },
        activeRunId: "thread-ada/r/2",
        latestRun: { id: "thread-ada/r/2", end: null, endedAt: null },
      },
      turn: { turnId: run1, state: "running" },
      session: "running",
      active: run1,
    },
    {
      name: "a message queued behind a working run leaves the working run the turn",
      runs: [
        engineRun("thread-ada", 1, { state: "running", end: null, endedAt: null }),
        engineRun("thread-ada", 2, { state: "queued", end: null, endedAt: null, startedAt: null }),
      ],
      row: {
        state: { kind: "queued", since: 1 },
        activeRunId: "thread-ada/r/2",
        latestRun: { id: "thread-ada/r/2", end: null, endedAt: null },
      },
      turn: { turnId: run1, state: "running" },
      session: "running",
      active: run1,
    },
  ] as const)(
    "gives a held conversation's thread shell the turn its records say: $name",
    ({ runs, row, turn, session, active }) => {
      const state = apply(held({ runs: runs as ReadonlyArray<RunRecord> }), [
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
                ...engineRow(ENV, "thread-ada", row as Partial<ConversationRow>),
                environmentId: ENV,
              },
              revision: revision(100),
            },
          ],
          removals: [],
        },
      ]);
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
      const read = readsOfState(state);
      const overlaid = Option.getOrNull(
        overlayEngineShell(
          shellState,
          engineRows.derive(read, ENV),
          engineHeldTurns.derive(read, ENV),
        ).snapshot,
      )?.threads[0];
      expect(overlaid?.latestTurn).toMatchObject(turn);
      expect(overlaid?.session?.status).toBe(session);
      expect(overlaid?.session?.activeTurnId).toBe(active);
    },
  );

  it.each([
    {
      name: "Supervised on the engine over V1's Full access reads Supervised",
      v1: "full-access",
      engine: "approval-required",
      reads: "approval-required",
    },
    {
      name: "Full access on the engine over V1's Supervised reads Full access",
      v1: "approval-required",
      engine: "full-access",
      reads: "full-access",
    },
    {
      name: "an engine record no person set reads V1's",
      v1: "approval-required",
      engine: undefined,
      reads: "approval-required",
    },
  ] as const)(
    "gives a held conversation's thread shell the access its engine record holds: $name",
    ({ v1, engine, reads }) => {
      const state = apply(held({ header: engine === undefined ? {} : { runtimeMode: engine } }), [
        {
          kind: "delivery",
          via: "mate-direct",
          scopes: [{ scope: engineRowsScope(ENV), generation: 0 }],
          reset: true,
          rows: [
            {
              family: "mateEngineRow",
              id: engineFactId(ENV, "thread-ada"),
              value: { ...engineRow(ENV, "thread-ada"), environmentId: ENV },
              revision: revision(100),
            },
          ],
          removals: [],
        },
      ]);
      const shellState = {
        snapshot: Option.some({
          snapshotSequence: 1,
          projects: [],
          threads: [
            {
              ...shellThread,
              runtimeMode: v1,
              session: { ...shellThread.session, runtimeMode: v1 },
            },
          ],
          updatedAt: "2026-10-01T00:00:00.000Z",
        }),
        status: "live",
        error: Option.none(),
      } as unknown as Parameters<typeof overlayEngineShell>[0];
      const read = readsOfState(state);
      const overlaid = Option.getOrNull(
        overlayEngineShell(
          shellState,
          engineRows.derive(read, ENV),
          engineHeldTurns.derive(read, ENV),
        ).snapshot,
      )?.threads[0];
      expect(overlaid?.runtimeMode).toBe(reads);
      expect(overlaid?.session?.runtimeMode).toBe(reads);
    },
  );

  it("gives a thread shell the access its row says while its conversation is not held", () => {
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
    const overlaid = Option.getOrNull(
      overlayEngineShell(shellState, [
        engineRow(ENV, "thread-ada", { runtimeMode: "approval-required" }),
      ]).snapshot,
    )?.threads[0];
    expect(overlaid?.runtimeMode).toBe("approval-required");
    expect(overlaid?.session?.runtimeMode).toBe("approval-required");
  });

  // Engine final run, G10: the archived conversation's menu shell said nothing of it, so its view
  // read live, with a composer that sent nothing and no Restore.
  it.each([
    { archived: true, reads: "archived" },
    { archived: false, reads: "live" },
  ])(
    "gives a held conversation's thread shell its archive as its record says: $reads",
    ({ archived }) => {
      const state = apply(held({ header: { archived } }), [
        {
          kind: "delivery",
          via: "mate-direct",
          scopes: [{ scope: engineRowsScope(ENV), generation: 0 }],
          reset: true,
          rows: [
            {
              family: "mateEngineRow",
              id: engineFactId(ENV, "thread-ada"),
              value: { ...engineRow(ENV, "thread-ada"), environmentId: ENV },
              revision: revision(100),
            },
          ],
          removals: [],
        },
      ]);
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
      const read = readsOfState(state);
      const overlaid = Option.getOrNull(
        overlayEngineShell(
          shellState,
          engineRows.derive(read, ENV),
          engineHeldTurns.derive(read, ENV),
        ).snapshot,
      )?.threads[0];
      expect(overlaid?.archivedAt != null).toBe(archived);
    },
  );
});

describe("a crewmate's engine conversation", () => {
  const backend = "crew-main-backend-1";
  const crewmateAgent = {
    instanceId: "claudeAgent",
    driver: "claudeAgent",
    model: "claude-sonnet-4-5",
    profile: { kind: "crewmate", id: "backend", name: "Backend" },
  } as const;
  const mateShell = (threads: ReadonlyArray<unknown>) =>
    ({
      snapshot: Option.some({
        snapshotSequence: 1,
        projects: [{ id: "project-ada" }],
        threads,
        updatedAt: "2026-10-01T00:00:00.000Z",
      }),
      status: "live",
      error: Option.none(),
    }) as unknown as Parameters<typeof overlayEngineShell>[0];
  const threadsOf = (shell: Parameters<typeof overlayEngineShell>[0]) =>
    Option.getOrNull(shell.snapshot)?.threads ?? [];

  it("is a crew thread in the Mate's shell, on its row, though V1's shell never had it", () => {
    const shell = overlayEngineShell(mateShell([]), [
      engineRow(ENV, backend, {
        agent: crewmateAgent,
        state: { kind: "working", since: 1, waitsOnHelpers: false },
        activeRunId: `${backend}/r/3` as never,
      }),
    ]);
    expect(threadsOf(shell)).toMatchObject([
      {
        id: backend,
        projectId: "project-ada",
        title: "Backend",
        crew: { crew: "main", crewmate: "backend", stint: 1 },
        session: { status: "running", activeTurnId: `${backend}/r/3` },
        archivedAt: null,
      },
    ]);
  });

  it("adds no second thread for a conversation V1 already has", () => {
    const imported = { id: backend, projectId: "project-ada", title: "Backend (V1)" };
    const shell = overlayEngineShell(mateShell([imported]), [
      engineRow(ENV, backend, { agent: crewmateAgent }),
    ]);
    expect(threadsOf(shell).map((each) => [each.id, each.title])).toEqual([
      [backend, "Backend (V1)"],
    ]);
  });

  it("is a crew thread when the conversation is drawn, named by its crewmate", () => {
    const crewKey: EngineConversationKey = { environmentId: ENV, conversationId: backend };
    const scopes = Object.values(engineConversationScopes(crewKey));
    const state = apply(emptyAccount, [
      {
        kind: "delivery",
        via: "mate-direct",
        scopes: scopes.map((scope) => ({ scope, generation: 0 })),
        reset: true,
        partial: true,
        rows: [
          {
            family: "mateEngineConversation",
            id: engineConversationId(crewKey),
            value: {
              environmentId: ENV,
              header: engineHeader(backend, { agent: crewmateAgent }),
              window: { oldestOrdinal: 1, earlier: false },
            },
            revision: revision(9),
          },
        ],
        removals: [],
      },
    ]);
    const drawn = Option.getOrNull(engineThread.derive(readsOfState(state), crewKey).data);
    expect(drawn).toMatchObject({
      id: backend,
      title: "Backend",
      crew: { crew: "main", crewmate: "backend", stint: 1 },
    });
    // The Mate's own conversation is a person's thread.
    expect(thread(held({}))?.crew).toBeUndefined();
  });
});

describe("the crew on an engine conversation's record", () => {
  const activitiesOf = (items: ReadonlyArray<Item>) =>
    thread(held({ runs: [engineRun("thread-ada", 1)], items }))?.activities ?? [];
  const card = {
    kind: "task",
    taskId: "task-12",
    number: 12,
    title: "Add pagination to /api/items",
    why: "Cursor based, 50 per page.",
    doneWhen: "npm test passes",
    links: [{ kind: "crewmate", handle: "backend" }],
  } as const;

  it("a task's first message carries the issue it brings, for its card; a typed one carries none", () => {
    const issue = {
      kind: "github-issue",
      repo: "acme/tea-shop",
      number: 12,
      url: "https://github.com/acme/tea-shop/issues/12",
      title: "Fix the checkout total",
      author: "nova-dev",
    } as const;
    const drawn = thread(
      held({
        runs: [engineRun("thread-ada", 1)],
        items: [
          personItem(run1, 1, "Work issue #12 in the project, then open a change.", {
            task: issue,
          }),
          personItem(run1, 2, "Also check the tax line"),
        ],
      }),
    );
    expect(drawn?.messages).toMatchObject([
      { role: "user", task: issue },
      { role: "user", text: "Also check the tax line" },
    ]);
    expect(drawn?.messages[1]).not.toHaveProperty("task");
  });

  it("a task's first message carries its asker's words, for their row; a typed one carries none", () => {
    const drawn = thread(
      held({
        runs: [engineRun("thread-ada", 1)],
        items: [
          personItem(run1, 1, "Work issue #12 in the project, then open a change.", {
            taskAsk: "The total skips the tax line.",
          }),
          personItem(run1, 2, "Also check the tax line"),
        ],
      }),
    );
    expect(drawn?.messages[0]).toMatchObject({
      role: "user",
      taskAsk: "The total skips the tax line.",
    });
    expect(drawn?.messages[1]).not.toHaveProperty("taskAsk");
  });

  it("a task's messages carry its id, for the one conversation every task runs in; a typed one carries none", () => {
    const drawn = thread(
      held({
        runs: [engineRun("thread-ada", 1)],
        items: [
          personItem(run1, 1, "Work issue #12 in the project, then open a change.", {
            taskId: "task-12",
          }),
          personItem(run1, 2, "Also check the tax line"),
        ],
      }),
    );
    expect(drawn?.messages[0]).toMatchObject({ role: "user", taskId: "task-12" });
    expect(drawn?.messages[1]).not.toHaveProperty("taskId");
  });

  it("a follow-up told to a task's Mate carries who said it and where, for its row; a typed one carries none", () => {
    const comment = {
      id: "c1",
      from: "comment",
      author: "nova-dev",
      text: "Keep the old rounding for invoices.",
    } as const;
    const drawn = thread(
      held({
        runs: [engineRun("thread-ada", 1)],
        items: [
          personItem(run1, 1, "nova-dev (comment): Keep the old rounding for invoices.", {
            taskMessage: comment,
          }),
          personItem(run1, 2, "Also check the tax line"),
        ],
      }),
    );
    expect(drawn?.messages).toMatchObject([
      { role: "user", taskMessage: comment },
      { role: "user", text: "Also check the tax line" },
    ]);
    expect(drawn?.messages[1]).not.toHaveProperty("taskMessage");
  });

  it("draws a crew card as its run's opening card, typed, never as the agent's answer", () => {
    const drawn = thread(
      held({
        runs: [engineRun("thread-ada", 1)],
        items: [
          noteItem(run1, 1, "#12 Add pagination to /api/items · from you\n\nCursor based.", {
            by: { kind: "engine" },
            answer: false,
            card,
          } as never),
          noteItem(run1, 2, "Paginated."),
        ],
      }),
    );
    expect(drawn?.messages).toMatchObject([
      { role: "user", turnId: run1, crewCard: card },
      { role: "assistant", text: "Paginated." },
    ]);
    expect(drawn?.messages[1]).not.toHaveProperty("crewCard");
  });

  it.each([
    {
      name: "landed",
      seam: { seam: "landed", taskId: "task-12", number: 12, commit: "a1b2c3d" },
      reason: undefined,
      words: "Task #12 landed as a1b2c3d",
    },
    {
      name: "closed",
      seam: { seam: "closed", taskId: "task-12", number: 12 },
      reason: undefined,
      words: "Task #12 closed — nothing to land",
    },
    {
      name: "saved, in the crew's words",
      seam: { seam: "saved", apply: "now" },
      reason: "Its job changed — from now on",
      words: "Its job changed — from now on",
    },
    {
      name: "saved, the crew giving no words",
      seam: { seam: "saved", apply: "nextTurn" },
      reason: undefined,
      words: "Its setup changed — from its next message",
    },
  ] as const)("draws a $name seam as the crew seam V1 draws", ({ seam, reason, words }) => {
    expect(
      activitiesOf([
        markerItem(run1, 2, {
          kind: "crew.seam",
          seam,
          ...(reason === undefined ? {} : { reason }),
        } as never),
      ]),
    ).toMatchObject([{ kind: "crew.seam", summary: words, payload: seam }]);
  });

  it("draws nothing for a seam of a newer build", () => {
    expect(
      activitiesOf([
        markerItem(run1, 2, {
          kind: "crew.seam",
          seam: { seam: "unknown", type: "moved" },
        } as never),
      ]),
    ).toEqual([]);
  });

  it.each([
    ["cleared", "You cleared its conversation — it keeps its job and its work"],
    ["context", "It started afresh: its conversation grew too long — it carries on from memory"],
    ["job", "Its job changed — it started afresh"],
    ["login", "It runs on a different login now"],
    ["budget", "Its budget changed — it carries on"],
    ["task", "It started afresh for unrelated work"],
    ["unknown", "It started afresh"],
  ] as const)(
    "draws a session that rotated for %s as the line saying why, in the same conversation",
    (reason, words) => {
      expect(
        activitiesOf([markerItem(run1, 2, { kind: "session-rotated", reason })]),
      ).toMatchObject([
        {
          kind: "crew.seam",
          summary: words,
          payload: { seam: "stint", previousThreadId: null },
        },
      ]);
    },
  );

  it("draws no line where a task in an automated Mate's one conversation starts afresh: its card marks the start", () => {
    const tasks = { environmentId: ENV, conversationId: MATE_TASKS_CONVERSATION_ID };
    const state = held(
      {
        runs: [engineRun(MATE_TASKS_CONVERSATION_ID, 1)],
        items: [
          personItem(`${MATE_TASKS_CONVERSATION_ID}/r/1`, 1, "Add a footer"),
          markerItem(`${MATE_TASKS_CONVERSATION_ID}/r/1`, 2, {
            kind: "session-rotated",
            reason: "task",
          }),
        ],
      },
      [],
      tasks,
    );
    expect(thread(state, tasks)?.messages).toHaveLength(1);
    expect(thread(state, tasks)?.activities).toEqual([]);
  });
});

it.each([
  { continuedBy: null, notContinued: undefined, continuation: "automatic" },
  { continuedBy: "thread-ada/r/2", notContinued: undefined, continuation: "continued" },
  { continuedBy: null, notContinued: "a Stop was asked", continuation: "none" },
])(
  "restart continuation is shown only as its run records it: $continuation",
  ({ continuedBy, notContinued }) => {
    const restart = { cause: "replaced" as const, at: "2026-10-08T08:24:39.700Z" };
    const end = {
      kind: "cut-by-restart" as const,
      continuedBy: continuedBy === null ? null : RunId.make(continuedBy),
      restart,
      ...(notContinued === undefined ? {} : { notContinued }),
    };
    const state = held({ runs: [engineRun("thread-ada", 1, { end })] });
    const view = thread(state);
    expect(engineRunCards.derive(readsOfState(state), key)?.[run1]?.runs[0]?.end).toEqual(end);
    expect(view?.session?.lastError).toBeNull();
  },
);

// An idle helper is resumable, not working: its card closes when its run ends, as V1 settled it.
it.each([
  { status: "running", waits: { helpers: 1, commands: 0 } },
  { status: "waiting", waits: { helpers: 1, commands: 0 } },
  { status: "idle", waits: undefined },
] as const)(
  "a run that ended holds its card open for a helper that is $status: $waits",
  ({ status, waits }) => {
    const state = held({
      runs: [engineRun("thread-ada", 1, { state: "ended", end: { kind: "completed" } } as never)],
      items: [workItem(run1, 2, { status })],
    });
    expect(engineRunCards.derive(readsOfState(state), key)?.[run1]?.waitsOn).toEqual(waits);
  },
);

// V1 never recorded a turn its admission refused: the person's words went back to the composer.
it("a message admission refused before anything ran goes back to its sender, never into the conversation", () => {
  const state = held({
    runs: [
      engineRun("thread-ada", 1, {
        startedAt: null,
        end: {
          kind: "failed",
          reason: "Claude's sign-in has expired.",
          next: null,
          admission: { loginId: "claude-code", reason: "expired-login" },
        },
      }),
    ],
    items: [personItem(run1, 1, "Start work", { delivery: { state: "refused", at: null } })],
  });
  expect(thread(state)?.messages.map((message) => message.text)).toEqual([]);
  expect(engineRunCards.derive(readsOfState(state), key)?.[run1]?.refused).toEqual({
    messageId: `send-${run1}-1`,
    text: "Start work",
  });
});

// The run's card says how it broke off; the banner never says it a second time.
const failedEnd = (reason: string) => ({ kind: "failed", reason, next: null }) as const;
it.each([
  ["a run that failed once it ran", { end: failedEnd("The agent process failed") }, true],
  [
    "a run that crashed once it ran",
    { end: { kind: "crashed", reason: "The agent process failed" } },
    true,
  ],
  [
    "a run refused before anything of it ran",
    { startedAt: null, end: failedEnd("The agent process failed") },
    false,
  ],
  ["a run that broke off with other words", { end: failedEnd("Another failure") }, false],
  ["a run that completed", { end: { kind: "completed" } }, false],
] as const)("the error a card draws is its card's to say: %s", (_, patch, shown) => {
  const state = held({ runs: [engineRun("thread-ada", 1, patch as Partial<RunRecord>)] });
  expect(
    engineCardsShowError(
      engineRunCards.derive(readsOfState(state), key),
      "The agent process failed",
    ),
  ).toBe(shown);
});

// The durable engine record is the reload input; both deliveries pass through the real reducer and chat projection.
it("J03: current model and explicit effort remain selected after send and reload", () => {
  for (const effort of ["high", "max"]) {
    const records: Parameters<typeof held>[0] = {
      header: {
        model: "claude-opus",
        agent: {
          instanceId: "claudeAgent",
          driver: "claudeAgent",
          profile: { kind: "mate" },
          model: "claude-opus",
          options: [{ id: "effort", value: effort }],
        },
      },
      runs: [engineRun("thread-ada", 1)],
      items: [personItem(run1, 1, "Inspect at my chosen effort")],
    };
    for (const state of [held(records), held(structuredClone(records))]) {
      expect(thread(state)?.modelSelection).toEqual({
        instanceId: "claudeAgent",
        model: "claude-opus",
        options: [{ id: "effort", value: effort }],
      });
      expect(thread(state)?.messages[0]?.text).toBe("Inspect at my chosen effort");
    }
  }
});

it("J05: picture notes and attachment order survive send and reload", () => {
  const layout = {
    type: "image" as const,
    id: "layout",
    name: "layout.png",
    mimeType: "image/png",
    sizeBytes: 3,
  };
  const detail = { ...layout, id: "detail", name: "detail.png", sizeBytes: 5 };
  for (const attachments of [
    [layout, detail],
    [detail, layout],
  ]) {
    const words = "Inspect these pictures in this order\nMove this action beside its heading";
    const records = {
      runs: [engineRun("thread-ada", 1)],
      items: [personItem(run1, 1, words, { attachments })],
    };
    for (const state of [held(records), held(structuredClone(records))]) {
      const message = thread(state)?.messages[0];
      expect(message?.text).toBe(words);
      expect(message?.attachments).toEqual(attachments);
    }
  }
});

it("decline an agent command and see it resolve", () => {
  const ask = { kind: "approval" as const, requestKind: "command", detail: "vp run build" };
  for (const state of ["open", "answered"] as const) {
    const request = engineRequest(
      run1,
      1,
      ask,
      state === "open"
        ? {}
        : {
            state,
            answer: { by: { kind: "person", subject: "u" }, at: 5, summary: "Declined" },
          },
    );
    const activities = thread(
      held({ runs: [engineRun("thread-ada", 1)], requests: [request] }),
    )!.activities;
    expect(derivePendingRequests(activities).approvals.map(({ requestId }) => requestId)).toEqual(
      state === "open" ? [request.id] : [],
    );
    expect(
      activities.filter(({ kind }) => kind === "approval.resolved").map(({ summary }) => summary),
    ).toEqual(state === "open" ? [] : ["Declined"]);
  }
});

import {
  importedCallFields,
  type ConversationRow,
  type Item,
  type Request,
  type RunRecord,
} from "@t3tools/contracts";
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
import {
  engineHeldTurns,
  engineRows,
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
      name: "work its session lost ended stopped",
      item: { workKind: "shell", status: "lost" },
      kinds: ["task.started", "task.completed"],
      payload: { status: "stopped" },
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
      marker: { kind: "capture-gap", reason: "api: Snapshot refused: disk full" },
      expected: {
        kind: "runtime.warning",
        summary: "The workspace was not captured",
        payload: { message: "api: Snapshot refused: disk full" },
      },
    },
  ])("a $marker.kind marker is the event V1 draws for it", ({ marker, expected }) => {
    expect(activitiesOf([markerItem(run1, 2, marker)])).toMatchObject([expected]);
  });

  it("a marker this build does not know draws nothing", () => {
    expect(activitiesOf([markerItem(run1, 2, { kind: "rewound" })])).toEqual([]);
  });

  it("an item of a newer build shows its summary, or nothing when it gives none", () => {
    expect(activitiesOf([unknownItem(run1, 2, "Plan updated")])).toMatchObject([
      { summary: "Plan updated", turnId: run1 },
    ]);
    expect(activitiesOf([unknownItem(run1, 2, null)])).toEqual([]);
  });

  it.each([
    { end: { kind: "crashed", reason: "The agent exited." }, turnEnd: "crash" },
    { end: { kind: "failed", reason: "Bad request", next: null }, turnEnd: "failed" },
    { end: { kind: "usage-limit", resetsAt: null }, turnEnd: "usage-limit" },
  ] as const)("a run that ended $end.kind ends with V1's break", ({ end, turnEnd }) => {
    const activities = activitiesOf([], [engineRun("thread-ada", 1, { end })]);
    expect(activities).toMatchObject([
      { kind: "runtime.error", tone: "error", turnId: run1, payload: { turnEnd } },
    ]);
  });

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
});

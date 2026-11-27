import { expect, it } from "vite-plus/test";
import * as Option from "effect/Option";
import type { Item, Request, RunRecord } from "@t3tools/contracts";
import {
  engineConversationId,
  engineConversationScopes,
  engineFactId,
  type EngineConversationKey,
} from "../families/mateEngine.ts";
import { emptyAccount, type AccountState, type Revision } from "../model.ts";
import { reduceAccount, type AccountInput, type Row } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import {
  engineHeader,
  engineRow,
  engineRun,
  personItem,
  workItem,
} from "../__fixtures__/mateEngine.ts";
import {
  engineRunCards,
  engineStopTarget,
  engineThread,
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
    // Held: a view demands it, so its records are observed.
    ...scopes.map((scope): AccountInput => ({
      kind: "stream",
      key: scope,
      now: 0,
      event: { kind: "demand", demanded: true },
    })),
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

// witness: packages/client-runtime/src/data/projections/mateEngine.ts | ...(item.runId !== null && queued(item.runId) ? { heldRunId: item.runId } : {}), → ...(item.runId !== null && !queued(item.runId) ? { heldRunId: item.runId } : {}),
it("PJ71: A message no agent has taken yet can be withdrawn; one the agent took cannot", () => {
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

// witness: packages/client-runtime/src/data/projections/mateEngine.ts | if (item.delivery.state === "refused" && refusedAtAdmission(item.runId)) return null; → if (item.delivery.state === "queued" && refusedAtAdmission(item.runId)) return null;
it("PJ72: A message whose admission was refused before anything ran goes back to its sender, never into the conversation", () => {
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

// witness: packages/client-runtime/src/data/projections/mateEngine.ts | stream.fault?.outcome === "authoritative-denial"; → stream.fault?.outcome === "definitive-refusal";
it("PJ73: An engine conversation shows nothing it held while its Mate withholds access", () => {
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

// witness: packages/client-runtime/src/data/projections/mateEngine.ts | return active !== undefined && rootOf(active).id === turnId ? active.id : turnId; → return active !== undefined && active.id === turnId ? active.id : turnId;
it("PJ74: Stop on a card that a continuing run shares ends the run that works", () => {
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

// witness: packages/client-runtime/src/data/projections/mateEngine.ts | const active = runs.find((run) => run.id === activeId); → const active = runs.findLast((run) => run.state !== "ended");
it("PJ107: A message queued behind a working run leaves the working run the turn Stop ends; breaks: Stop withdraws the queued message while the work it should stop goes on", () => {
  const working = engineRun("thread-ada", 1, { state: "running", end: null, endedAt: null });
  const state = held({
    runs: [
      working,
      engineRun("thread-ada", 2, {
        state: "queued",
        end: null,
        endedAt: null,
        startedAt: null,
        queuedAt: (working.startedAt ?? 0) + 500,
      }),
    ],
  });
  expect(thread(state)?.latestTurn).toMatchObject({ turnId: run1, state: "running" });
  expect(thread(state)?.session).toMatchObject({ status: "running", activeTurnId: run1 });
  expect(engineStopTarget(readsOfState(state), key, run1)).toBe(run1);
});

// witness: packages/client-runtime/src/data/projections/mateEngine.ts | status: header?.runStatus === "unknown" ? "stopped" : (header?.runStatus ?? "stopped"), → status: header?.runStatus === "unknown" ? "stopped" : (header?.runStatus ?? "running"),
it("PJ106: A missing or unknown run verdict from the server reads stopped, and no turn is guessed from the run records; breaks: a conversation on a Mate that does not say its run state reads as working, with a Stop that ends nothing", () => {
  for (const runStatus of [undefined, "unknown"] as const) {
    const view = thread(
      held({
        runs: [engineRun("thread-ada", 1, { state: "running", end: null, endedAt: null })],
        header: { runStatus, activeRunId: null, latestRunId: null },
      }),
    );
    expect([view?.session?.status, view?.session?.activeTurnId, view?.latestTurn]).toEqual([
      "stopped",
      null,
      null,
    ]);
  }
});

// witness: packages/client-runtime/src/data/projections/mateEngine.ts | if (end === undefined) → if (end !== undefined)
it("PJ105: Background work reads by its kind and its status: a running helper is a helper on the run, and one that finished has ended; breaks: a finished helper keeps reading as working, or a running one as ended", () => {
  const activities = (status: "running" | "completed") =>
    (
      thread(
        held({
          runs: [engineRun("thread-ada", 1)],
          items: [workItem(run1, 2, { workKind: "helper", status })],
        }),
      )?.activities ?? []
    ).map((activity) => ({
      kind: activity.kind,
      taskType: (activity.payload as { readonly taskType?: string }).taskType,
      status: (activity.payload as { readonly status?: string }).status,
    }));
  expect(activities("running")).toEqual([
    { kind: "task.started", taskType: "local_agent", status: undefined },
  ]);
  expect(activities("completed")).toEqual([
    { kind: "task.started", taskType: "local_agent", status: undefined },
    { kind: "task.completed", taskType: "local_agent", status: "completed" },
  ]);
});

const shellOf = (threads: ReadonlyArray<Record<string, unknown>>) =>
  ({
    snapshot: Option.some({
      snapshotSequence: 1,
      projects: [{ id: "project-ada" }],
      threads: threads.map((each) => ({
        id: "thread-ada",
        projectId: "project-ada",
        title: "Ada",
        modelSelection: { instanceId: "codex", model: "gpt-5" },
        runtimeMode: "full-access",
        interactionMode: "default",
        latestTurn: null,
        archivedAt: null,
        updatedAt: "2026-10-01T00:00:00.000Z",
        session: null,
        ...each,
      })),
      updatedAt: "2026-10-01T00:00:00.000Z",
    }),
    status: "live",
    error: Option.none(),
  }) as unknown as Parameters<typeof overlayEngineShell>[0];
const threadsOf = (shell: Parameters<typeof overlayEngineShell>[0]) =>
  Option.getOrNull(shell.snapshot)?.threads ?? [];

// witness: packages/client-runtime/src/data/projections/mateEngine.ts | const runtimeMode = held?.runtimeMode ?? known(row.runtimeMode) ?? thread.runtimeMode; → const runtimeMode = thread.runtimeMode ?? held?.runtimeMode ?? known(row.runtimeMode);
it("PJ104: An engine conversation its V1 shell already lists stays one thread, whose access is the engine's record over the shell's and the shell's only where the engine holds none; breaks: the menu lists the conversation twice, or shows Full access on one a person set to Supervised", () => {
  const reads = (v1: string, engine: "full-access" | "approval-required" | undefined) =>
    threadsOf(
      overlayEngineShell(shellOf([{ title: "Ada (V1)", runtimeMode: v1 }]), [
        engineRow(ENV, "thread-ada", engine === undefined ? {} : { runtimeMode: engine }),
      ]),
    ).map((each) => [each.id, each.title, each.runtimeMode, each.session?.runtimeMode]);
  expect([
    reads("full-access", "approval-required"),
    reads("approval-required", "full-access"),
    reads("approval-required", undefined),
  ]).toEqual([
    [["thread-ada", "Ada (V1)", "approval-required", "approval-required"]],
    [["thread-ada", "Ada (V1)", "full-access", "full-access"]],
    [["thread-ada", "Ada (V1)", "approval-required", "approval-required"]],
  ]);
});

// witness: packages/client-runtime/src/data/projections/mateEngine.ts | ...(marker.reason === "cleared" && → ...(marker.reason !== "cleared" &&
it("PJ162: A crewmate's conversation names the person who cleared it on that line, and no one on a new session the crew opened by itself; breaks: a colleague's Start fresh, or the crew's own, reads as the person looking having cleared it", () => {
  const rotated = (ordinal: number, reason: string): Item =>
    ({
      id: `thread-ada/b/${ordinal}`,
      conversationId: "thread-ada",
      runId: null,
      seq: ordinal,
      rev: ordinal,
      at: ordinal,
      by: { kind: "person", principal: { kind: "person", subject: "user-ada" } },
      kind: "marker",
      marker: { kind: "session-rotated", reason },
    }) as Item;
  const state = held({
    runs: [engineRun("thread-ada", 1)],
    items: [personItem(run1, 1, "Build it"), rotated(10, "cleared"), rotated(11, "context")],
  });
  expect(
    thread(state)
      ?.activities.filter((activity) => activity.kind === "crew.seam")
      .map((activity) => (activity.payload as { readonly by?: string }).by ?? null),
  ).toEqual(["user-ada", null]);
});

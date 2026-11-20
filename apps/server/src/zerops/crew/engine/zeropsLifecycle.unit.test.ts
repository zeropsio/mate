import {
  ConversationId,
  type ItemLifecyclePayload,
  type SpiEvent,
  type ThreadId,
  type ThreadLease,
} from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import { conversationOfThread, providerThreadOf } from "../../../engine/MateEngine.ts";
import { PersistenceSqlError } from "../../../persistence/Errors.ts";
import { SqlitePersistenceMemory } from "../../../persistence/Layers/Sqlite.ts";
import * as ZeropsThreadLifecycle from "../../../persistence/ZeropsThreadLifecycle.ts";
import { applyToolCall } from "../../../spi/toolCall.ts";
import type { LeaseChange } from "../../lease/leaseBinding.ts";
import { ZEROPS_ENVELOPE_FENCE } from "../../zeropsEnvelope.ts";
import * as ZeropsLifecycle from "../../ZeropsLifecycle.ts";

const THREAD = "thread-1" as ThreadId;
const CONVERSATION = ConversationId.make("mate");
const SESSION = providerThreadOf(CONVERSATION);
/** The conversation the lifecycle reads a provider session's events on. */
const OWNER = CONVERSATION as string as ThreadId;

const envelopeJsonText = (phase: string) =>
  JSON.stringify({
    phase,
    environment: "container",
    project: { id: "proj-1", name: "z3-eval" },
    services: [
      {
        hostname: "kanbandev",
        typeVersion: "nodejs@22",
        runtimeClass: "dynamic",
        status: "ACTIVE",
        bootstrapped: true,
      },
    ],
    generated: "2026-08-28T12:00:00Z",
  });

const envelopeBlock = (phase: string) =>
  `## Status\n\nPhase: ${phase}\n\n\`\`\`${ZEROPS_ENVELOPE_FENCE}\n${envelopeJsonText(phase)}\n\`\`\`\n`;

let eventCounter = 0;

/**
 * A Claude `item.completed`/`item.started` for one tool, with its tool call attached by
 * `applyToolCall`, the enrichment the real bus applies.
 */
const claudeEvent = (options: {
  readonly threadId?: ThreadId;
  readonly toolName?: string;
  readonly text?: string;
  readonly type?: "item.started" | "item.completed";
  readonly itemId?: string;
  readonly input?: Record<string, unknown>;
  readonly isError?: boolean;
}): SpiEvent =>
  applyToolCall({
    eventId: `evt-${(eventCounter += 1)}`,
    provider: "claudeAgent",
    threadId: options.threadId ?? THREAD,
    createdAt: "2026-08-28T12:00:00Z",
    type: options.type ?? "item.completed",
    itemId: options.itemId ?? `toolu_${options.toolName ?? "workflow"}`,
    payload: {
      itemType: "mcp_tool_call",
      status: options.type === "item.started" ? "inProgress" : "completed",
      title: "zerops",
      data: {
        toolName: options.toolName ?? "mcp__zerops__zerops_workflow",
        input: options.input ?? { action: "status" },
        ...(options.type === "item.started"
          ? {}
          : {
              result: {
                type: "tool_result",
                tool_use_id: options.itemId ?? "toolu_01",
                content: [{ type: "text", text: options.text ?? envelopeBlock("develop-active") }],
                ...(options.isError === true ? { is_error: true } : {}),
              },
            }),
      },
    } satisfies ItemLifecyclePayload,
  } as SpiEvent);

const persistence = ZeropsThreadLifecycle.layer.pipe(Layer.provideMerge(SqlitePersistenceMemory));

/** The feed over a fresh store; `ingest` is its receipt: it returns once the event is folded in. */
const withLifecycle = <A, E>(
  use: (lifecycle: ZeropsLifecycle.ZeropsLifecycle["Service"]) => Effect.Effect<A, E, never>,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const repository = yield* ZeropsThreadLifecycle.ZeropsThreadLifecycleRepository;
      const lifecycle = yield* ZeropsLifecycle.make({
        toolEvents: Stream.empty as Stream.Stream<SpiEvent>,
        repository,
        threadOwner: conversationOfThread,
      });
      return yield* use(lifecycle);
    }),
  ).pipe(Effect.provide(persistence));

/** `branch` null: a lease acquired for none. */
const lease = (alias: string, state = "held", branch: string | null = "feat-x") => ({
  alias,
  pool: "webpool",
  ...(branch === null ? {} : { branch }),
  containerHostname: `node-id-${alias.split("-")[1]}.runtime.webpool.zerops`,
  state,
  unverified: false,
});
const envelopeWith = (leases: ReadonlyArray<unknown> | undefined) => ({
  ...JSON.parse(envelopeJsonText("develop-active")),
  ...(leases === undefined ? {} : { leases }),
});
/** A `zerops_lease` call's result, as zcp's JSON carrier writes it. */
const leaseCall = (options: {
  readonly input: Record<string, unknown>;
  readonly leases?: ReadonlyArray<unknown>;
  readonly envelope?: ReadonlyArray<unknown> | undefined;
  readonly threadId?: ThreadId;
}) =>
  claudeEvent({
    threadId: options.threadId ?? SESSION,
    toolName: "mcp__zerops__zerops_lease",
    input: options.input,
    text: JSON.stringify({
      action: options.input.action,
      leases: options.leases ?? [],
      envelope: envelopeWith(options.envelope),
    }),
  });
const acquire = (alias: string, held: ReadonlyArray<unknown>, branch = "feat-x") =>
  leaseCall({
    input: { action: "acquire", pool: "webpool", branch },
    leases: [lease(alias, "held", branch)],
    envelope: held,
  });
/** Any other Zerops tool whose envelope reads zcp's leases. */
const statusReading = (leases: ReadonlyArray<unknown> | undefined) =>
  claudeEvent({
    threadId: SESSION,
    toolName: "mcp__zerops__zerops_deploy",
    text: JSON.stringify({ status: "DEPLOYED", envelope: envelopeWith(leases) }),
  });

/** What a `zerops_lease action=status` call read of a lease's checkout (spec-mate §2.8a.3). */
const read = (readAt: string, lastChangeAt: string) => ({
  lastChangeAt,
  previewOpenConns: 0,
  acquiredAt: "2026-10-23T18:00:00Z",
  readAt,
});
const acquiredAt = "2026-10-23T18:00:00Z";
const unsaved = { files: [" M src/App.tsx"], fileCount: 1, unpushedCommits: 2 };
/** A `zerops_lease action=status` call, whose envelope carries what it read of each lease. */
const leaseStatus = (leases: ReadonlyArray<unknown>) =>
  leaseCall({ input: { action: "status" }, leases, envelope: leases });

interface CheckoutTold {
  readonly alias: string;
  readonly bound: Readonly<Record<string, string>>;
}

/**
 * The feed over conversations whose records bind as the engine's do: a conversation takes its
 * first lease and lets go of it when told the lease ended; each checkout told changed is kept with
 * who was bound to what when it was told.
 */
const withConversations = <A, E>(
  use: (
    lifecycle: ZeropsLifecycle.ZeropsLifecycle["Service"],
    checkouts: () => Effect.Effect<ReadonlyArray<CheckoutTold>>,
  ) => Effect.Effect<A, E, never>,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const repository = yield* ZeropsThreadLifecycle.ZeropsThreadLifecycleRepository;
      const records = yield* Ref.make<Readonly<Record<string, ThreadLease>>>({});
      const changedCheckouts = yield* Ref.make<ReadonlyArray<CheckoutTold>>([]);
      const boundAliases = Effect.map(Ref.get(records), (all) =>
        Object.fromEntries(
          Object.entries(all).map(([conversation, { alias }]) => [conversation, alias]),
        ),
      );
      const lifecycle = yield* ZeropsLifecycle.make({
        toolEvents: Stream.empty as Stream.Stream<SpiEvent>,
        repository,
        threadOwner: conversationOfThread,
        leaseBindings: Effect.map(Ref.get(records), (all) => ({
          bindings: Object.entries(all).map(
            ([conversation, { alias, branch, repo, acquiredAt }]) => ({
              conversation: conversation as ThreadId,
              alias,
              branch,
              repo,
              acquiredAt,
            }),
          ),
          complete: true,
        })),
        recordLease: (conversation, change: LeaseChange) =>
          Ref.update(records, (all) => {
            const { [conversation]: held, ...others } = all;
            if (change._tag === "BindLease")
              return held === undefined ? { ...all, [conversation]: change.lease } : all;
            return held?.alias === change.ended ? others : all;
          }),
        checkoutChanged: (alias) =>
          Effect.flatMap(boundAliases, (bound) =>
            Ref.update(changedCheckouts, (all) => [...all, { alias, bound }]),
          ),
      });
      return yield* use(lifecycle, () => Ref.get(changedCheckouts));
    }),
  ).pipe(Effect.provide(persistence));
const sessionOf = (name: string) => providerThreadOf(ConversationId.make(name));
const release = (alias: string, threadId: ThreadId, held: ReadonlyArray<unknown>) =>
  leaseCall({
    input: { action: "release", lease: alias },
    leases: [lease(alias, "released")],
    envelope: held,
    threadId,
  });
const acquireBy = (threadId: ThreadId, alias: string, held: ReadonlyArray<unknown>) => ({
  ...acquire(alias, held),
  threadId,
});

// witness: apps/server/src/zerops/ZeropsLifecycle.ts | : { envelope: previous.envelope } → : {}
it.effect(
  "CD51: A conversation's Zerops strip shows the newest envelope a zerops tool result carried, fenced or under a JSON envelope key, and a result that carries none or a corrupt one leaves the last envelope standing",
  () =>
    Effect.gen(function* () {
      yield* withLifecycle((lifecycle) =>
        Effect.gen(function* () {
          yield* lifecycle.ingest(claudeEvent({}));
          const state = yield* lifecycle.get(THREAD);
          expect(state.envelope?.phase).toBe("develop-active");
          expect(state.envelope?.services[0]?.hostname).toBe("kanbandev");
          expect(state.recentTools.at(-1)?.toolName).toBe("zerops_workflow");
        }),
      );
      yield* withLifecycle((lifecycle) =>
        Effect.gen(function* () {
          yield* lifecycle.ingest(claudeEvent({ text: envelopeBlock("bootstrap-active") }));
          yield* lifecycle.ingest(claudeEvent({ text: envelopeBlock("develop-active") }));
          expect((yield* lifecycle.get(THREAD)).envelope?.phase).toBe("develop-active");
        }),
      );
      yield* withLifecycle((lifecycle) =>
        Effect.gen(function* () {
          yield* lifecycle.ingest(claudeEvent({}));
          yield* lifecycle.ingest(
            claudeEvent({
              toolName: "mcp__zerops__zerops_deploy",
              text: '{"service":"kanbandev","status":"ok"}',
            }),
          );
          const state = yield* lifecycle.get(THREAD);
          expect(state.envelope?.phase, "a result that carries none").toBe("develop-active");
          expect(state.recentTools.map((tool) => tool.toolName)).toEqual([
            "zerops_workflow",
            "zerops_deploy",
          ]);
        }),
      );
      yield* withLifecycle((lifecycle) =>
        Effect.gen(function* () {
          yield* lifecycle.ingest(
            claudeEvent({
              toolName: "mcp__zerops__zerops_deploy",
              text: `{"service":"kanbandev","status":"ok","envelope":${envelopeJsonText(
                "develop-active",
              )}}`,
            }),
          );
          const state = yield* lifecycle.get(THREAD);
          expect(state.envelope?.phase, "under a JSON envelope key").toBe("develop-active");
          expect(state.recentTools.at(-1)?.toolName).toBe("zerops_deploy");
        }),
      );
      yield* withLifecycle((lifecycle) =>
        Effect.gen(function* () {
          yield* lifecycle.ingest(claudeEvent({}));
          yield* lifecycle.ingest(
            claudeEvent({ text: `text\n\n\`\`\`${ZEROPS_ENVELOPE_FENCE}\nnot json\n\`\`\`\n` }),
          );
          expect((yield* lifecycle.get(THREAD)).envelope?.phase, "a corrupt one").toBe(
            "develop-active",
          );
        }),
      );
    }),
);

// witness: apps/server/src/zerops/ZeropsLifecycle.ts | index < 0 → index <= 0
it.effect(
  "CD52: A started zerops tool shows in progress and its completion updates that same entry in place, and a tool that is not a zerops tool is not recorded",
  () =>
    Effect.gen(function* () {
      yield* withLifecycle((lifecycle) =>
        Effect.gen(function* () {
          yield* lifecycle.ingest(
            claudeEvent({
              toolName: "mcp__zerops__zerops_deploy",
              type: "item.started",
              itemId: "toolu_deploy",
            }),
          );
          expect((yield* lifecycle.get(THREAD)).recentTools).toEqual([
            expect.objectContaining({ toolName: "zerops_deploy", status: "inProgress" }),
          ]);
          yield* lifecycle.ingest(
            claudeEvent({
              toolName: "mcp__zerops__zerops_deploy",
              text: '{"status":"ok"}',
              itemId: "toolu_deploy",
            }),
          );
          expect((yield* lifecycle.get(THREAD)).recentTools).toEqual([
            expect.objectContaining({ toolName: "zerops_deploy", status: "completed" }),
          ]);
        }),
      );
      yield* withLifecycle((lifecycle) =>
        Effect.gen(function* () {
          yield* lifecycle.ingest(claudeEvent({ toolName: "mcp__t3-code__browser_open" }));
          const state = yield* lifecycle.get(THREAD);
          expect(state.recentTools).toEqual([]);
          expect(state.envelope).toBeUndefined();
        }),
      );
    }),
);

// witness: apps/server/src/zerops/ZeropsLifecycle.ts | return service.devServers !== undefined || devServers === undefined → return devServers === undefined
it.effect(
  "CD53: A service's dev servers last read stay on the strip through an envelope that did not read them, and a newer read replaces the whole list",
  () =>
    withLifecycle((lifecycle) =>
      Effect.gen(function* () {
        const devServerRead = (devServers: ReadonlyArray<Record<string, unknown>> | undefined) =>
          claudeEvent({
            toolName: "mcp__zerops__zerops_dev_server",
            text: JSON.stringify({
              hostname: "kanbandev",
              envelope: {
                ...JSON.parse(envelopeJsonText("develop-active")),
                services: [
                  {
                    hostname: "kanbandev",
                    typeVersion: "nodejs@22",
                    runtimeClass: "dynamic",
                    status: "ACTIVE",
                    bootstrapped: true,
                    ...(devServers === undefined ? {} : { devServers }),
                  },
                ],
              },
            }),
          });
        const servers = Effect.map(lifecycle.get(THREAD), (state) =>
          state.envelope?.services[0]?.devServers?.map((server) => [
            server.name,
            server.status,
            server.readAt,
          ]),
        );
        yield* lifecycle.ingest(
          devServerRead([
            { name: "web", port: 3000, status: "running", readAt: "2026-10-14T21:04:00Z" },
            { name: "worker", status: "crashed", readAt: "2026-10-14T21:04:00Z" },
          ]),
        );
        yield* lifecycle.ingest(devServerRead(undefined));
        expect(yield* servers, "an envelope that did not read keeps the last read").toEqual([
          ["web", "running", "2026-10-14T21:04:00Z"],
          ["worker", "crashed", "2026-10-14T21:04:00Z"],
        ]);
        yield* lifecycle.ingest(
          devServerRead([
            { name: "web", port: 3000, status: "stopped", readAt: "2026-10-14T21:09:00Z" },
          ]),
        );
        expect(yield* servers, "a newer read replaces the whole list").toEqual([
          ["web", "stopped", "2026-10-14T21:09:00Z"],
        ]);
      }),
    ),
);

// witness: apps/server/src/zerops/ZeropsLifecycle.ts | const threadId = ThreadId.make(owner ?? event.threadId); → const threadId = ThreadId.make(event.threadId);
it.effect("CD54: A provider session's zerops tools are read on the conversation that owns it", () =>
  withLifecycle((lifecycle) =>
    Effect.gen(function* () {
      yield* lifecycle.ingest(
        claudeEvent({ threadId: providerThreadOf(ConversationId.make(THREAD)) }),
      );
      const state = yield* lifecycle.get(THREAD);
      expect(state.envelope?.project.id).toBe("proj-1");
      expect(state.recentTools.map((tool) => tool.toolName)).toEqual(["zerops_workflow"]);
    }),
  ),
);

// witness: apps/server/src/zerops/ZeropsLifecycle.ts | const previous = yield* load(threadId); → const previous = yield* loadOrEmpty(threadId);
it.effect(
  "CD55: A conversation's Zerops state, its leases' last activity and unsaved work included, is read back after a restart, and a call folded while its stored row cannot be read never writes an empty state over that row",
  () =>
    Effect.gen(function* () {
      yield* Effect.scoped(
        Effect.gen(function* () {
          const repository = yield* ZeropsThreadLifecycle.ZeropsThreadLifecycleRepository;
          yield* Effect.scoped(
            Effect.gen(function* () {
              const lifecycle = yield* ZeropsLifecycle.make({
                toolEvents: Stream.empty as Stream.Stream<SpiEvent>,
                repository,
              });
              yield* lifecycle.ingest(claudeEvent({}));
            }),
          );
          const restarted = yield* ZeropsLifecycle.make({
            toolEvents: Stream.empty as Stream.Stream<SpiEvent>,
            repository,
          });
          expect((yield* restarted.get(THREAD)).envelope?.phase).toBe("develop-active");
        }),
      ).pipe(Effect.provide(persistence));

      yield* Effect.scoped(
        Effect.gen(function* () {
          const repository = yield* ZeropsThreadLifecycle.ZeropsThreadLifecycleRepository;
          const first = read("2026-10-23T20:04:00Z", "2026-10-23T19:12:40Z");
          yield* Effect.scoped(
            Effect.gen(function* () {
              const lifecycle = yield* ZeropsLifecycle.make({
                toolEvents: Stream.empty as Stream.Stream<SpiEvent>,
                repository,
                threadOwner: conversationOfThread,
              });
              yield* lifecycle.ingest(
                leaseStatus([{ ...lease("webpool-3"), acquiredAt, activity: first, unsaved }]),
              );
            }),
          );
          const restarted = yield* ZeropsLifecycle.make({
            toolEvents: Stream.empty as Stream.Stream<SpiEvent>,
            repository,
            threadOwner: conversationOfThread,
          });
          expect((yield* restarted.get(OWNER)).envelope?.leases?.[0]).toMatchObject({
            activity: first,
            unsaved,
          });
        }),
      ).pipe(Effect.provide(persistence));

      yield* Effect.scoped(
        Effect.gen(function* () {
          const repository = yield* ZeropsThreadLifecycle.ZeropsThreadLifecycleRepository;
          yield* Effect.scoped(
            Effect.gen(function* () {
              const first = yield* ZeropsLifecycle.make({
                toolEvents: Stream.empty as Stream.Stream<SpiEvent>,
                repository,
              });
              yield* first.ingest(claudeEvent({}));
            }),
          );
          const readsFail = yield* Ref.make(true);
          const lifecycle = yield* ZeropsLifecycle.make({
            toolEvents: Stream.empty as Stream.Stream<SpiEvent>,
            repository: {
              ...repository,
              getByThreadId: (threadId) =>
                Effect.flatMap(Ref.get(readsFail), (fail) =>
                  fail
                    ? Effect.fail(
                        new PersistenceSqlError({ operation: "getByThreadId", cause: "busy" }),
                      )
                    : repository.getByThreadId(threadId),
                ),
            },
          });
          // A result with no envelope, folded while the row cannot be read.
          yield* lifecycle.ingest(
            claudeEvent({ toolName: "mcp__zerops__zerops_deploy", text: '{"status":"ok"}' }),
          );
          yield* Ref.set(readsFail, false);
          const row = yield* repository.getByThreadId(THREAD);
          expect(Option.map(row, (stored) => stored.envelope !== null)).toEqual(Option.some(true));
          expect((yield* lifecycle.get(THREAD)).envelope?.phase).toBe("develop-active");
        }),
      ).pipe(Effect.provide(persistence));
    }),
);

// witness: apps/server/src/zerops/ZeropsLifecycle.ts | state.envelope === undefined || leases === undefined || state.envelope.leases === leases → state.envelope === undefined || leases === undefined || state.envelope.leases !== undefined
it.effect(
  "CD56: Every conversation shows zcp's leases as the latest call read them, whichever conversation made it; a call that did not read them keeps the last read, and an empty read is none",
  () =>
    Effect.gen(function* () {
      yield* withLifecycle((lifecycle) =>
        Effect.gen(function* () {
          yield* lifecycle.ingest(statusReading([lease("webpool-3")]));
          yield* lifecycle.ingest(statusReading(undefined));
          const kept = (yield* lifecycle.get(OWNER)).envelope?.leases;
          expect(kept?.map((one) => one.alias)).toEqual(["webpool-3"]);
          yield* lifecycle.ingest(statusReading([]));
          expect((yield* lifecycle.get(OWNER)).envelope?.leases, "an empty read is none").toEqual(
            [],
          );
        }),
      );

      const member = (alias: string, options: { acquiredAt: string; branch?: string }) => {
        const [pool = alias, number = "1"] = alias.split("-");
        return {
          alias,
          pool,
          branch: options.branch ?? "feat-x",
          containerHostname: `node-id-${number}.runtime.${pool}.zerops`,
          state: "held",
          unverified: false,
          acquiredAt: options.acquiredAt,
        };
      };
      const leasesOf = (lifecycle: ZeropsLifecycle.ZeropsLifecycle["Service"], name: string) =>
        Effect.map(lifecycle.get(name as ThreadId), (state) => state.envelope?.leases);
      const branchOf = (
        leases:
          | ReadonlyArray<{ readonly alias: string; readonly branch?: string | undefined }>
          | undefined,
      ) => leases?.find(({ alias }) => alias === "apipool-4")?.branch;
      yield* withConversations((lifecycle) =>
        Effect.scoped(
          Effect.gen(function* () {
            const webpool = member("webpool-3", { acquiredAt: "2026-10-23T12:00:00Z" });
            const apipool = member("apipool-4", { acquiredAt: "2026-10-23T12:00:00Z" });
            yield* lifecycle.ingest(
              leaseCall({
                input: { action: "acquire", pools: ["webpool", "apipool"], branch: "feat-x" },
                leases: [webpool, apipool],
                envelope: [webpool, apipool],
                threadId: sessionOf("ada"),
              }),
            );
            expect(branchOf(yield* leasesOf(lifecycle, "ada"))).toBe("feat-x");
            const watching = yield* lifecycle.subscribe("ada" as ThreadId);
            const heard = yield* Stream.runHead(watching.changes).pipe(Effect.forkChild);

            // apipool-4 was released unseen and another branch took it; bob's call read so.
            const taken = member("apipool-4", {
              acquiredAt: "2026-10-23T14:00:00Z",
              branch: "feat-y",
            });
            yield* lifecycle.ingest({
              ...statusReading([webpool, taken]),
              threadId: sessionOf("bob"),
            });
            expect(branchOf(yield* leasesOf(lifecycle, "ada"))).toBe("feat-y");
            const published = yield* Fiber.join(heard);
            expect(
              branchOf(Option.getOrUndefined(published)?.envelope?.leases),
              "a conversation watching hears it",
            ).toBe("feat-y");
          }),
        ),
      );
    }),
);

// witness: apps/server/src/zerops/ZeropsLifecycle.ts | const unsaved = newer ? lease.unsaved : (lease.unsaved ?? last.unsaved); → const unsaved = lease.unsaved ?? last.unsaved;
it.effect(
  "CD57: A held lease keeps its dev servers, last activity and unsaved work through calls that did not read them, a status that could not read its checkout clears nothing, and a newer read of its checkout replaces activity and unsaved work together",
  () =>
    Effect.gen(function* () {
      yield* withLifecycle((lifecycle) =>
        Effect.gen(function* () {
          const preview = [
            {
              name: "webpool-3",
              port: 3000,
              url: "https://webpool-3003.zerops.app",
              status: "running",
              readAt: "2026-10-23T12:00:00Z",
            },
          ];
          const devServersOf = Effect.map(lifecycle.get(OWNER), (state) =>
            state.envelope?.leases?.find((one) => one.alias === "webpool-3"),
          );
          yield* lifecycle.ingest(
            statusReading([{ ...lease("webpool-3"), devServers: preview }, lease("webpool-4")]),
          );
          expect((yield* devServersOf)?.devServers).toEqual(preview);
          yield* lifecycle.ingest(statusReading([lease("webpool-3"), lease("webpool-4")]));
          expect((yield* devServersOf)?.devServers, "a read that did not ask keeps them").toEqual(
            preview,
          );
          yield* lifecycle.ingest(statusReading(undefined));
          expect((yield* devServersOf)?.devServers).toEqual(preview);
        }),
      );
      yield* withLifecycle((lifecycle) =>
        Effect.gen(function* () {
          const first = read("2026-10-23T20:04:00Z", "2026-10-23T19:12:40Z");
          const leaseOf = Effect.map(lifecycle.get(OWNER), (state) =>
            state.envelope?.leases?.find((one) => one.alias === "webpool-3"),
          );
          yield* lifecycle.ingest(
            leaseStatus([{ ...lease("webpool-3"), acquiredAt, activity: first, unsaved }]),
          );
          expect(yield* leaseOf).toMatchObject({ activity: first, unsaved });
          yield* lifecycle.ingest(statusReading([{ ...lease("webpool-3"), acquiredAt }]));
          expect(yield* leaseOf, "a call that did not read the checkout keeps them").toMatchObject({
            activity: first,
            unsaved,
          });
          yield* lifecycle.ingest(statusReading(undefined));
          expect(yield* leaseOf).toMatchObject({ activity: first, unsaved });
          yield* lifecycle.ingest(
            leaseStatus([
              {
                ...lease("webpool-3"),
                acquiredAt,
                unverified: true,
                activity: { acquiredAt, note: "not read: the pool's orchestrator did not answer" },
              },
            ]),
          );
          expect(
            yield* leaseOf,
            "a status that could not read the checkout clears nothing it read before",
          ).toMatchObject({ activity: first, unsaved });
          const second = read("2026-10-24T09:00:00Z", "2026-10-24T08:30:00Z");
          yield* lifecycle.ingest(
            leaseStatus([{ ...lease("webpool-3"), acquiredAt, activity: second }]),
          );
          const leaseRead = yield* leaseOf;
          expect(leaseRead?.activity, "a newer read of the checkout replaces the last").toEqual(
            second,
          );
          expect(
            leaseRead,
            "unsaved work the newer read could not read is not known, never the older read's",
          ).not.toHaveProperty("unsaved");
        }),
      );
    }),
);

// witness: apps/server/src/zerops/ZeropsLifecycle.ts | return stampMs(last.devServersReadAt) > stampMs(lease.devServersReadAt) → return stampMs(last.devServersReadAt) < stampMs(lease.devServersReadAt)
it.effect(
  "CD58: A lease shows the dev-server read zcp stamped latest, whichever call carried it last, and a read with no stamp is older than one with a stamp",
  () =>
    withLifecycle((lifecycle) =>
      Effect.gen(function* () {
        const held = { ...lease("webpool-3"), acquiredAt: "2026-10-27T08:00:00Z" };
        const readOf = (url: string, devServersReadAt?: string) => ({
          ...held,
          devServers: [
            { name: "web", port: 3000, url, status: "running", readAt: "2026-10-27T08:30:00Z" },
          ],
          ...(devServersReadAt === undefined ? {} : { devServersReadAt }),
        });
        const shown = Effect.map(lifecycle.get(OWNER), (state) =>
          state.envelope?.leases
            ?.find((one) => one.alias === "webpool-3")
            ?.devServers?.map((one) => one.url),
        );
        yield* lifecycle.ingest(statusReading([readOf("https://b.app", "2026-10-27T10:00:00Z")]));
        yield* lifecycle.ingest(statusReading([readOf("https://a.app", "2026-10-27T09:00:00Z")]));
        expect(yield* shown, "an older read a later call carries").toEqual(["https://b.app"]);
        yield* lifecycle.ingest(statusReading([readOf("https://c.app")]));
        expect(yield* shown, "a read with no stamp is older than one with it").toEqual([
          "https://b.app",
        ]);
        yield* lifecycle.ingest(statusReading([readOf("https://d.app", "2026-10-27T11:00:00Z")]));
        expect(yield* shown, "a newer read replaces it").toEqual(["https://d.app"]);
      }),
    ),
);

// witness: apps/server/src/zerops/ZeropsLifecycle.ts | if (lease.acquiredAt !== last.acquiredAt) return lease; → if (lease.alias !== last.alias) return lease;
it.effect(
  "CD59: A lease that ended, left zcp's leases or was acquired again at another time starts unread: no dev servers, activity or unsaved work from before",
  () =>
    Effect.gen(function* () {
      yield* withLifecycle((lifecycle) =>
        Effect.gen(function* () {
          const first = read("2026-10-23T20:04:00Z", "2026-10-23T19:12:40Z");
          const leaseOf = Effect.map(lifecycle.get(OWNER), (state) =>
            state.envelope?.leases?.find((one) => one.alias === "webpool-3"),
          );
          const devServers = [
            { name: "webpool-3", port: 3000, status: "running", readAt: "2026-10-23T20:04:00Z" },
          ];
          const readLease = {
            ...lease("webpool-3"),
            acquiredAt,
            activity: first,
            unsaved,
            devServers,
          };
          yield* lifecycle.ingest(leaseStatus([readLease]));
          expect(yield* leaseOf).toMatchObject({ activity: first, unsaved });
          yield* lifecycle.ingest(
            statusReading([{ ...lease("webpool-3", "released"), acquiredAt }]),
          );
          expect(yield* leaseOf).not.toHaveProperty("activity");
          expect(yield* leaseOf).not.toHaveProperty("unsaved");

          yield* lifecycle.ingest(leaseStatus([readLease]));
          yield* lifecycle.ingest(statusReading([]));
          yield* lifecycle.ingest(statusReading([{ ...lease("webpool-3"), acquiredAt }]));
          expect(yield* leaseOf, "gone from the read, then held again").not.toHaveProperty(
            "activity",
          );

          yield* lifecycle.ingest(leaseStatus([readLease]));
          yield* lifecycle.ingest(
            statusReading([{ ...lease("webpool-3"), acquiredAt: "2026-10-24T07:00:00Z" }]),
          );
          expect(
            yield* leaseOf,
            "the same alias acquired at another time is another lease",
          ).not.toHaveProperty("activity");
          expect(yield* leaseOf).not.toHaveProperty("unsaved");
          expect(yield* leaseOf, "nor the dev servers read on the lease before").not.toHaveProperty(
            "devServers",
          );
        }),
      );
      yield* withLifecycle((lifecycle) =>
        Effect.gen(function* () {
          const preview = [
            {
              name: "webpool-3",
              port: 3000,
              url: "https://webpool-3003.zerops.app",
              status: "running",
              readAt: "2026-10-23T12:00:00Z",
            },
          ];
          const devServersOf = Effect.map(lifecycle.get(OWNER), (state) =>
            state.envelope?.leases?.find((one) => one.alias === "webpool-3"),
          );
          yield* lifecycle.ingest(
            statusReading([{ ...lease("webpool-3"), devServers: preview }, lease("webpool-4")]),
          );
          expect((yield* devServersOf)?.devServers).toEqual(preview);
          yield* lifecycle.ingest(statusReading([lease("webpool-3", "released")]));
          expect(yield* devServersOf).not.toHaveProperty("devServers");
          yield* lifecycle.ingest(statusReading([]));
          yield* lifecycle.ingest(statusReading([lease("webpool-3")]));
          expect(yield* devServersOf, "a lease held again starts unread").not.toHaveProperty(
            "devServers",
          );
        }),
      );
    }),
);

// witness: apps/server/src/zerops/ZeropsLifecycle.ts | ? `lease:${event.eventId}:bind` → ? `lease:${conversation}:bind`
it.effect(
  "CD60: An acquire's binding is recorded under a key of that call's own, so the same call read twice gives one key and another call another",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const repository = yield* ZeropsThreadLifecycle.ZeropsThreadLifecycleRepository;
        const recorded: Array<{ readonly change: LeaseChange; readonly key: string }> = [];
        const lifecycle = yield* ZeropsLifecycle.make({
          toolEvents: Stream.empty as Stream.Stream<SpiEvent>,
          repository,
          threadOwner: conversationOfThread,
          recordLease: (_conversation, change, key) =>
            Effect.sync(() => {
              recorded.push({ change, key });
            }),
        });
        const event = acquire("webpool-3", [lease("webpool-3")]);
        yield* lifecycle.ingest(event);
        yield* lifecycle.ingest(event);
        yield* lifecycle.ingest(acquire("webpool-4", [lease("webpool-3"), lease("webpool-4")]));
        expect(recorded.map(({ change }) => change)).toContainEqual({
          _tag: "BindLease",
          lease: { alias: "webpool-3", pool: "webpool", branch: "feat-x" },
        });
        const keys = recorded
          .filter(({ change }) => change._tag === "BindLease")
          .map(({ key }) => key);
        expect(keys).toHaveLength(3);
        expect(keys[1], "the same call read twice gives one key").toBe(keys[0]);
        expect(keys[2], "another call another").not.toBe(keys[0]);
      }),
    ).pipe(Effect.provide(persistence)),
);

// witness: apps/server/src/zerops/ZeropsLifecycle.ts | noteLeases(leases.map((lease) => lease.alias)), → Effect.void,
it.effect(
  "CD61: Every read of zcp's leases tells the repository source which mounts are leases, and a restart tells it the last stored read before any call",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const repository = yield* ZeropsThreadLifecycle.ZeropsThreadLifecycleRepository;
        const noted = yield* Ref.make<ReadonlyArray<string> | undefined>(undefined);
        const start = ZeropsLifecycle.make({
          toolEvents: Stream.empty as Stream.Stream<SpiEvent>,
          repository,
          threadOwner: conversationOfThread,
          noteLeases: (aliases) => Ref.set(noted, aliases),
        });
        const lifecycle = yield* start;
        expect(yield* Ref.get(noted), "nothing stored, nothing told").toBeUndefined();
        yield* lifecycle.ingest(statusReading([lease("webpool-3"), lease("webpool-4", "lost")]));
        expect(yield* Ref.get(noted)).toEqual(["webpool-3", "webpool-4"]);

        // A restart: the roster starts empty, and the last stored read is told again.
        yield* Ref.set(noted, undefined);
        yield* start;
        expect(yield* Ref.get(noted)).toEqual(["webpool-3", "webpool-4"]);
      }),
    ).pipe(Effect.provide(persistence)),
);

// witness: apps/server/src/zerops/ZeropsLifecycle.ts | ...(facts.acquired?.aliases ?? []), → ...[],
it.effect(
  "CD62: A lease released, acquired again or read lost has its checkout told changed each time, once its bindings moved, and a read that says nothing new tells nothing",
  () =>
    withConversations((lifecycle, checkouts) =>
      Effect.gen(function* () {
        yield* lifecycle.ingest(acquireBy(sessionOf("ada"), "webpool-3", [lease("webpool-3")]));
        yield* lifecycle.ingest(release("webpool-3", sessionOf("ada"), []));
        yield* lifecycle.ingest(acquireBy(sessionOf("bob"), "webpool-3", [lease("webpool-3")]));
        expect(yield* checkouts()).toEqual([
          { alias: "webpool-3", bound: { ada: "webpool-3" } },
          { alias: "webpool-3", bound: {} },
          { alias: "webpool-3", bound: { bob: "webpool-3" } },
        ]);
        const first = (yield* checkouts()).length;
        yield* lifecycle.ingest(statusReading([lease("webpool-3")]));
        expect((yield* checkouts()).length, "a read that says nothing new tells nothing").toBe(
          first,
        );
        yield* lifecycle.ingest(statusReading([lease("webpool-3", "lost")]));
        expect((yield* checkouts()).slice(first)).toEqual([{ alias: "webpool-3", bound: {} }]);
      }),
    ),
);

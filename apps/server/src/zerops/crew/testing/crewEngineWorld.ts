// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off unsafeEffectTypeAssertion:off - a test harness: a database file, rows read back plainly, one context per life.
/**
 * The engine world for the crew's journeys (`crewWorld.ts`): the crew as an owner of the Mate
 * engine, over the engine's live layer on a SQLite file, a scripted provider for the crewmates'
 * agents, and the real git core over the local ssh shim, with the platform faked as V1's world
 * fakes it (`crewEngineFixture.ts`).
 *
 * A phase is one server lifetime on the same file: its layers built fresh, the engine started at
 * once on the first and at `serverReady` on each later one (the engine boots in the server's
 * startup, before it takes commands), its provider sessions dead when it ends.
 *
 * Every step maps to what the engine sees: a crewmate's turn is a run of its conversation, ended
 * by its driver's `turn.completed`; a tool is a crew command under the run's principal; a deploy is
 * a `zerops_deploy` call in the Mate's own conversation; the platform's gauges come off the bus.
 * What the crew sent is read back from its deliveries.
 *
 * @module crewEngineWorld
 */
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";

import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";
import {
  CREW_OWNER_ID,
  CommandId,
  ConversationId,
  ProviderInstanceId,
  ThreadId,
  type ChatAttachment,
  type CrewSnapshot,
} from "@t3tools/contracts";

import * as NodeSqliteClient from "../../../persistence/NodeSqliteClient.ts";
import { runMigrations } from "../../../persistence/Migrations.ts";
import * as ServerConfig from "../../../config.ts";
import { Conversations } from "../../../engine/Conversations.ts";
import { liveEngineLayer } from "../../../engine/live.ts";
import { MateEngine } from "../../../engine/MateEngine.ts";
import { providerThreadOf } from "../../../engine/pump/TurnPump.ts";
import { makeFakeWorkspaceHistory } from "../../../engine/testing/pump/fakeWorkspaceHistory.ts";
import {
  makeScriptedProvider,
  scriptedProviderLayer,
  type ScriptedProvider,
} from "../../../engine/testing/pump/scriptedProvider.ts";
import { ThreadToolPolicyRegistry } from "../../../spi/threadToolPolicy.ts";
import { noRestartEvidence, serverWorkspace, zeropsRunAdmission } from "../../engineAdapters.ts";
import { CrewEngine } from "../CrewEngine.ts";
import { crewServicesLayer } from "../crewLayer.ts";
import { DevServerPidFile } from "../CrewRuntime.ts";
import { CrewThreadDirectory, CrewToolHost, type CrewThreadMember } from "../crewSeams.ts";
import { installCrewThreadPolicy } from "../CrewThreadPolicy.ts";
import { taskAssignment, type CrewEffectPayload } from "../engine/command.ts";
import {
  CrewTimingConfig,
  crewEngineHooksLayer,
  crewEngineLinkLayer,
  engineCrewLayer,
  type EngineCrewPolicyInstaller,
} from "../engine/CrewEngineLayer.ts";
import { crewDomain } from "../engine/CrewOwner.ts";
import { evolveCrew } from "../engine/evolve.ts";
import { initialCrewState, membersInOrder, type CrewState } from "../engine/state.ts";
import { stintReasonWords } from "../crewCards.ts";
import type { RotationReason } from "../rotationDecision.ts";
import {
  ZEROPS,
  admissionFake,
  countingSsh,
  eventually,
  makeFixtureWorld,
  platformFakes,
  writeCrewHome,
  type CrewFixtureWorld,
} from "./crewEngineFixture.ts";
import { KAREL } from "./crewEngineSteps.ts";
import { removeServiceRepository } from "./crewGitFixture.ts";
import type {
  CrewChat,
  CrewHold,
  CrewHoldStep,
  CrewJourneyOptions,
  CrewPhase,
  CrewSent,
  CrewSessionsSeen,
  CrewWorld,
  CrewWorldRunner,
} from "./crewWorld.ts";

/** The ssh script each hold step stops at: the git core is V1's, unchanged. */
const holdMatcher = (hold: CrewHoldStep): ((script: string) => boolean) => {
  switch (hold.step) {
    case "save":
      return (script) => script.includes("): turn ");
    case "check":
      return (script) => script.includes("test -f ok.txt");
    case "land":
      return (script) => script.includes("commit-tree");
    case "recover":
      return (script) => script.includes("worktree prune");
    case "sweep":
      return (script) => script.includes("ignoring broken ref");
    case "send":
      return () => false;
    case "verdict": {
      let reads = 0;
      return (script) => script.includes("dirty=no") && ++reads === hold.nth;
    }
  }
};

const MATE = ConversationId.make("mate");
/** The crew's effects a step waits for before it returns. */
const QUICK_EFFECTS: ReadonlySet<string> = new Set([
  "crew.deliver",
  "crew.lane.reset",
  "crew.lane.keep",
  "crew.claim.read",
]);
const QUIET_WAIT = 15_000;
/** How long a journey waits for a frame before it fails with the last one. */
const SNAPSHOT_WAIT = Number(process.env.CREW_FRAME_WAIT ?? 60_000);
const ENGINE_FILE = "engine.sqlite";

interface DeliveryRow {
  readonly payload_json: string;
  readonly state: string;
}

/** The provider, with a send a journey can hold before the agent gets it. */
const holdableProvider = (provider: ScriptedProvider, sendHold: Ref.Ref<CrewHold | undefined>) => {
  const service = provider.service;
  return {
    ...provider,
    service: {
      ...service,
      sendTurn: (input: Parameters<typeof service.sendTurn>[0]) =>
        Effect.flatMap(Ref.getAndSet(sendHold, undefined), (hold) =>
          (hold === undefined ? Effect.void : hold.reached.pipe(Effect.andThen(hold.release))).pipe(
            Effect.andThen(service.sendTurn(input)),
          ),
        ),
    },
  } as ScriptedProvider;
};

/** One phase's port over its engine: `context` is that lifetime's, `fx` the world's. */
const enginePort = (input: {
  readonly fx: CrewFixtureWorld;
  readonly fixture: Effect.Success<typeof makeFixtureWorld>;
  readonly context: Context.Context<never>;
  readonly provider: ScriptedProvider;
  readonly started: Effect.Effect<void>;
  readonly start: Effect.Effect<void>;
  readonly sendHold: Ref.Ref<CrewHold | undefined>;
  /** Every hold's release, run when the life ends. */
  readonly releases: Array<Effect.Effect<void>>;
  /** The session each conversation's agent last started (its session-start hook), across lives. */
  readonly hooked: Map<string, number>;
}): CrewWorld => {
  const { fx, fixture, context, provider } = input;
  const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.provide(effect as Effect.Effect<A, E>, context);
  const crew = run(CrewEngine);
  const engine = run(MateEngine);
  const crewState = run(
    Effect.flatMap(Conversations, (conversations) =>
      conversations.owner(crewDomain).state(CREW_OWNER_ID),
    ),
  ).pipe(Effect.orDie) as Effect.Effect<CrewState>;
  const sql = run(SqlClient.SqlClient);

  const threadOf = (chat: CrewChat) =>
    Effect.gen(function* () {
      const generation =
        (yield* Effect.flatMap(engine, (mate) => mate.generation(ConversationId.make(chat)))) ?? 1;
      return providerThreadOf(ConversationId.make(chat), generation) as string;
    });

  const memberOf = (chat: CrewChat) =>
    Effect.flatMap(threadOf(chat), (thread) =>
      run(
        Effect.flatMap(CrewThreadDirectory, (directory) =>
          directory.memberFor(ThreadId.make(thread)),
        ),
      ),
    );

  const tool = <A>(
    chat: CrewChat,
    call: (host: CrewToolHost["Service"], member: CrewThreadMember) => Effect.Effect<A>,
  ) =>
    Effect.gen(function* () {
      const member = yield* memberOf(chat);
      if (Option.isNone(member)) return yield* Effect.die(`no crewmate holds ${chat}`);
      const answer = yield* run(Effect.flatMap(CrewToolHost, (host) => call(host, member.value)));
      yield* settled;
      return answer;
    });

  const handleOf = (chat: CrewChat) =>
    Effect.map(crewState, (state) =>
      membersInOrder(state).find((member) => member.conversationId === chat),
    );

  /** Waits for `check`; past `ms`, the journey fails naming what it waited for and the crew. */
  const waitFor = (what: string, check: Effect.Effect<boolean>, ms = 30_000) =>
    Effect.gen(function* () {
      for (let waited = 0; waited < ms; waited += 25) {
        if (yield* check) return;
        yield* Effect.sleep("25 millis");
      }
      const state = yield* crewState;
      return yield* Effect.die(
        new Error(
          `${what} never came; the crew: ${JSON.stringify(
            {
              members: Object.values(state.members).map((member) => ({
                handle: member.handle,
                active: member.active,
                carryOn: member.carryOn,
              })),
              tasks: Object.values(state.tasks).map((task) => [task.number, task.state, task.wait]),
              effects: Object.values(state.effects).map((effect) => effect.kind),
              deliveries: Object.values(state.deliveries).map((entry) => [
                entry.purpose,
                entry.runId,
              ]),
              sessions: [...provider.sessions.values()].map((session) => [
                session.thread,
                session.alive,
                session.open,
              ]),
            },
            null,
            1,
          )}`,
        ),
      );
    });

  /** The crewmate's turn running in its conversation, once its delivery reached the agent. */
  const turnRunning = (chat: CrewChat) =>
    Effect.gen(function* () {
      const thread = yield* threadOf(chat);
      return provider.sessions.get(thread)?.open != null;
    });

  /** The first frame `check` holds for; past the wait, the journey fails with the last frame. */
  const snapshotWhere = (check: (snapshot: CrewSnapshot) => boolean) =>
    Effect.flatMap(crew, (service) => {
      let last: CrewSnapshot | undefined;
      return service.snapshot.pipe(
        Stream.tap((frame) => Effect.sync(() => (last = frame))),
        Stream.filter(check),
        Stream.runHead,
        Effect.map(Option.getOrThrow),
        Effect.timeoutOrElse({
          duration: SNAPSHOT_WAIT,
          orElse: () =>
            Effect.die(new Error(`no frame held; the last: ${JSON.stringify(last, null, 1)}`)),
        }),
      );
    });

  /**
   * The crew has taken a step in: its quick effects (a delivery, a reset, a discard) have run, as
   * V1's press returned once its turn was dispatched. Long work (a copy's setup, a check, a
   * landing) goes on; a journey waits for it on the feed. Bounded: a held step stays held.
   */
  const settled = Effect.gen(function* () {
    for (let waited = 0; waited < QUIET_WAIT; waited += 25) {
      const state = yield* crewState;
      if (!Object.values(state.effects).some((effect) => QUICK_EFFECTS.has(effect.kind))) return;
      yield* Effect.sleep("25 millis");
    }
  });

  /**
   * A crewmate's sessions as its one conversation had them: read back from the crew owner's own
   * record (each fresh rotation a new session, in the crew's words), the latest active once its
   * agent's session runs.
   */
  const sessionsSeen = (handle: string) =>
    Effect.gen(function* () {
      const rows = yield* Effect.flatMap(sql, (client) =>
        client<{
          readonly seq: number;
          readonly type: string;
          readonly at: number;
          readonly payload_json: string;
        }>`
          SELECT seq, type, at, payload_json FROM engine_event
          WHERE conversation_id = ${CREW_OWNER_ID} ORDER BY seq
        `.pipe(Effect.orDie),
      );
      let state = initialCrewState(CREW_OWNER_ID);
      const reasons: Array<string | null> = [null];
      for (const row of rows) {
        const event = {
          _tag: row.type,
          seq: row.seq,
          at: row.at,
          ...(JSON.parse(row.payload_json) as Record<string, unknown>),
        } as unknown as Parameters<typeof evolveCrew>[1] & {
          readonly handle?: string;
          readonly rotation?: string;
          readonly fresh?: boolean;
        };
        const member = state.members[handle];
        if (
          event._tag === "SessionRotated" &&
          event.handle === handle &&
          event.fresh === true &&
          member !== undefined
        ) {
          const current = { brief: state.applied?.briefVersion ?? 1, job: member.jobVersion };
          reasons.push(
            stintReasonWords(
              event.rotation as RotationReason,
              member.session.running ?? current,
              current,
            ),
          );
        }
        state = evolveCrew(state, event);
      }
      const member = state.members[handle];
      if (member === undefined) return undefined;
      const pending =
        member.rotateWhenFree !== null ||
        (member.rotateAfter > 0 && member.session.compactions >= member.rotateAfter);
      const seen: CrewSessionsSeen = {
        count: reasons.length,
        latest: pending
          ? "rotate-pending"
          : input.hooked.get(member.conversationId) === reasons.length
            ? "active"
            : "open",
        reasons,
      };
      return seen;
    });

  /** Each conversation's latest turn end, to deliver again. */
  const lastEnds = new Map<CrewChat, Record<string, unknown>>();
  /** Runs the crew stopped whose interrupted end a journey already played. */
  const stopsTaken = new Set<string>();

  let mateTurns = 0;
  /** The Mate's own conversation's running turn: a message of the person's, open until ended. */
  const mateTurn = (running: boolean) =>
    Effect.gen(function* () {
      const thread = providerThreadOf(MATE) as string;
      const open = provider.sessions.get(thread)?.open != null;
      if (running && !open) {
        yield* run(
          Effect.flatMap(Conversations, (conversations) =>
            conversations.tell({
              commandId: CommandId.make(`mate-turn-${(mateTurns += 1)}`),
              conversationId: MATE,
              principal: { kind: "person", subject: KAREL.kind === "session" ? KAREL.subject : "" },
              command: { _tag: "Send", text: "Working on it." },
            }),
          ),
        );
        yield* eventually(Effect.sync(() => provider.sessions.get(thread)?.open != null));
      }
      if (!running && open) {
        yield* provider.agent.end(thread, { state: "completed" });
      }
      // The crew has seen it: a landing waits for the Mate's running turn, or no longer does.
      yield* waitFor(
        `the crew to see the Mate's turn ${running ? "run" : "end"}`,
        Effect.map(crewState, (state) => (state.mate.runId !== null) === running),
      );
    }).pipe(Effect.orDie);

  const deployCall = (status: "inProgress" | "completed", type: string) =>
    provider.agent.emit(type, providerThreadOf(MATE) as string, {
      itemId: "deploy-1",
      payload: {
        itemType: "mcp_tool_call",
        title: "MCP tool call",
        status,
        detail: "mcp__zerops__zerops_deploy: appdev",
        data: { toolName: "mcp__zerops__zerops_deploy", input: { targetService: "appdev" } },
      },
    });

  const sent = Effect.gen(function* () {
    // What the crew sent once it settled: a delivery its last step asked for has gone out.
    yield* settled;
    const rows = yield* Effect.flatMap(sql, (client) =>
      client<DeliveryRow>`
        SELECT payload_json, state FROM engine_effect
        WHERE kind = 'crew.deliver' AND state = 'done' ORDER BY rowid
      `.pipe(Effect.orDie),
    );
    const state = yield* crewState;
    const sessions = new Map<string, number>();
    const records: Array<CrewSent> = [];
    for (const row of rows) {
      const payload = JSON.parse(row.payload_json) as Extract<
        CrewEffectPayload,
        { readonly kind: "crew.deliver" }
      >;
      const chat = payload.conversationId as string;
      const member = state.members[payload.handle ?? ""];
      const command = payload.command;
      const opens = () => {
        const session = (sessions.get(chat) ?? 0) + 1;
        sessions.set(chat, session);
        records.push({
          kind: "open",
          chat,
          handle: payload.handle ?? "",
          session,
          runtimeMode: "approval-required",
          copy:
            member?.kind === "writer" && member.host !== null
              ? NodePath.join(fx.root, ".crew", member.handle)
              : null,
        });
        records.push({ kind: "autoResume", chat, enabled: false });
      };
      switch (command._tag) {
        case "AssignAgent":
          if (!sessions.has(chat) || member?.login !== undefined) opens();
          break;
        case "RotateSession":
          // A fresh session stops the one before it, in the same conversation.
          if (command.fresh) {
            if (sessions.has(chat)) records.push({ kind: "stop", chat });
            opens();
          }
          break;
        case "Send":
          records.push({
            kind: "turn",
            chat,
            text: command.text,
            attachments: (command.attachments ?? []) as ReadonlyArray<ChatAttachment>,
            instanceId: member?.login,
            runtimeMode: "approval-required",
          });
          break;
        case "Stop":
          records.push({ kind: "interrupt", chat });
          break;
        case "Archive":
          records.push({ kind: "archive", chat });
          break;
        case "Seam":
          break;
      }
    }
    // The seams are lines in each crewmate's record: their words and their payloads.
    const seams = yield* Effect.flatMap(sql, (client) =>
      client<{ readonly conversation_id: string; readonly payload_json: string }>`
        SELECT conversation_id, payload_json FROM engine_event
        WHERE type = 'ItemOpened' AND payload_json LIKE '%"crew.seam"%' ORDER BY rowid
      `.pipe(Effect.orDie),
    );
    for (const row of seams) {
      const body = (
        JSON.parse(row.payload_json) as {
          readonly body: { readonly marker: { readonly reason?: string; readonly seam: unknown } };
        }
      ).body;
      records.push({
        kind: "seam",
        chat: row.conversation_id,
        words: body.marker.reason ?? "",
        seam: body.marker.seam,
      });
    }
    return records;
  });

  const policy = run(Effect.flatMap(ThreadToolPolicyRegistry, (registry) => registry.current));

  return {
    name: "engine",
    root: fx.root,
    workspace: fx.workspace,
    devServerPidFile: fx.devServerPidFile,
    ownRef: Effect.map(crewState, (state) => {
      const open = Object.values(state.tasks).find(
        (task) => task.state !== "landed" && task.state !== "discarded",
      );
      return open === undefined
        ? "refs/t3/crew/landing/none"
        : `refs/t3/crew/landing/${taskAssignment(open)}`;
    }),
    attachmentsDir: NodePath.join(fx.workspace, "attachments"),
    writeHome: (files) => writeCrewHome(fx.workspace, files),
    press: (press, as) =>
      Effect.flatMap(crew, (service) => service.command(press, as ?? KAREL)).pipe(
        Effect.tap(() => settled),
      ),
    readFiles: Effect.flatMap(crew, (service) => service.readFiles),
    serverReady: input.start,
    turnStarts: (chat) => waitFor(`a turn in ${chat}`, turnRunning(chat)),
    turnEnds: (chat, end = {}) =>
      Effect.gen(function* () {
        // A turn the crew stopped already ended on the engine, when its interrupt was taken: the
        // agent's own word that it was interrupted is that end, not the next turn's.
        const stopped =
          end.state === "interrupted"
            ? yield* Effect.flatMap(sql, (client) =>
                client<{ readonly run_id: string }>`
                  SELECT json_extract(payload_json, '$.runId') AS run_id FROM engine_event
                  WHERE conversation_id = ${chat} AND type = 'RunEnded'
                    AND json_extract(payload_json, '$.end.kind') = 'stopped'
                  ORDER BY seq
                `.pipe(
                  Effect.map((rows) => rows.find((row) => !stopsTaken.has(row.run_id))),
                  Effect.orDie,
                ),
              )
            : undefined;
        const conversation = run(
          Effect.flatMap(Conversations, (conversations) =>
            conversations.state(ConversationId.make(chat)),
          ),
        ).pipe(Effect.orDie);
        let ending: string | null;
        if (stopped !== undefined) {
          stopsTaken.add(stopped.run_id);
          ending = stopped.run_id;
        } else {
          yield* waitFor(`a turn in ${chat} to end`, turnRunning(chat));
          ending = (yield* conversation).activeRunId;
          const thread = yield* threadOf(chat);
          const payload = {
            state: end.state ?? "completed",
            ...(end.reason === undefined ? {} : { terminalReason: end.reason }),
            ...(end.sessionCostUsd === undefined ? {} : { totalCostUsd: end.sessionCostUsd }),
          };
          lastEnds.set(chat, payload);
          yield* provider.agent.end(thread, payload);
        }
        const member = yield* handleOf(chat);
        // The engine recorded that run's end (another may follow at once: a nudge, a carry-on),
        // and the crew read its record past it.
        yield* waitFor(
          `${chat}'s run to end`,
          Effect.map(conversation, (state) => state.activeRunId !== ending),
        );
        const ended = yield* Effect.flatMap(sql, (client) =>
          client<{ readonly seq: number | null }>`
            SELECT MAX(seq) AS seq FROM engine_event
            WHERE conversation_id = ${chat} AND type = 'RunEnded'
              AND json_extract(payload_json, '$.runId') = ${ending}
          `.pipe(
            Effect.map((rows) => rows[0]?.seq ?? 0),
            Effect.orDie,
          ),
        );
        yield* waitFor(
          `the crew to take ${chat}'s turn end in`,
          Effect.map(
            crewState,
            (state) =>
              (state.cursors[chat] ?? 0) >= ended &&
              state.members[member?.handle ?? ""]?.active?.runId !== ending,
          ),
        );
        // As V1's turn end returned once the turn's work was saved in its copy.
        yield* waitFor(
          `${chat}'s turn end to be saved`,
          Effect.map(
            crewState,
            (state) =>
              !Object.values(state.effects).some(
                (effect) => effect.kind === "crew.checkpoint" && effect.handle === member?.handle,
              ),
          ),
          60_000,
        );
        yield* settled;
      }),
    turnEndRedelivered: (chat) =>
      Effect.gen(function* () {
        const payload = lastEnds.get(chat);
        if (payload === undefined) return yield* Effect.die(`no turn of ${chat} ended`);
        yield* provider.agent.emit("turn.completed", yield* threadOf(chat), { payload });
      }),
    says: (chat, text) =>
      Effect.flatMap(threadOf(chat), (thread) => provider.agent.say(thread, text)),
    compacted: (chat) =>
      Effect.flatMap(threadOf(chat), (thread) =>
        provider.agent.emit("thread.state.changed", thread, { payload: { state: "compacted" } }),
      ),
    report: (chat, report) => tool(chat, (host, member) => host.report(member, report)),
    showOnDev: (chat, ask) => tool(chat, (host, member) => host.showOnDev(member, ask)),
    propose: (chat, tasks) => tool(chat, (host, member) => host.propose(member, tasks)),
    review: (chat, review) => tool(chat, (host, member) => host.review(member, review)),
    finish: (chat, summary) => tool(chat, (host, member) => host.finish(member, summary)),
    memory: (chat, op) => tool(chat, (host, member) => host.memory(member, op)),
    sessionStart: (chat, event) =>
      Effect.tap(
        tool(chat, (host, member) => host.sessionStart(member, event)),
        () =>
          Effect.flatMap(crewState, (state) =>
            Effect.sync(() => {
              const member = membersInOrder(state).find((entry) => entry.conversationId === chat);
              if (member !== undefined) input.hooked.set(chat, member.session.count);
            }),
          ),
      ),
    mateTurnRunning: mateTurn,
    deploy: (phase, options = {}) =>
      phase === "finished"
        ? deployCall("completed", "item.completed")
        : mateTurn(true).pipe(
            Effect.andThen(deployCall("inProgress", options.opens ?? "item.started")),
          ),
    deployState: (processes) => Ref.set(fx.processes, processes),
    usage: (usedPercent) =>
      provider.agent.emit("account.rate-limits.updated", "a-person-thread", {
        providerInstanceId: ProviderInstanceId.make("claudeAgent"),
        payload: {
          limits: { windows: [{ id: "session", kind: "session", label: "Session", usedPercent }] },
        },
      }),
    signedIn: (login) =>
      typeof login === "string"
        ? login === "claude-code"
          ? fixture.world.signedIn
          : fixture.world.signedInAs(login)
        : fixture.world.extraSignedIn(login.extra),
    refuseTurns: (words) => Ref.set(fx.refusal, words),
    logins: (logins) => Ref.set(fx.logins, logins),
    agentsNotLive: (instanceIds) => Ref.set(fx.missingAgents, instanceIds),
    // The engine's record is how a chat stood: a running turn is one its provider took up.
    chatWas: (chat, was) =>
      was.running === true
        ? waitFor(
            `${chat}'s turn running`,
            Effect.map(
              crewState,
              (state) =>
                membersInOrder(state).find((member) => member.conversationId === chat)?.active
                  ?.reached === true,
            ),
          )
        : Effect.void,
    taskLastMovedAt: (taskId) =>
      Effect.gen(function* () {
        // The task has waited as long as the crew can tell: its waits come due now.
        const state = yield* crewState;
        const due = Object.entries(state.wakes).filter(([id]) => id.includes(taskId));
        for (const [wakeId] of due) {
          yield* run(
            Effect.flatMap(Conversations, (conversations) =>
              conversations.tell({
                commandId: CommandId.make(`due-${wakeId}`),
                conversationId: CREW_OWNER_ID,
                principal: { kind: "engine" },
                command: { _tag: "WakeFired", wakeId: wakeId as never },
              }),
            ),
          );
        }
      }).pipe(Effect.orDie),
    hold: (step) =>
      step.step === "send"
        ? Effect.gen(function* () {
            const reached = yield* Deferred.make<void>();
            const release = yield* Deferred.make<void>();
            const hold: CrewHold = {
              reached: Deferred.succeed(reached, undefined).pipe(
                Effect.andThen(Deferred.await(release)),
              ),
              release: Effect.void,
            };
            yield* Ref.set(input.sendHold, hold);
            const released = Deferred.succeed(release, undefined).pipe(Effect.asVoid);
            input.releases.push(released);
            return { reached: Deferred.await(reached), release: released } satisfies CrewHold;
          })
        : Effect.tap(fixture.world.holdSsh(holdMatcher(step)), (hold) =>
            Effect.sync(() => input.releases.push(hold.release)),
          ),
    snapshot: snapshotWhere(() => true),
    snapshotWhere,
    frames: Stream.unwrap(Effect.map(crew, (service) => service.snapshot)),
    sent,
    sessionsWhere: (handle, check) =>
      Effect.gen(function* () {
        let last: CrewSessionsSeen | undefined;
        for (let waited = 0; waited < SNAPSHOT_WAIT; waited += 50) {
          last = yield* sessionsSeen(handle);
          if (last !== undefined && check(last)) return last;
          yield* Effect.sleep("50 millis");
        }
        return yield* Effect.die(
          new Error(`@${handle}'s sessions never held; the last: ${JSON.stringify(last)}`),
        );
      }),
    admissions: Effect.map(Ref.get(fx.admitted), (all) => all.map((entry) => entry.principal)),
    tasks: Effect.map(crewState, (state) =>
      Object.values(state.tasks)
        .toSorted((a, b) => a.number - b.number)
        .map((task) => ({
          id: task.id,
          number: task.number,
          state: task.state,
          attempt: task.counters.attempt,
          reworks: task.counters.reworks,
          run: task.runId,
        })),
    ),
    attempts: (taskId) =>
      Effect.map(crewState, (state) => {
        const task = state.tasks[taskId];
        if (task === undefined) return [];
        const chat = state.members[task.owner]?.conversationId ?? null;
        return (task.attemptRows ?? []).map((row) => ({
          attempt: row.attempt,
          chat,
          rotations: row.attempt === task.counters.attempt ? task.counters.rotations : 0,
          ending: row.ending,
          endingDetail: row.endingDetail,
          costUsd: row.costUsd,
          endedAt:
            row.endedAt === null ? null : DateTime.formatIso(DateTime.makeUnsafe(row.endedAt)),
        }));
      }),
    log: (kinds) =>
      Effect.flatMap(sql, (client) =>
        client<{ readonly kind: string; readonly payload_json: string }>`
          SELECT kind, payload_json FROM engine_crew_log
          WHERE ${client.in("kind", kinds)} ORDER BY seq
        `.pipe(
          Effect.map((rows) =>
            rows.map((row) => ({
              kind: row.kind,
              payload: JSON.parse(row.payload_json) as unknown,
            })),
          ),
          Effect.orDie,
        ),
      ),
    member: memberOf,
    toolProfile: (chat) =>
      Effect.gen(function* () {
        const current = yield* policy;
        if (Option.isNone(current)) return undefined;
        return yield* current.value.profileFor({
          threadId: ThreadId.make(yield* threadOf(chat)),
          instanceId: ProviderInstanceId.make("claudeAgent"),
        });
      }),
    toolProfilesInstalled: Effect.map(policy, Option.isSome),
    profileInstalls: Ref.get(fx.installs),
    serviceSessions: Ref.get(fx.sshCalls),
    deployReads: Ref.get(fx.processReads),
  };
};

/** Counts installs instead of installing the tools slice's policy. */
const countingInstaller = (installs: Ref.Ref<number>): EngineCrewPolicyInstaller =>
  Ref.update(installs, (count) => count + 1);

/** One server lifetime's layers over the world's file. */
const lifeLayer = (
  fixture: Effect.Success<typeof makeFixtureWorld>,
  provider: ScriptedProvider,
  installer: EngineCrewPolicyInstaller,
) => {
  const { world, signIns, holds } = fixture;
  const history = makeFakeWorkspaceHistory();
  const base = Layer.mergeAll(
    // A redeploy's reads come within moments, not minutes, as V1's world has them.
    Layer.succeed(CrewTimingConfig, {
      deployPollFirstMs: 50,
      deployPollMaxMs: 200,
      thawOfferMs: 600,
    }),
    platformFakes(world, signIns),
    admissionFake(world),
    countingSsh(world.sshCalls, holds),
    Layer.succeed(DevServerPidFile, world.devServerPidFile),
    ServerConfig.layer({
      cwd: world.workspace,
      attachmentsDir: NodePath.join(world.workspace, "attachments"),
      zerops: ZEROPS,
      zeropsCrew: true,
      mateEngine: "mate",
    } as ServerConfig.ServerConfig["Service"]),
    Layer.effectDiscard(runMigrations()).pipe(
      Layer.provideMerge(
        NodeSqliteClient.layer({ filename: NodePath.join(world.workspace, ENGINE_FILE) }),
      ),
    ),
  ).pipe(Layer.provideMerge(NodeServices.layer));
  const hooks = crewEngineHooksLayer.pipe(
    Layer.provide(crewServicesLayer),
    Layer.provide(crewEngineLinkLayer),
  );
  const engine = liveEngineLayer({ worker: { pollMillis: 100 } }).pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        scriptedProviderLayer(provider),
        history.layer,
        noRestartEvidence,
        serverWorkspace,
        zeropsRunAdmission,
      ),
    ),
    Layer.provideMerge(hooks),
  );
  return engineCrewLayer(installer).pipe(
    Layer.provideMerge(engine),
    Layer.provideMerge(crewServicesLayer),
    Layer.provideMerge(crewEngineLinkLayer),
    Layer.provideMerge(base),
  );
};

/** The engine world: each phase one server lifetime of the engine crew, on one file. */
export const engineWorld: CrewWorldRunner = <E>(
  phases: ReadonlyArray<CrewPhase<E>>,
  options: CrewJourneyOptions,
) =>
  Effect.gen(function* () {
    const fixture = yield* makeFixtureWorld;
    const installer: EngineCrewPolicyInstaller =
      options.toolProfiles === true
        ? (installCrewThreadPolicy.pipe(
            Effect.andThen(Ref.update(fixture.world.installs, (count) => count + 1)),
          ) as EngineCrewPolicyInstaller)
        : countingInstaller(fixture.world.installs);
    let first = true;
    const releases: Array<Effect.Effect<void>> = [];
    const hooked = new Map<string, number>();
    for (const phase of phases) {
      const scripted = yield* makeScriptedProvider({ driver: "claudeAgent" });
      const sendHold = yield* Ref.make<CrewHold | undefined>(undefined);
      const provider = holdableProvider(scripted, sendHold);
      const life = yield* Scope.make();
      const context = (yield* Layer.buildWithScope(
        lifeLayer(fixture, provider, installer),
        life,
      )) as Context.Context<never>;
      const startedFlag = yield* Ref.make(false);
      const start = Effect.gen(function* () {
        if (yield* Ref.getAndSet(startedFlag, true)) return;
        const engine = Context.get(context as Context.Context<MateEngine>, MateEngine);
        yield* Scope.provide(engine.start(), life);
      });
      // The Mate's own conversation runs on the Mate's agent, as its stand-up leaves it.
      yield* Effect.provide(
        Effect.flatMap(Conversations, (conversations) =>
          conversations.tell({
            commandId: CommandId.make("mate-agent"),
            conversationId: MATE,
            principal: { kind: "engine" },
            command: {
              _tag: "AssignAgent",
              agent: {
                instanceId: "claudeAgent",
                driver: "claudeAgent",
                model: null,
                profile: { kind: "mate" },
              },
            },
          }),
        ),
        context as Context.Context<Conversations>,
      ).pipe(Effect.orDie);
      if (first) yield* start;
      first = false;
      const world = enginePort({
        fx: fixture.world,
        fixture,
        context,
        provider,
        started: Effect.asVoid(Ref.get(startedFlag)),
        start,
        sendHold,
        releases,
        hooked,
      });
      const exit = yield* Effect.exit(phase(world));
      // Whatever a journey still holds goes on, so the life's own work can wind down.
      yield* Ref.set(fixture.holds, []);
      for (const release of releases.splice(0)) yield* release;
      // The server goes down: every driver process dies with it.
      for (const session of scripted.sessions.values()) session.alive = false;
      yield* Scope.close(life, Exit.void);
      if (Exit.isFailure(exit)) return yield* Effect.failCause(exit.cause);
    }
  }).pipe(Effect.ensuring(Effect.void), Effect.orDie) as Effect.Effect<void>;

export { removeServiceRepository };

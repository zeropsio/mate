/**
 * The crew on the Mate engine, wired: what the engine runs for the crew (its owner kind, the
 * handlers of its effects, its crewmates' workspaces) and what the server serves from it (the
 * crew feed and its presses, the crewmates' tools and their thread policy).
 *
 * - **Two halves, one link.** The engine is built first and needs the crew's hooks; the crew's
 *   front needs the running engine. {@link CrewEngineLink} joins them: the hooks wait (briefly,
 *   and only for a crewmate's conversation) for the front the crew completes once it is built.
 * - **A press** is judged at the door first (D6: admission over the logins it reaches, as the
 *   presser), then decided by the crew owner, one writer; its home is read and checked here,
 *   because the decider is pure.
 * - **The feed** is a pure projection of the crew owner's state, a frame per crew commit.
 *
 * @module crew/engine/CrewEngineLayer
 */
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Random from "effect/Random";
import * as Scope from "effect/Scope";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import {
  CREW_OWNER_ID,
  CommandId,
  ConversationId,
  CrewCommandError,
  agentIdForDriverKind,
  type CrewCommand,
  type CrewCommandResult,
  type CrewLogin,
  type CrewRefusalReason,
  type CrewSnapshot,
  type CrewTaskPage,
  type CrewTaskPageInput,
  type CrewTint,
  type Principal,
  type RecordedCrewSeam,
  type ZeropsLogin,
} from "@t3tools/contracts";
import { MATE_TINT_IDS } from "@t3tools/shared/brand";
import {
  parseCrewHome,
  validateCrewTopology,
  type CrewDefinition,
  type CrewMemberSpec,
} from "@t3tools/shared/crewHome";

import { ServerConfig } from "../../../config.ts";
import { Conversations } from "../../../engine/Conversations.ts";
import { EngineEffectExtensions } from "../../../engine/effects/index.ts";
import { MateEngine } from "../../../engine/MateEngine.ts";
import { OwnerDomains } from "../../../engine/owners.ts";
import type { WorkspaceSetup } from "../../../engine/ports.ts";
import { ClaudeThreadExtensionRegistry } from "../../../spi/claudeThreadProfile.ts";
import { ProviderInstances } from "../../../spi/providerInstances.ts";
import { ProviderRuntimeEventBus } from "../../../spi/ProviderRuntimeEventBus.ts";
import { ThreadToolPolicyRegistry } from "../../../spi/threadToolPolicy.ts";
import { ZeropsAgentAuth } from "../../ZeropsAgentAuth.ts";
import { withLogins, ZeropsLogins } from "../../ZeropsLogins.ts";
import { ZeropsRepositorySource } from "../../ZeropsRepositorySource.ts";
import { ZeropsTurnAdmission, type TurnPrincipal } from "../../ZeropsTurnAdmission.ts";
import { ZeropsWorkspaceObserver } from "../../ZeropsWorkspaceObserver.ts";
import { crewLane } from "../CrewDefinition.ts";
import { CrewEngine, type CrewEngineService } from "../CrewEngine.ts";
import { CREW_ID, CrewHome, refusalOf } from "../CrewHome.ts";
import { makeOver, type CrewMemoryRecords } from "../CrewMemory.ts";
import { CrewReads } from "../CrewReads.ts";
import { CrewThreadDirectory, CrewToolHost } from "../crewSeams.ts";
import { CrewShell } from "../CrewShell.ts";
import { CrewStoreError, type CrewMemoryRow } from "../CrewStore.ts";
import { closedSeamWords, landedSeamWords, sweptSeamWords } from "../crewCards.ts";
import type { CrewInput } from "./command.ts";
import { CrewDeliveryContext, type CrewDeliveryContextShape } from "./CrewDeliveryContext.ts";
import { observeCrew } from "./CrewObserver.ts";
import { crewDomain, crewRefusalOf, type CrewAccepted } from "./CrewOwner.ts";
import { makeEngineCrewDirectory } from "./crewEngineDirectory.ts";
import { CrewWorkspaceDirectory } from "./CrewWorkspaceDirectory.ts";
import { doorLogins, filesDoorLogins } from "./decide.ts";
import { CrewDelivery } from "./effects/deliver.ts";
import { makeCrewEngineEffectHandlers } from "./CrewEffectBridge.ts";
import { crewSnapshotOf, crewTaskPage, type CrewView } from "./project.ts";
import { DEFAULT_CREW_TIMING, membersInOrder, type CrewState, type CrewTiming } from "./state.ts";

/* ------------------------------------------------------------ the link */

/** What the crew's front answers the engine's hooks once it runs. */
export interface CrewFront {
  /** A crewmate's conversation's workspace; none for any other. */
  readonly workspaceOf: (
    conversationId: ConversationId,
  ) => Effect.Effect<Option.Option<WorkspaceSetup>>;
  readonly seed: CrewDeliveryContextShape["seed"];
  readonly agentOf: CrewDeliveryContextShape["agentOf"];
}

/** The engine's hooks and the crew's front, joined once the front is built. */
export class CrewEngineLink extends Context.Service<CrewEngineLink, Deferred.Deferred<CrewFront>>()(
  "t3/zerops/crew/engine/CrewEngineLayer/CrewEngineLink",
) {}

export const crewEngineLinkLayer = Layer.effect(CrewEngineLink, Deferred.make<CrewFront>());

/** A crewmate's conversation is named by its crew: `crew-<crew>-<handle>-<n>`. */
const isCrewmateConversation = (conversationId: string): boolean =>
  conversationId.startsWith("crew-");

/** How long a crewmate's session waits for the crew's front at boot. */
const FRONT_WAIT = "30 seconds";

/** A seam's words, where the seam alone says them; a save's are the client's. */
export const seamWordsOf = (seam: RecordedCrewSeam): string | null => {
  switch (seam.seam) {
    case "landed":
      return landedSeamWords(seam.number, seam.commit);
    case "closed":
      return closedSeamWords(seam.number);
    case "swept":
      return sweptSeamWords(seam.branch, seam.commit, seam.paths);
    default:
      return null;
  }
};

/**
 * The crew's hooks under the engine: its owner kind, its effects' handlers (with deliveries told
 * to the engine's own conversations) and its crewmates' workspaces.
 */
export const crewEngineHooksLayer = Layer.effectContext(
  Effect.gen(function* () {
    const link = yield* CrewEngineLink;
    const services =
      yield* Effect.context<
        Exclude<
          Effect.Services<typeof makeCrewEngineEffectHandlers>,
          CrewDelivery | CrewDeliveryContext
        >
      >();
    const front = Deferred.await(link).pipe(Effect.timeoutOption(FRONT_WAIT));
    const context: CrewDeliveryContextShape = {
      seed: (input) =>
        Effect.flatMap(front, (found) =>
          Option.isSome(found) ? found.value.seed(input) : Effect.succeed(null),
        ),
      agentOf: (ask) =>
        Effect.flatMap(front, (found) =>
          Option.isSome(found) ? found.value.agentOf(ask) : Effect.succeed(undefined),
        ),
      seamWords: seamWordsOf,
    };
    const extensions = Effect.gen(function* () {
      const conversations = yield* Conversations;
      return yield* makeCrewEngineEffectHandlers.pipe(
        Effect.provideService(CrewDelivery, { deliver: conversations.tell }),
        Effect.provideService(CrewDeliveryContext, context),
        Effect.provide(services),
      );
    });
    return Context.make(OwnerDomains, [crewDomain]).pipe(
      Context.add(EngineEffectExtensions, extensions),
      Context.add(CrewWorkspaceDirectory, {
        workspaceOf: (conversationId) =>
          isCrewmateConversation(conversationId)
            ? Effect.flatMap(front, (found) =>
                Option.isSome(found)
                  ? found.value.workspaceOf(conversationId)
                  : Effect.succeed(Option.none()),
              )
            : Effect.succeed(Option.none()),
      }),
    );
  }),
);

/* ------------------------------------------------------------ the front */

/** The crew's timing as this server runs it (tests shorten a redeploy's reads). */
export const CrewTimingConfig = Context.Reference<CrewTiming>(
  "t3/zerops/crew/engine/CrewEngineLayer/CrewTimingConfig",
  { defaultValue: () => DEFAULT_CREW_TIMING },
);

const refuse = (reason: CrewRefusalReason, detail: string | null = null) =>
  new CrewCommandError({ reason, detail });

/** A press's principal on the engine. */
export const principalOf = (principal: TurnPrincipal): Principal =>
  principal.kind === "session" ? { kind: "person", subject: principal.subject } : principal;

/** Tints for crewmates without one: the first a crewmate of this crew does not wear. */
const withTints = (
  members: ReadonlyArray<CrewMemberSpec>,
  previous: CrewState,
): ReadonlyArray<CrewMemberSpec> => {
  const chosen = new Map<string, CrewTint>();
  for (const member of members) {
    const kept = member.tint ?? previous.members[member.handle]?.tint;
    if (kept !== undefined && kept !== null) chosen.set(member.handle, kept as CrewTint);
  }
  for (const member of members) {
    if (chosen.has(member.handle)) continue;
    const taken = new Set(chosen.values());
    chosen.set(
      member.handle,
      (MATE_TINT_IDS.find((tint) => !taken.has(tint)) ?? MATE_TINT_IDS[0]) as CrewTint,
    );
  }
  return members.map((member) => {
    const tint = chosen.get(member.handle);
    return tint === undefined ? member : { ...member, tint };
  });
};

/** What installs the crew's thread policies for the scope it runs in (`installCrewThreadPolicy`). */
export type EngineCrewPolicyInstaller = Effect.Effect<
  void,
  never,
  | Scope.Scope
  | CrewThreadDirectory
  | CrewToolHost
  | ThreadToolPolicyRegistry
  | ClaudeThreadExtensionRegistry
>;

const PRESS_READS: ReadonlySet<CrewCommand["_tag"]> = new Set([
  "orphanScan",
  "deliverDraft",
  "addCrewPorts",
]);

/** The crew's front on the engine: the feed, the presses, the tools and the policy. */
export const makeEngineCrew = (installer: EngineCrewPolicyInstaller) =>
  Effect.gen(function* () {
    const engine = yield* MateEngine;
    const link = yield* CrewEngineLink;
    const found = engine.owner(crewDomain);
    if (Option.isNone(found)) {
      return yield* Effect.die(new Error("the Mate engine hosts no crew on this Mate"));
    }
    const door = found.value;
    const sql = yield* SqlClient.SqlClient;
    const config = yield* ServerConfig;
    const home = yield* CrewHome;
    const shell = yield* CrewShell;
    const reads = yield* CrewReads;
    const repositories = yield* ZeropsRepositorySource;
    const observer = yield* ZeropsWorkspaceObserver;
    const instances = yield* ProviderInstances;
    const admission = yield* ZeropsTurnAdmission;
    const logins = yield* ZeropsLogins;
    const agentAuth = yield* ZeropsAgentAuth;
    const policies = yield* ThreadToolPolicyRegistry;
    const extensions = yield* ClaudeThreadExtensionRegistry;
    const bus = yield* Effect.serviceOption(ProviderRuntimeEventBus);
    const scope = yield* Effect.scope;

    const state = door.state(CREW_OWNER_ID).pipe(Effect.orDie);

    const commandId = (kind: string) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const nonce = yield* Random.nextIntBetween(0, 1_000_000_000);
        return CommandId.make(`crew-${kind}:${now}:${nonce}`);
      });

    const askAs = (input: CrewInput, principal: Principal, id?: string) =>
      Effect.gen(function* () {
        const accepted = yield* door.ask({
          commandId: id === undefined ? yield* commandId(input._tag) : CommandId.make(id),
          conversationId: CREW_OWNER_ID,
          principal,
          command: input,
        });
        return accepted as unknown as CrewAccepted;
      }).pipe(
        Effect.catchTags({
          CommandRejected: (rejected) => Effect.fail(crewRefusalOf(rejected.rejection)),
        }),
        Effect.catch((failure) =>
          Effect.fail(
            failure._tag === "CrewCommandError" ? failure : refuse("io", failure.message),
          ),
        ),
      );

    const tell = (input: CrewInput, id: string) =>
      door
        .tell({
          commandId: CommandId.make(id),
          conversationId: CREW_OWNER_ID,
          principal: { kind: "engine" },
          command: input,
        })
        .pipe(
          Effect.asVoid,
          Effect.catchCause((cause) => Effect.logWarning("crew: an input was not recorded", cause)),
        );

    /* ------------------------------------------------------- agents and logins */

    const agentOf = (login: string) => instances.agentOf(login);

    const loginOf = (login: string) =>
      Effect.gen(function* () {
        const mateLogin = yield* logins.resolve(login);
        const agent = yield* agentOf(login);
        const agentId = mateLogin?.agent ?? agentIdForDriverKind(agent?.driver);
        return {
          id: login,
          label: mateLogin?.label ?? agent?.displayName ?? login,
          ...(agentId === undefined ? {} : { agent: agentId }),
        } satisfies CrewLogin;
      });

    /* ------------------------------------------------------- hosts */

    /** A host's verified repository: bound by an observation, which a restart forgets. */
    const repositoryOf = (host: string) => Effect.option(shell.repository(host));

    const devHosts = yield* SubscriptionRef.make<Readonly<Record<string, boolean | null>>>({});

    const recordDevHosts = (
      mounted: ReadonlyArray<string>,
      databases: ReadonlyMap<string, boolean>,
    ) =>
      SubscriptionRef.update(devHosts, (known) =>
        Object.fromEntries(
          mounted.map((host) => [host, databases.get(host) ?? known[host] ?? null]),
        ),
      );

    /** Binds every host whose repository this process has not verified yet. */
    const verify = (hosts: Iterable<string>) =>
      Effect.gen(function* () {
        const problems: Array<string> = [];
        const wanted = [...new Set(hosts)];
        if (wanted.length === 0) return problems;
        const listed = yield* repositories.list;
        for (const host of wanted) {
          if (Option.isSome(yield* repositoryOf(host))) continue;
          const mounted =
            listed._tag === "available"
              ? listed.repositories.find((repository) => repository.host === host)
              : undefined;
          const seen = mounted === undefined ? undefined : yield* observer.observe(mounted);
          if (seen?._tag !== "available") {
            problems.push(`${host} could not be verified: ${seen?.reason ?? "it is not mounted"}`);
          }
        }
        return problems;
      });

    const listDevHosts = Effect.gen(function* () {
      const listed = yield* repositories.list;
      if (listed._tag === "available") {
        yield* recordDevHosts(
          listed.repositories.map((repository) => repository.host),
          new Map(),
        );
      }
    });

    /** Each mounted dev service verified and asked whether it reaches a database (ssh). */
    const probeDevHosts = Effect.gen(function* () {
      const listed = yield* repositories.refresh;
      if (listed._tag !== "available") return;
      const databases = new Map<string, boolean>();
      for (const repository of listed.repositories) {
        const seen = yield* observer.observe(repository);
        if (seen._tag !== "available") continue;
        const reaches = yield* Effect.option(reads.reachesDatabase(repository.host));
        if (Option.isSome(reaches)) databases.set(repository.host, reaches.value);
      }
      yield* recordDevHosts(
        listed.repositories.map((repository) => repository.host),
        databases,
      );
    });

    /* ------------------------------------------------------- memory */

    const storeError = (operation: string) => (cause: unknown) =>
      new CrewStoreError({ operation, kind: "sql", cause });

    const memoryRecords: CrewMemoryRecords = {
      entries: (_crew, handle) =>
        sql<{
          readonly entry_id: string;
          readonly kind: string;
          readonly topic: string | null;
          readonly text: string;
          readonly paths_json: string;
          readonly verified_at: string | null;
          readonly from_assignment: string | null;
          readonly updated_at: string;
        }>`
          SELECT entry_id, kind, topic, text, paths_json, verified_at, from_assignment, updated_at
          FROM engine_crew_memory WHERE owner_id = ${CREW_OWNER_ID} AND handle = ${handle}
          ORDER BY CAST(substr(entry_id, 2) AS INTEGER), entry_id
        `.pipe(
          Effect.map((rows) =>
            rows.map((row): CrewMemoryRow => ({
              crew: CREW_ID,
              member: handle,
              id: row.entry_id,
              kind: row.kind as CrewMemoryRow["kind"],
              topic: row.topic,
              text: row.text,
              paths: JSON.parse(row.paths_json) as ReadonlyArray<string>,
              verifiedAt: row.verified_at,
              fromAssignment: row.from_assignment,
              updatedAt: row.updated_at,
            })),
          ),
          Effect.mapError(storeError("crewMemory")),
        ),
      write: (member, change) =>
        change.kind === "none"
          ? Effect.void
          : askAs(
              {
                _tag: "Tool",
                handle: member.handle,
                runId: null,
                call: { tool: "memory", op: change },
              },
              { kind: "engine" },
            ).pipe(Effect.asVoid, Effect.mapError(storeError("crewMemoryWrite"))),
      seq: () => Effect.map(state, (current) => current.headSeq),
    };
    const memory = yield* makeOver(memoryRecords);

    const memoryCounts = Effect.gen(function* () {
      const rows = yield* sql<{ readonly handle: string; readonly kind: string }>`
        SELECT handle, kind FROM engine_crew_memory WHERE owner_id = ${CREW_OWNER_ID}
      `.pipe(Effect.orElseSucceed(() => []));
      const counts: Record<string, { entries: number; unfiled: number }> = {};
      for (const row of rows) {
        const count = (counts[row.handle] ??= { entries: 0, unfiled: 0 });
        if (row.kind === "unfiled") count.unfiled += 1;
        else count.entries += 1;
      }
      return counts;
    });

    /* ------------------------------------------------------- directory and tools */

    const { directory, toolHost, memberOfConversation, sessionPacket } = makeEngineCrewDirectory({
      state,
      generation: engine.generation,
      repositoryOf,
      agentOf,
      workspaceRoot: config.cwd,
      ask: askAs,
      memory,
      reads,
    });

    /* ------------------------------------------------------- the feed */

    const epoch = yield* sql<{ readonly at: number }>`
      SELECT at FROM engine_event WHERE conversation_id = ${CREW_OWNER_ID} AND seq = 1
    `.pipe(
      Effect.map((rows) => rows[0]?.at ?? 0),
      Effect.orElseSucceed(() => 0),
    );

    const viewOf = (current: CrewState) =>
      Effect.gen(function* () {
        const loginsByHandle: Record<string, CrewLogin> = {};
        for (const member of membersInOrder(current)) {
          loginsByHandle[member.handle] = yield* loginOf(member.login);
        }
        return {
          nowMs: yield* Clock.currentTimeMillis,
          epoch: current.headSeq === 0 ? 0 : epoch,
          logins: loginsByHandle,
          devHosts: yield* SubscriptionRef.get(devHosts),
          memory: yield* memoryCounts,
          context: {},
          delivered: new Set<string>(),
        } satisfies CrewView;
      });

    const frameOf = (current: CrewState) =>
      Effect.map(viewOf(current), (view) => crewSnapshotOf(current, view));
    const hub = yield* SubscriptionRef.make<CrewSnapshot>(yield* frameOf(yield* state));
    /** A frame's content, its revision aside: a commit that changes nothing shown moves no frame. */
    const contentOf = (frame: CrewSnapshot) => {
      const { seq: _seq, revision: _revision, ...shown } = frame;
      return JSON.stringify(shown);
    };
    const refresh = Effect.flatMap(state, frameOf).pipe(
      Effect.flatMap((frame) =>
        Effect.flatMap(SubscriptionRef.get(hub), (current) =>
          contentOf(current) === contentOf(frame) ? Effect.void : SubscriptionRef.set(hub, frame),
        ),
      ),
    );
    yield* Stream.merge(
      Stream.map(door.subscribe(CREW_OWNER_ID, (yield* state).headSeq), () => undefined).pipe(
        Stream.catchCause(() => Stream.empty),
      ),
      Stream.map(SubscriptionRef.changes(devHosts), () => undefined),
    ).pipe(
      Stream.runForEach(() => refresh),
      Effect.forkIn(scope),
    );

    /* ------------------------------------------------------- policies */

    let installed = false;
    const activate = Effect.suspend(() =>
      installed
        ? Effect.void
        : installer.pipe(
            Effect.provideService(CrewThreadDirectory, directory),
            Effect.provideService(CrewToolHost, toolHost),
            Effect.provideService(ThreadToolPolicyRegistry, policies),
            Effect.provideService(ClaudeThreadExtensionRegistry, extensions),
            Scope.provide(scope),
            Effect.tap(() =>
              Effect.sync(() => {
                installed = true;
              }),
            ),
          ),
    );

    /* ------------------------------------------------------- the door */

    const defaultLogin = "claudeAgent";

    /** The crew home as saved, checked as Apply checks it, each crewmate on a login and a tint. */
    const loadHome = (current: CrewState) =>
      Effect.gen(function* () {
        const parsed = yield* home.load;
        if (parsed.definition === undefined || parsed.issues.length > 0) {
          return yield* refusalOf(parsed.issues);
        }
        const definition = parsed.definition;
        const writerHosts = definition.members.flatMap((member) =>
          member.kind === "writer" && member.host !== undefined ? [member.host] : [],
        );
        const listed = yield* repositories.refresh;
        if (listed._tag !== "available") {
          return yield* refuse("io", "This Mate's dev services cannot be listed right now.");
        }
        const problems = yield* verify(writerHosts);
        if (problems.length > 0) return yield* refuse("invalid-definition", problems.join("\n"));
        const databaseHosts: Array<string> = [];
        for (const host of new Set(writerHosts)) {
          if (yield* reads.reachesDatabase(host).pipe(Effect.orElseSucceed(() => false))) {
            databaseHosts.push(host);
          }
        }
        yield* recordDevHosts(
          listed.repositories.map((repository) => repository.host),
          new Map([...new Set(writerHosts)].map((host) => [host, databaseHosts.includes(host)])),
        );
        const topology = validateCrewTopology(definition, {
          devHosts: listed.repositories.map((repository) => repository.host),
          databaseHosts,
        });
        if (topology.length > 0) return yield* refusalOf(topology);
        for (const member of definition.members) {
          const login = member.login ?? defaultLogin;
          const agent = yield* agentOf(login);
          if (agent === undefined) {
            return yield* refuse(
              "invalid-definition",
              `@${member.handle} runs on ${login}, which isn't a login on this Mate: give it another login.`,
            );
          }
          if (agent.threadProfile === undefined) {
            return yield* refuse(
              "invalid-definition",
              `@${member.handle} runs on ${agent.displayName}, which can't run a crewmate: it would work without the crew's rules. Give it another login.`,
            );
          }
          if (member.kind === "lead" && !agent.threadProfile.tools) {
            return yield* refuse(
              "invalid-definition",
              `@${member.handle} leads the crew, and a lead needs the crew tools, which ${agent.displayName} cannot host: give the lead another login.`,
            );
          }
        }
        const filled: CrewDefinition = {
          ...definition,
          members: withTints(
            definition.members.map((member) => ({
              ...member,
              login: member.login ?? defaultLogin,
            })),
            current,
          ),
        };
        return filled;
      });

    const admitAt = (logins: ReadonlyArray<string>, principal: TurnPrincipal) =>
      logins.length === 0
        ? Effect.succeed<string | null>(null)
        : admission.admitOperator({ instanceIds: logins, principal }).pipe(
            Effect.as<string | null>(null),
            Effect.catch((error) => Effect.succeed<string | null>(error.message)),
          );

    const command: CrewEngineService["command"] = (press, principal) =>
      Effect.gen(function* () {
        if (PRESS_READS.has(press._tag)) {
          return yield* refuse("unavailable", "This crew can't do that on the new engine yet.");
        }
        const current = yield* state;
        const needsHome =
          press._tag === "apply" || press._tag === "briefSave" || press._tag === "jobSave";
        const definition = needsHome ? yield* loadHome(current) : undefined;
        const refusal = yield* admitAt(doorLogins(current, press, definition), principal);
        if (refusal !== null) return yield* refuse("not-allowed", refusal);
        const seen = press._tag === "taskEdit" ? press.seen : undefined;
        yield* askAs(
          {
            _tag: "Press",
            press,
            door: { refusal: null },
            ...(definition === undefined ? {} : { home: definition }),
            ...(seen === undefined ? {} : { seen }),
          },
          principalOf(principal),
        );
        if (press._tag === "apply") yield* activate;
        return { _tag: "done" } satisfies CrewCommandResult;
      });

    const writeFiles: CrewEngineService["writeFiles"] = (files, principal) =>
      Effect.gen(function* () {
        const current = yield* home.read;
        const written = new Set(files.files.map((file) => file.path));
        const parse = yield* home.load;
        const after = parseCrewHome(CREW_ID, [
          ...current.filter((file) => !written.has(file.path)),
          ...files.files,
        ]).definition;
        if (after !== undefined) {
          const reached = filesDoorLogins(yield* state, parse.definition, after);
          const refusal = yield* admitAt(reached, principal);
          if (refusal !== null) return yield* refuse("not-allowed", refusal);
        }
        yield* home.write(files.files);
      });

    const taskPage = (input: CrewTaskPageInput): Effect.Effect<CrewTaskPage> =>
      Effect.gen(function* () {
        const current = yield* state;
        return crewTaskPage(current, input, yield* viewOf(current));
      });

    const service: CrewEngineService = {
      snapshot: SubscriptionRef.changes(hub),
      readFiles: Effect.forkIn(probeDevHosts.pipe(Effect.ignore), scope).pipe(
        Effect.andThen(Effect.map(home.read, (files) => ({ files }))),
      ),
      writeFiles,
      command,
      taskPage,
    };

    /* ------------------------------------------------------- the engine's hooks */

    const workspaceOf = (conversationId: ConversationId) =>
      Effect.gen(function* () {
        const current = yield* state;
        const member = memberOfConversation(current, conversationId);
        if (member === undefined) return Option.none<WorkspaceSetup>();
        if (member.kind !== "writer" || member.host === null) {
          return Option.some<WorkspaceSetup>({ cwd: config.cwd, runtimeMode: "approval-required" });
        }
        yield* verify([member.host]);
        const repository = yield* repositoryOf(member.host);
        if (Option.isNone(repository)) return Option.none<WorkspaceSetup>();
        return Option.some<WorkspaceSetup>({
          cwd: crewLane(repository.value, member.handle).mountDir,
          runtimeMode: "approval-required",
        });
      });

    const seed: CrewFront["seed"] = (input) => sessionPacket(input.handle);

    const agentOfAsk: CrewFront["agentOf"] = (ask) =>
      Effect.map(agentOf(ask.instanceId), (agent) =>
        agent === undefined
          ? undefined
          : {
              instanceId: ask.instanceId,
              driver: agent.driver,
              model: ask.model,
              ...(ask.effort === null ? {} : { options: [{ id: "effort", value: ask.effort }] }),
              profile: ask.profile,
            },
      );

    yield* Deferred.succeed(link, { workspaceOf, seed, agentOf: agentOfAsk });

    /* ------------------------------------------------------- boot */

    yield* tell(
      { _tag: "Configure", timing: yield* CrewTimingConfig },
      `configure:${yield* Clock.currentTimeMillis}`,
    );
    yield* listDevHosts.pipe(Effect.ignore);
    const booted = yield* state;
    if (booted.applied !== null) {
      yield* verify(
        membersInOrder(booted).flatMap((member) => (member.host === null ? [] : [member.host])),
      ).pipe(Effect.ignore);
      yield* activate;
    }

    // Each login's sign-in as last seen: only a login whose state or signer moved is told.
    const seenSignIns = new Map<string, string>();
    const moved = (all: ReadonlyArray<ZeropsLogin>) => {
      const changed: Array<string> = [];
      for (const login of all) {
        const now = `${login.state}|${login.signedInBy ?? ""}`;
        if (seenSignIns.get(login.id) !== undefined && seenSignIns.get(login.id) !== now) {
          changed.push(login.id);
        }
        seenSignIns.set(login.id, now);
      }
      return changed;
    };
    moved([...(withLogins(yield* agentAuth.latest, []).logins ?? []), ...(yield* logins.latest)]);

    yield* observeCrew({
      changes: engine.changes,
      eventsAfter: engine.eventsAfter,
      crewState: state,
      tell,
      conversations: Effect.map(engine.conversations, (list) =>
        list.views.map((view) => view.conversationId),
      ),
      gauges: Option.match(bus, {
        onNone: () => Stream.empty,
        onSome: (live) =>
          live.events.pipe(
            Stream.map((event) => {
              if (event.type !== "account.rate-limits.updated") return undefined;
              const login = event.providerInstanceId;
              const windows = event.payload.limits.windows.map((window) => window.usedPercent);
              if (
                login === undefined ||
                (windows.length === 0 && event.payload.blocked === undefined)
              ) {
                return undefined;
              }
              const percent = event.payload.blocked !== undefined ? 100 : Math.max(0, ...windows);
              return { login: login as string, usagePercent: percent };
            }),
            Stream.filter((reading) => reading !== undefined),
          ),
      }),
      signIns: Stream.merge(
        logins.changes,
        Stream.map(agentAuth.changes, (snapshot) => withLogins(snapshot, []).logins ?? []),
      ).pipe(Stream.map(moved)),
    }).pipe(Scope.provide(scope));

    return Context.make(CrewEngine, service).pipe(
      Context.add(CrewThreadDirectory, directory),
      Context.add(CrewToolHost, toolHost),
    );
  });

/** The crew's front as a layer over the running engine and the crew's own services. */
export const engineCrewLayer = (installer: EngineCrewPolicyInstaller) =>
  Layer.effectContext(makeEngineCrew(installer));

// @effect-diagnostics nodeBuiltinImport:off
/**
 * A crew engine for tests: the real engine and git core against a temporary
 * service repository (over the local ssh shim, as `crewGitFixture` does),
 * with everything above it faked and recorded — the orchestration engine
 * (every dispatched command), the projection (a Mate project and the threads
 * a test says run), admission (every principal it was asked about, the
 * logins each press was judged on, and the refusals a test can set), the
 * provider event bus (events a test publishes) and the server's command
 * readiness (a test completes it).
 *
 * @module crewEngineFixture
 */
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  EventId,
  OrchestrationDispatchCommandError,
  ProjectId,
  ProviderDriverKind,
  ThreadId,
  TurnId,
  type OrchestrationCommand,
  type OrchestrationProject,
  type OrchestrationThreadShell,
  type SpiEvent,
  type ZeropsAgentAuthSnapshot,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../../../config.ts";
import * as ProcessRunner from "../../../processRunner.ts";
import { OrchestrationEngineService } from "../../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { runMigrations } from "../../../persistence/Migrations.ts";
import * as NodeSqliteClient from "../../../persistence/NodeSqliteClient.ts";
import { ClaudeThreadExtensionRegistry } from "../../../spi/claudeThreadProfile.ts";
import { ProviderInstances } from "../../../spi/providerInstances.ts";
import { ProviderRuntimeEventBusTest } from "../../../spi/ProviderRuntimeEventBus.ts";
import { ServerCommandReadiness } from "../../../spi/serverCommandReadiness.ts";
import { ThreadToolPolicyRegistry } from "../../../spi/threadToolPolicy.ts";
import { localSshProcessRunnerLayer } from "../../testing/localSsh.ts";
import { resolveZeropsEnvironment } from "../../ZeropsEnvironment.ts";
import { ZeropsAgentAuth } from "../../ZeropsAgentAuth.ts";
import { ZeropsLogins, type MateLogin } from "../../ZeropsLogins.ts";
import { ZeropsRepositorySource, type ZeropsRepository } from "../../ZeropsRepositorySource.ts";
import { ZeropsTurnAdmission, type TurnPrincipal } from "../../ZeropsTurnAdmission.ts";
import { ZeropsWorkspaceObserver } from "../../ZeropsWorkspaceObserver.ts";
import { CrewEngine } from "../CrewEngine.ts";
import { crewServicesLayer, makeCrewEngine, type CrewPolicyInstaller } from "../crewLayer.ts";
import { CrewThreadDirectory, CrewToolHost } from "../crewSeams.ts";
import { CrewStore } from "../CrewStore.ts";
import {
  makeServiceRepository,
  removeServiceRepository,
  serviceRepository,
  TEST_IDENTITY,
} from "./crewGitFixture.ts";

export const PROJECT_ID = ProjectId.make("project-mate");

export const ZEROPS = resolveZeropsEnvironment({
  projectId: TEST_IDENTITY.projectId,
  apiHost: undefined,
  allowedOrigins: [],
  apiToken: "the-mates-own-zerops-key",
})!;

/** What the fakes recorded, and the knobs a test turns. */
export interface CrewWorld {
  readonly root: string;
  readonly workspace: string;
  readonly dispatched: Ref.Ref<ReadonlyArray<OrchestrationCommand>>;
  readonly admitted: Ref.Ref<
    ReadonlyArray<{ readonly type: string; readonly principal: TurnPrincipal }>
  >;
  /** Admission refuses every turn with this, while set. */
  readonly refusal: Ref.Ref<string | undefined>;
  /** The logins each press was judged on (`admitOperator`), and as whom. */
  readonly operated: Ref.Ref<
    ReadonlyArray<{
      readonly instanceIds: ReadonlyArray<string>;
      readonly principal: TurnPrincipal;
    }>
  >;
  /** Logins the person may not run, with the words admission refuses them in. */
  readonly notTheirs: Ref.Ref<ReadonlyMap<string, string>>;
  /** Threads the projection reports, for the landing gate and the boot sweep. */
  readonly threads: Ref.Ref<ReadonlyArray<OrchestrationThreadShell>>;
  readonly installs: Ref.Ref<number>;
  /** ssh sessions the crew opened. */
  readonly sshCalls: Ref.Ref<number>;
  /** Mate logins beyond the defaults, by id. */
  readonly logins: Ref.Ref<ReadonlyMap<string, MateLogin>>;
  readonly publish: (event: SpiEvent) => Effect.Effect<void>;
  /** A login's sign-in or signer changed: the agent-auth and logins feeds move. */
  readonly signedIn: Effect.Effect<void>;
}

const project: OrchestrationProject = {
  id: PROJECT_ID,
  title: "mate",
  workspaceRoot: "/var/www",
  defaultModelSelection: null,
  scripts: [],
  createdAt: "2026-09-27T10:00:00.000Z",
  updatedAt: "2026-09-27T10:00:00.000Z",
  deletedAt: null,
};

/** A person thread whose turn is running, for the landing gate. */
export const runningPersonThread = (): OrchestrationThreadShell =>
  ({
    id: ThreadId.make("person-thread"),
    archivedAt: null,
    session: { status: "running" },
    latestTurn: null,
  }) as unknown as OrchestrationThreadShell;

let eventCounter = 0;

/** A provider event on a crew thread. */
export const spiEvent = <T extends SpiEvent["type"]>(
  type: T,
  threadId: string,
  payload: Extract<SpiEvent, { readonly type: T }>["payload"],
  extra: Partial<SpiEvent> = {},
): SpiEvent =>
  ({
    eventId: EventId.make(`event-${(eventCounter += 1)}`),
    provider: ProviderDriverKind.make("claudeAgent"),
    threadId: ThreadId.make(threadId),
    createdAt: "2026-09-27T10:00:00.000Z",
    turnId: TurnId.make(`turn-${eventCounter}`),
    type,
    payload,
    ...extra,
  }) as SpiEvent;

/**
 * The service's mount and its verification, as on a container: the mount is
 * listed without an identity, and only an observation remembers a verified
 * binding — which a restart forgets.
 */
const repositoryLayers = (root: string) =>
  Layer.effectContext(
    Effect.gen(function* () {
      const known = yield* Ref.make<ReadonlyArray<ZeropsRepository>>([]);
      const { identity: _identity, ...mounted } = serviceRepository(root);
      const listed = Effect.succeed({ _tag: "available", repositories: [mounted] } as const);
      const source = ZeropsRepositorySource.of({
        list: listed,
        refresh: listed,
        known: Ref.get(known),
        remember: (repository) =>
          Ref.update(known, (all) => [
            ...all.filter((entry) => entry.host !== repository.host),
            repository,
          ]),
      });
      const observe = (repository: ZeropsRepository) =>
        Effect.gen(function* () {
          const verified = { ...repository, identity: TEST_IDENTITY, rootId: "root" };
          yield* source.remember(verified);
          return {
            _tag: "available",
            repository: verified,
            git: { state: "ready", shallow: false },
            observedAt: "2026-09-27T10:00:00.000Z",
          } as const;
        });
      return Context.make(ZeropsRepositorySource, source).pipe(
        Context.add(ZeropsWorkspaceObserver, { observe } as ZeropsWorkspaceObserver["Service"]),
      );
    }),
  );

const fakes = (
  world: Omit<CrewWorld, "publish" | "signedIn">,
  events: PubSub.PubSub<SpiEvent>,
  signIns: PubSub.PubSub<void>,
) =>
  Layer.mergeAll(
    repositoryLayers(world.root),
    Layer.mock(OrchestrationEngineService)({
      dispatch: (command) =>
        Ref.update(world.dispatched, (all) => [...all, command]).pipe(Effect.as({ sequence: 1 })),
    }),
    Layer.mock(ProjectionSnapshotQuery)({
      getActiveProjectByWorkspaceRoot: () => Effect.succeed(Option.some(project)),
      getShellSnapshot: () =>
        Effect.map(Ref.get(world.threads), (threads) => ({
          snapshotSequence: 1,
          projects: [],
          threads,
          updatedAt: "2026-09-27T10:00:00.000Z",
        })),
      getThreadShellById: (threadId) =>
        Effect.map(Ref.get(world.threads), (threads) =>
          Option.fromNullishOr(threads.find((thread) => thread.id === threadId)),
        ),
    }),
    Layer.mock(ZeropsTurnAdmission)({
      admit: ({ command, principal }) =>
        Ref.update(world.admitted, (all) => [...all, { type: command.type, principal }]).pipe(
          Effect.andThen(Ref.get(world.refusal)),
          Effect.flatMap((refusal) =>
            refusal === undefined
              ? Effect.void
              : Effect.fail(new OrchestrationDispatchCommandError({ message: refusal })),
          ),
        ),
      admitOperator: ({ instanceIds, principal }) =>
        Ref.update(world.operated, (all) => [...all, { instanceIds, principal }]).pipe(
          Effect.andThen(Ref.get(world.notTheirs)),
          Effect.flatMap((notTheirs) => {
            const refusal = instanceIds.map((id) => notTheirs.get(id)).find((words) => words);
            return refusal === undefined
              ? Effect.void
              : Effect.fail(new OrchestrationDispatchCommandError({ message: refusal }));
          }),
        ),
    }),
    Layer.mock(ZeropsLogins)({
      resolve: (id) => Effect.map(Ref.get(world.logins), (logins) => logins.get(id)),
      changes: Stream.fromPubSub(signIns).pipe(Stream.map(() => [])),
    }),
    Layer.mock(ZeropsAgentAuth)({
      changes: Stream.fromPubSub(signIns).pipe(
        Stream.map(() => ({ agents: [] }) as unknown as ZeropsAgentAuthSnapshot),
      ),
    }),
    Layer.mock(ProviderInstances)({
      driverKindOf: () => Effect.succeed(ProviderDriverKind.make("claudeAgent")),
    }),
    ProviderRuntimeEventBusTest.make(Stream.fromPubSub(events)),
    ThreadToolPolicyRegistry.layer,
    ClaudeThreadExtensionRegistry.layer,
    ServerCommandReadiness.layer,
  );

/** The local ssh shim, counting every session. */
const countingSsh = (calls: Ref.Ref<number>) =>
  Layer.effect(
    ProcessRunner.ProcessRunner,
    Effect.gen(function* () {
      const runner = yield* ProcessRunner.ProcessRunner;
      return ProcessRunner.ProcessRunner.of({
        run: (input) =>
          (input.command === "ssh" ? Ref.update(calls, (count) => count + 1) : Effect.void).pipe(
            Effect.andThen(runner.run(input)),
          ),
      });
    }),
  ).pipe(Layer.provide(localSshProcessRunnerLayer(TEST_IDENTITY)));

/** Counts installs instead of installing the tools slice's policy. */
const countingInstaller = (installs: Ref.Ref<number>): CrewPolicyInstaller =>
  Ref.update(installs, (count) => count + 1);

export type CrewEngineServices =
  | CrewEngine
  | CrewThreadDirectory
  | CrewToolHost
  | ServerCommandReadiness
  | CrewStore
  | ThreadToolPolicyRegistry;

/**
 * Runs each phase against its own live crew engine, one after another, over
 * one fresh service repository and one workspace (the zcp container's
 * `/var/www`, holding the crew home and the crew database): a phase after the
 * first is the Mate after a server restart. Each engine is built from fresh
 * layers and closed before the next starts.
 */
export const withCrewEngines = <E>(
  phases: ReadonlyArray<(world: CrewWorld) => Effect.Effect<void, E, CrewEngineServices>>,
  options: { readonly installer?: (installs: Ref.Ref<number>) => CrewPolicyInstaller } = {},
) =>
  Effect.gen(function* () {
    const root = makeServiceRepository();
    const workspace = NodeFS.realpathSync(
      NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-crew-mate-")),
    );
    const events = yield* PubSub.unbounded<SpiEvent>();
    const signIns = yield* PubSub.unbounded<void>();
    const world: CrewWorld = {
      root,
      workspace,
      dispatched: yield* Ref.make<ReadonlyArray<OrchestrationCommand>>([]),
      admitted: yield* Ref.make<
        ReadonlyArray<{ readonly type: string; readonly principal: TurnPrincipal }>
      >([]),
      refusal: yield* Ref.make<string | undefined>(undefined),
      operated: yield* Ref.make<
        ReadonlyArray<{
          readonly instanceIds: ReadonlyArray<string>;
          readonly principal: TurnPrincipal;
        }>
      >([]),
      notTheirs: yield* Ref.make<ReadonlyMap<string, string>>(new Map()),
      threads: yield* Ref.make<ReadonlyArray<OrchestrationThreadShell>>([]),
      installs: yield* Ref.make(0),
      sshCalls: yield* Ref.make(0),
      logins: yield* Ref.make<ReadonlyMap<string, MateLogin>>(new Map()),
      publish: (event) => PubSub.publish(events, event).pipe(Effect.asVoid),
      signedIn: PubSub.publish(signIns, undefined).pipe(Effect.asVoid),
    };
    const installer = (options.installer ?? countingInstaller)(world.installs);
    const engine = () =>
      Layer.effectContext(makeCrewEngine(installer)).pipe(
        Layer.provideMerge(crewServicesLayer),
        Layer.provideMerge(
          Layer.mergeAll(
            fakes(world, events, signIns),
            countingSsh(world.sshCalls),
            ServerConfig.layer({
              cwd: workspace,
              zerops: ZEROPS,
              zeropsCrew: true,
            } as ServerConfig.ServerConfig["Service"]),
            Layer.effectDiscard(runMigrations()).pipe(
              Layer.provideMerge(
                NodeSqliteClient.layer({ filename: NodePath.join(workspace, "crew.sqlite") }),
              ),
            ),
          ).pipe(Layer.provideMerge(NodeServices.layer)),
        ),
      );
    yield* Effect.forEach(phases, (phase) =>
      phase(world).pipe(Effect.provide(engine(), { local: true })),
    ).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          removeServiceRepository(root);
          NodeFS.rmSync(workspace, { recursive: true, force: true });
        }),
      ),
    );
  });

/** One engine: see {@link withCrewEngines}. */
export const withCrewEngine = <E>(
  body: (world: CrewWorld) => Effect.Effect<void, E, CrewEngineServices>,
  options: { readonly installer?: (installs: Ref.Ref<number>) => CrewPolicyInstaller } = {},
) => withCrewEngines([body], options);

/** Polls `check` until it holds, for work the engine runs in the background; dies when it never does. */
export const eventually = <E, R>(
  check: Effect.Effect<boolean, E, R>,
  timeoutMs = 10_000,
): Effect.Effect<void, E, R> =>
  Effect.gen(function* () {
    for (let waited = 0; waited < timeoutMs; waited += 25) {
      if (yield* check) return;
      yield* Effect.sleep("25 millis");
    }
    if (!(yield* check)) return yield* Effect.die("eventually: the condition never held");
  });

/** The crew home files a test starts from: one writer `backend` on the test service. */
export const writeCrewHome = (
  workspace: string,
  files: Readonly<Record<string, string>> = {},
): void => {
  const home = NodePath.join(workspace, ".mate/crew/main");
  const all = {
    "crew.yaml": [
      "name: Game team",
      "briefTitle: Space shooter",
      "members:",
      "  - handle: backend",
      "    displayName: Backend",
      "    host: appdev",
      "    check: test -f ok.txt",
      "",
    ].join("\n"),
    "brief.md": "Ship the space shooter.\n",
    "jobs/backend.md": "You own the server.\n",
    ...files,
  };
  for (const [path, content] of Object.entries(all)) {
    const target = NodePath.join(home, path);
    NodeFS.mkdirSync(NodePath.dirname(target), { recursive: true });
    NodeFS.writeFileSync(target, content);
  }
};

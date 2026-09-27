// @effect-diagnostics nodeBuiltinImport:off
/**
 * A crew engine for tests: the real engine and git core against a temporary
 * service repository (over the local ssh shim, as `crewGitFixture` does),
 * with everything above it faked and recorded — the orchestration engine
 * (every dispatched command), the projection (a Mate project and the threads
 * a test says run), admission (every principal it was asked about, and a
 * refusal a test can set), the provider event bus (events a test publishes)
 * and the server's command readiness (a test completes it).
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
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../../../config.ts";
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
import { ZeropsRepositorySource } from "../../ZeropsRepositorySource.ts";
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
  /** Threads the projection reports, for the landing gate and the boot sweep. */
  readonly threads: Ref.Ref<ReadonlyArray<OrchestrationThreadShell>>;
  readonly installs: Ref.Ref<number>;
  readonly publish: (event: SpiEvent) => Effect.Effect<void>;
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

const fakes = (world: Omit<CrewWorld, "publish">, events: PubSub.PubSub<SpiEvent>) =>
  Layer.mergeAll(
    Layer.succeed(
      ZeropsRepositorySource,
      ZeropsRepositorySource.of({
        list: Effect.succeed({ _tag: "available", repositories: [serviceRepository(world.root)] }),
        refresh: Effect.succeed({
          _tag: "available",
          repositories: [serviceRepository(world.root)],
        }),
        known: Effect.succeed([serviceRepository(world.root)]),
        remember: () => Effect.void,
      }),
    ),
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
    }),
    Layer.mock(ZeropsWorkspaceObserver)({
      observe: (repository) =>
        Effect.succeed({
          _tag: "available",
          repository: { ...repository, identity: TEST_IDENTITY, rootId: "root" },
          git: { state: "ready", shallow: false },
          observedAt: "2026-09-27T10:00:00.000Z",
        }),
    }),
    Layer.mock(ProviderInstances)({
      driverKindOf: () => Effect.succeed(ProviderDriverKind.make("claudeAgent")),
    }),
    ProviderRuntimeEventBusTest.make(Stream.fromPubSub(events)),
    ThreadToolPolicyRegistry.layer,
    ClaudeThreadExtensionRegistry.layer,
    ServerCommandReadiness.layer,
  );

/** Counts installs instead of installing the tools slice's policy. */
const countingInstaller = (installs: Ref.Ref<number>): CrewPolicyInstaller =>
  Ref.update(installs, (count) => count + 1);

/**
 * Runs `body` against a live crew engine over a fresh service repository and
 * a fresh workspace (the zcp container's `/var/www`, holding the crew home).
 */
export const withCrewEngine = <A, E>(
  body: (
    world: CrewWorld,
  ) => Effect.Effect<
    A,
    E,
    CrewEngine | CrewThreadDirectory | CrewToolHost | ServerCommandReadiness | CrewStore
  >,
  options: { readonly installer?: (installs: Ref.Ref<number>) => CrewPolicyInstaller } = {},
) =>
  Effect.gen(function* () {
    const root = makeServiceRepository();
    const workspace = NodeFS.realpathSync(
      NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-crew-mate-")),
    );
    const events = yield* PubSub.unbounded<SpiEvent>();
    const world: CrewWorld = {
      root,
      workspace,
      dispatched: yield* Ref.make<ReadonlyArray<OrchestrationCommand>>([]),
      admitted: yield* Ref.make<
        ReadonlyArray<{ readonly type: string; readonly principal: TurnPrincipal }>
      >([]),
      refusal: yield* Ref.make<string | undefined>(undefined),
      threads: yield* Ref.make<ReadonlyArray<OrchestrationThreadShell>>([]),
      installs: yield* Ref.make(0),
      publish: (event) => PubSub.publish(events, event).pipe(Effect.asVoid),
    };
    const installer = (options.installer ?? countingInstaller)(world.installs);
    const base = Layer.mergeAll(
      fakes(world, events),
      localSshProcessRunnerLayer(TEST_IDENTITY),
      ServerConfig.layer({
        cwd: workspace,
        zerops: ZEROPS,
        zeropsCrew: true,
      } as ServerConfig.ServerConfig["Service"]),
      Layer.effectDiscard(runMigrations()).pipe(
        Layer.provideMerge(NodeSqliteClient.layer({ filename: ":memory:" })),
      ),
    ).pipe(Layer.provideMerge(NodeServices.layer));
    const engine = Layer.effectContext(makeCrewEngine(installer)).pipe(
      Layer.provideMerge(crewServicesLayer),
      Layer.provideMerge(base),
    );
    return yield* body(world).pipe(
      Effect.provide(engine),
      Effect.ensuring(
        Effect.sync(() => {
          removeServiceRepository(root);
          NodeFS.rmSync(workspace, { recursive: true, force: true });
        }),
      ),
    );
  });

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

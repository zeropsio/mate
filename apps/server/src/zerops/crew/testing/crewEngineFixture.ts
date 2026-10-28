// @effect-diagnostics nodeBuiltinImport:off
/**
 * The platform around a crew for tests, as the engine world (`crewEngineWorld.ts`) builds it over
 * a temporary service repository (over the local ssh shim, as `crewGitFixture` does): the
 * service's mount and its verification, the Mate's logins and agents, the platform's process
 * list, admission (every principal it was asked about, the logins each press was judged on, and
 * the refusals a test can set), and the fixture state the fakes read and record.
 *
 * @module crewEngineFixture
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import {
  OrchestrationDispatchCommandError,
  ProviderDriverKind,
  type ServerProvider,
  type ZeropsAgentAuthSnapshot,
  type ZeropsLogin,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import * as Stream from "effect/Stream";

import * as ProcessRunner from "../../../processRunner.ts";
import { testTempDir } from "../../../testing/testTempDir.ts";
import { ClaudeThreadExtensionRegistry } from "../../../spi/claudeThreadProfile.ts";
import { type ProviderInstanceAgent, ProviderInstances } from "../../../spi/providerInstances.ts";
import { ThreadToolPolicyRegistry } from "../../../spi/threadToolPolicy.ts";
import { localSshProcessRunnerLayer } from "../../testing/localSsh.ts";
import { resolveZeropsEnvironment } from "../../ZeropsEnvironment.ts";
import { ZeropsAgentAuth } from "../../ZeropsAgentAuth.ts";
import { ZEROPS_SUBJECT_PREFIX } from "../../zeropsSubject.ts";
import { ZeropsLogins, type MateLogin } from "../../ZeropsLogins.ts";
import { ZeropsRepositorySource, type ZeropsRepository } from "../../ZeropsRepositorySource.ts";
import { ZeropsTurnAdmission, type TurnPrincipal } from "../../ZeropsTurnAdmission.ts";
import { ZeropsWorkspaceObserver } from "../../ZeropsWorkspaceObserver.ts";
import { CrewPlatformProcesses } from "../crewDeployState.ts";
import {
  makeServiceRepository,
  remoteEnvWithSupervisor,
  serviceRepository,
  TEST_IDENTITY,
} from "./crewGitFixture.ts";

/** The person who presses: Alex, in his own session. */
export const KAREL: TurnPrincipal = {
  kind: "session",
  subject: `${ZEROPS_SUBJECT_PREFIX}user-karel`,
};

/** The engine acting for the person outside their session: a run's or a task's later turns. */
export const AS_CREW: TurnPrincipal = {
  kind: "crew",
  startedBy: "user-karel",
};

export const ZEROPS = resolveZeropsEnvironment({
  projectId: TEST_IDENTITY.projectId,
  apiHost: undefined,
  apiToken: "the-mates-own-zerops-key",
})!;

/** What the fakes recorded, and the knobs a test turns. */
export interface CrewWorld {
  readonly root: string;
  readonly workspace: string;
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
  readonly installs: Ref.Ref<number>;
  /** ssh sessions the crew opened. */
  readonly sshCalls: Ref.Ref<number>;
  /** Mate logins beyond the defaults, by id. */
  readonly logins: Ref.Ref<ReadonlyMap<string, MateLogin>>;
  /** Logins whose instance is not live yet (the registry has no adapter for it). */
  readonly missingAgents: Ref.Ref<ReadonlySet<string>>;
  /** The instances' snapshots as the registry holds them: their plans' usage. */
  readonly providers: Ref.Ref<ReadonlyArray<ServerProvider>>;
  /** Each snapshot the registry publishes, as `ProviderInstances.changes` streams it. */
  readonly providerChanges: PubSub.PubSub<ReadonlyArray<ServerProvider>>;
  /** The project's processes as the platform lists them (`ZeropsRestartRead`); `unreadable` fails the read. */
  readonly processes: Ref.Ref<ReadonlyArray<unknown> | "unreadable">;
  /** How many times the engine read the project's processes. */
  readonly processReads: Ref.Ref<number>;
  /**
   * Holds the next ssh session whose remote script `matches` before it runs:
   * `reached` once the engine is waiting on it, `release` lets it run.
   */
  readonly holdSsh: (matches: (script: string) => boolean) => Effect.Effect<SshHold>;
  /**
   * The default Claude login is signed in afresh (a new signer): as in
   * production, its agent row moves on the agent-auth feed; the logins feed
   * carries only extra logins.
   */
  readonly signedIn: Effect.Effect<void>;
  /** A default agent's login is signed in afresh, on the agent-auth feed. */
  readonly signedInAs: (agent: "claude-code" | "codex") => Effect.Effect<void>;
  /** An extra login (`~/.mate/logins/<id>`) is signed in afresh, on the logins feed. */
  readonly extraSignedIn: (id: string) => Effect.Effect<void>;
}

export interface SshHold {
  readonly reached: Effect.Effect<void>;
  readonly release: Effect.Effect<void>;
}

export interface PendingHold {
  readonly matches: (script: string) => boolean;
  readonly reached: Deferred.Deferred<void>;
  readonly release: Deferred.Deferred<void>;
}

/** A pool container the Mate's agent leased: mounted like a dev service, but a thread's alone. */
export const TEST_LEASE: ZeropsRepository = {
  host: "webpool-3",
  kind: "lease",
  mountPath: "/var/www/webpool-3",
  remotePath: "/var/www",
};

/**
 * The service's mount and its verification, as on a container: the mount is
 * listed without an identity, and only an observation remembers a verified
 * binding — which a restart forgets. A leased pool container's mount is listed
 * beside it, as a thread's agent leaves one.
 */
export const repositoryLayers = (root: string, mountPath = root) =>
  Layer.effectContext(
    Effect.gen(function* () {
      const known = yield* Ref.make<ReadonlyArray<ZeropsRepository>>([]);
      const { identity: _identity, ...repository } = serviceRepository(root);
      const mounted = { ...repository, mountPath };
      const listed = Effect.succeed({
        _tag: "available",
        repositories: [mounted, TEST_LEASE],
      } as const);
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

/** The agent-auth feed's snapshot: both default agents signed in, each by its last signer. */
const agentSnapshot = (signers: ReadonlyMap<string, string>): ZeropsAgentAuthSnapshot => ({
  available: true,
  agents: (["claude-code", "codex"] as const).map((agentId) => ({
    agentId,
    credPresent: true,
    flagOAuth: true,
    flagToken: false,
    providerAuth: "authenticated" as const,
    state: "authorized" as const,
    authorizedBy: { subject: signers.get(agentId) ?? "user-karel" },
  })),
});

/** A sign-in the fixture moves: a default agent's (agent-auth feed) or an extra login's (logins feed). */
export type SignIn =
  | { readonly _tag: "agent"; readonly agent: "claude-code" | "codex" }
  | { readonly _tag: "extra"; readonly id: string };

/** The world's fixture state the fakes read and record. */
export type CrewFixtureWorld = Omit<
  CrewWorld,
  "holdSsh" | "signedIn" | "signedInAs" | "extraSignedIn"
>;

/**
 * The platform around a crew, as both worlds see it: the service's mount and its verification, the
 * Mate's logins and agents, the platform's process list, and the thread policy registries.
 */
export const platformFakes = (
  world: CrewFixtureWorld,
  signIns: PubSub.PubSub<SignIn>,
  /** Each default agent's signer as the agent-auth feed last told it. */
  agentSigners = new Map<string, string>(),
  mountPath = world.root,
) =>
  Layer.mergeAll(
    repositoryLayers(world.root, mountPath),
    Layer.succeed(CrewPlatformProcesses, {
      read: Ref.update(world.processReads, (count) => count + 1).pipe(
        Effect.andThen(Ref.get(world.processes)),
        Effect.map((processes) => (processes === "unreadable" ? undefined : processes)),
      ),
    }),
    Layer.mock(ZeropsLogins)({
      resolve: (id) => Effect.map(Ref.get(world.logins), (logins) => logins.get(id)),
      latest: Effect.succeed([]),
      // Production's shape: only the extra logins, never the defaults.
      changes: Stream.fromPubSub(signIns).pipe(
        Stream.zipWithIndex,
        Stream.filterMap(([signIn, index]) =>
          signIn._tag === "extra"
            ? Result.succeed([
                {
                  id: signIn.id,
                  agent: "claude-code",
                  label: signIn.id,
                  kind: "subscription",
                  default: false,
                  state: "authorized",
                  token: false,
                  signedInBy: `user-${index}`,
                } satisfies ZeropsLogin,
              ])
            : Result.failVoid,
        ),
      ),
    }),
    Layer.mock(ZeropsAgentAuth)({
      latest: Effect.sync(() => agentSnapshot(agentSigners)),
      // Production's shape: every agent row, each with its signer; no `logins`.
      changes: Stream.fromPubSub(signIns).pipe(
        Stream.zipWithIndex,
        Stream.filterMap(([signIn, index]) => {
          if (signIn._tag !== "agent") return Result.failVoid;
          agentSigners.set(signIn.agent, `user-${index}`);
          return Result.succeed(agentSnapshot(agentSigners));
        }),
      ),
    }),
    Layer.mock(ProviderInstances)({
      driverKindOf: () => Effect.succeed(ProviderDriverKind.make("claudeAgent")),
      agentOf: (instanceId) =>
        Effect.map(Ref.get(world.missingAgents), (missing) =>
          missing.has(instanceId) ? undefined : testAgentOf(instanceId),
        ),
      providers: Ref.get(world.providers),
      changes: Stream.fromPubSub(world.providerChanges),
    }),
    ThreadToolPolicyRegistry.layer,
    ClaudeThreadExtensionRegistry.layer,
  );

/** Admission as the fixture plays it: every turn and press recorded, refused as the test says. */
export const admissionFake = (world: CrewFixtureWorld) =>
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
    // The engine's runs (`run.prepare`), recorded and refused as V1's turns are.
    admitRun: ({ principal }) =>
      Ref.update(world.admitted, (all) => [...all, { type: "run", principal }]).pipe(
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
  });

/**
 * The agents the fixture's logins run, by id: Claude's carry the crew's
 * profile with its tools, Codex's without, Grok's with its tools but no
 * spend reported, Cursor's not at all, and any other id is no login of this
 * Mate.
 */
const TEST_AGENTS: ReadonlyArray<readonly [string, ProviderInstanceAgent]> = [
  [
    "claudeAgent",
    {
      driver: ProviderDriverKind.make("claudeAgent"),
      displayName: "Claude",
      threadProfile: { tools: true, reportsSpend: true },
    },
  ],
  [
    "codex",
    {
      driver: ProviderDriverKind.make("codex"),
      displayName: "Codex",
      threadProfile: { tools: false, reportsSpend: false },
    },
  ],
  [
    "grok",
    {
      driver: ProviderDriverKind.make("grok"),
      displayName: "Grok",
      threadProfile: { tools: true, reportsSpend: false },
    },
  ],
  [
    "cursor",
    { driver: ProviderDriverKind.make("cursor"), displayName: "Cursor", threadProfile: undefined },
  ],
];

export const testAgentOf = (instanceId: string): ProviderInstanceAgent | undefined =>
  TEST_AGENTS.find(([prefix]) => instanceId === prefix || instanceId.startsWith(`${prefix}_`))?.[1];

/** The local ssh shim, counting every session and holding the one a test asked for. */
export const countingSsh = (calls: Ref.Ref<number>, holds: Ref.Ref<ReadonlyArray<PendingHold>>) =>
  Layer.effect(
    ProcessRunner.ProcessRunner,
    Effect.gen(function* () {
      const runner = yield* ProcessRunner.ProcessRunner;
      const held = (script: string) =>
        Effect.gen(function* () {
          const hold = yield* Ref.modify(holds, (all) => {
            const found = all.find((entry) => entry.matches(script));
            return [found, found === undefined ? all : all.filter((entry) => entry !== found)];
          });
          if (hold === undefined) return;
          yield* Deferred.succeed(hold.reached, undefined);
          yield* Deferred.await(hold.release);
        });
      // The worker masks handler interruption; the local child must still die with this life.
      return ProcessRunner.ProcessRunner.of({
        run: (input) =>
          (input.command === "ssh"
            ? Ref.update(calls, (count) => count + 1).pipe(
                Effect.andThen(held(input.args.at(-1) ?? "")),
              )
            : Effect.void
          ).pipe(Effect.andThen(runner.run(input)), Effect.interruptible),
      });
    }),
  ).pipe(Layer.provide(localSshProcessRunnerLayer(remoteEnvWithSupervisor())));

/**
 * One world's fixture: a fresh service repository, the Mate's workspace and the fakes' records,
 * shared by every phase (server lifetime) of a journey.
 */
export const makeFixtureWorld = Effect.gen(function* () {
  const root = makeServiceRepository();
  const workspace = NodeFS.realpathSync(testTempDir("t3-crew-mate-"));
  const signIns = yield* PubSub.unbounded<SignIn>();
  const holds = yield* Ref.make<ReadonlyArray<PendingHold>>([]);
  const world: CrewWorld = {
    root,
    workspace,
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
    installs: yield* Ref.make(0),
    sshCalls: yield* Ref.make(0),
    logins: yield* Ref.make<ReadonlyMap<string, MateLogin>>(new Map()),
    missingAgents: yield* Ref.make<ReadonlySet<string>>(new Set()),
    providers: yield* Ref.make<ReadonlyArray<ServerProvider>>([]),
    providerChanges: yield* PubSub.unbounded<ReadonlyArray<ServerProvider>>(),
    processes: yield* Ref.make<ReadonlyArray<unknown> | "unreadable">([]),
    processReads: yield* Ref.make(0),
    holdSsh: (matches) =>
      Effect.gen(function* () {
        const hold: PendingHold = {
          matches,
          reached: yield* Deferred.make<void>(),
          release: yield* Deferred.make<void>(),
        };
        yield* Ref.update(holds, (all) => [...all, hold]);
        return {
          reached: Deferred.await(hold.reached),
          release: Deferred.succeed(hold.release, undefined).pipe(Effect.asVoid),
        };
      }),
    signedIn: PubSub.publish(signIns, { _tag: "agent", agent: "claude-code" }).pipe(Effect.asVoid),
    signedInAs: (agent) => PubSub.publish(signIns, { _tag: "agent", agent }).pipe(Effect.asVoid),
    extraSignedIn: (id) => PubSub.publish(signIns, { _tag: "extra", id }).pipe(Effect.asVoid),
  };
  return { world, signIns, holds };
});

/**
 * The budget of a test that drives a live crew engine: the server suite's own (`testTimeout` in
 * `apps/server/vite.config.ts`). A run from the repository root holds every test to the root's
 * 60 s, with files in parallel, and an engine's work — copies, commits, a merge, a check, each a
 * git or shell process — takes longer on a loaded machine without anything going wrong.
 */
export const CREW_ENGINE_TEST_TIMEOUT = Number(process.env.CREW_JOURNEY_TIMEOUT ?? 120_000);

/** Waits for background work; the test runner owns the hang guard. */
export const eventually = <E, R>(check: Effect.Effect<boolean, E, R>): Effect.Effect<void, E, R> =>
  Effect.gen(function* () {
    while (true) {
      if (yield* check) return;
      yield* Effect.sleep("25 millis");
    }
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

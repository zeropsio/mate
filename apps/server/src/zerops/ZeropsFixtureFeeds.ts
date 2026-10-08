import type {
  MateAttention,
  ThreadId,
  ZeropsAgentAuthSnapshot,
  ZeropsAgentId,
  ZeropsAgentLoginState,
  ZeropsLifecycle as ZeropsLifecycleSnapshot,
} from "@t3tools/contracts";
import { EnvironmentId, ZeropsAgentLoginError } from "@t3tools/contracts";
import {
  loadShowcaseScene,
  SHOWCASE_SCENE_IDS,
  ShowcaseSceneJson,
  type ShowcaseAgentLoginSnapshot,
  type ShowcaseScene,
  type ShowcaseSceneId,
} from "@t3tools/shared/showcaseScenes";
import * as DateTime from "effect/DateTime";
import * as Data from "effect/Data";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as FetchHttpClient from "effect/http/FetchHttpClient";

import { layer as providerInstancesLayer } from "../spi/providerInstances.ts";
import { subscribeBeforeSnapshot } from "../utils/subscribeBeforeSnapshot.ts";
import * as ZeropsAgentAuth from "./ZeropsAgentAuth.ts";
import * as ZeropsAgentLoginModule from "./ZeropsAgentLogin.ts";
import * as ZeropsGitRemoteProbe from "./ZeropsGitRemoteProbe.ts";
import * as ZeropsMateKeyModule from "./ZeropsMateKey.ts";
import * as ZeropsOrgReadModule from "./ZeropsOrgRead.ts";
import * as ZeropsProjectAccessModule from "./ZeropsProjectAccess.ts";
import { crewLayerInert } from "./crew/crewLayer.ts";
import { engineLayer } from "../engine/layer.ts";
import { noRestartEvidence, serverWorkspace, zeropsRunAdmission } from "./engineAdapters.ts";
import * as ZeropsProjectSigners from "./ZeropsProjectSigners.ts";
import * as ZeropsTurnAdmission from "./ZeropsTurnAdmission.ts";
import type { ZeropsAgentLoginByAgent } from "./ZeropsAgentLogin.ts";
import * as ZeropsBrowserStreamModule from "./ZeropsBrowserStream.ts";
import * as ZeropsCliModule from "./ZeropsCli.ts";
import * as ZeropsDataConsoleModule from "./ZeropsDataConsole.ts";
import * as ZeropsLifecycle from "./ZeropsLifecycle.ts";
import * as ZeropsLoginsModule from "./ZeropsLogins.ts";
import * as ZeropsMateAttentionModule from "./ZeropsMateAttention.ts";
import * as ZeropsSignOutModule from "./ZeropsSignOut.ts";
import * as ZeropsMateUpdateModule from "./ZeropsMateUpdate.ts";

const strictParseOptions = {
  errors: "all",
  onExcessProperty: "error",
} as const;

const decodeSceneFile = Schema.decodeUnknownSync(
  Schema.fromJsonString(ShowcaseSceneJson),
  strictParseOptions,
);

const isShowcaseSceneId = (value: string): value is ShowcaseSceneId =>
  (SHOWCASE_SCENE_IDS as ReadonlyArray<string>).includes(value);

export class ZeropsFixtureSceneError extends Data.TaggedError("ZeropsFixtureSceneError")<{
  readonly selector: string;
  readonly cause: unknown;
}> {
  override get message(): string {
    const validIds =
      this.selector.startsWith("web:") && !isShowcaseSceneId(this.selector)
        ? ` Valid scene ids: ${SHOWCASE_SCENE_IDS.join(", ")}.`
        : "";
    return `Could not load Zerops fixture scene ${this.selector}.${validIds}`;
  }
}

const decodeSelectedScene = (selector: string, decode: () => ShowcaseScene) =>
  Effect.try({
    try: decode,
    catch: (cause) => new ZeropsFixtureSceneError({ selector, cause }),
  });

export const loadFixtureScene = (selector: string) =>
  Effect.gen(function* () {
    if (isShowcaseSceneId(selector)) {
      return yield* decodeSelectedScene(selector, () => loadShowcaseScene(selector));
    }

    const path = yield* Path.Path;
    if (!path.isAbsolute(selector)) {
      return yield* new ZeropsFixtureSceneError({
        selector,
        cause: "Expected a known web:<id> or an absolute JSON path.",
      });
    }

    const fs = yield* FileSystem.FileSystem;
    const raw = yield* fs
      .readFileString(selector)
      .pipe(Effect.mapError((cause) => new ZeropsFixtureSceneError({ selector, cause })));
    return yield* decodeSelectedScene(selector, () => decodeSceneFile(raw));
  });

const makeSnapshotPublisher = <Snapshot>(
  initial: Snapshot,
  contentSignature: (snapshot: Snapshot) => string,
) =>
  Effect.gen(function* () {
    const snapshotRef = yield* Ref.make(initial);
    const changes = yield* PubSub.sliding<Snapshot>(8);
    const mutex = yield* Semaphore.make(1);

    const publishIfChanged = (next: Snapshot) =>
      mutex.withPermits(1)(
        Effect.gen(function* () {
          const current = yield* Ref.get(snapshotRef);
          if (contentSignature(current) === contentSignature(next)) {
            yield* Ref.set(snapshotRef, next);
            return next;
          }
          yield* Ref.set(snapshotRef, next);
          yield* PubSub.publish(changes, next);
          return next;
        }),
      );

    const publishCurrent = mutex.withPermits(1)(
      Effect.gen(function* () {
        const current = yield* Ref.get(snapshotRef);
        yield* PubSub.publish(changes, current);
        return current;
      }),
    );

    const latest = Ref.get(snapshotRef);
    return {
      latest,
      changes: Stream.fromPubSub(changes),
      subscribe: subscribeBeforeSnapshot(changes, latest, mutex),
      subscribeWith: <E, R>(snapshot: Effect.Effect<Snapshot, E, R>) =>
        subscribeBeforeSnapshot(changes, snapshot, mutex),
      publishIfChanged,
      publishCurrent,
    };
  });

/** Scene steps are absolute snapshots for each feed rather than patches over the previous value. */
type FixtureSceneStep = NonNullable<ShowcaseScene["steps"]>[number];

const replaySteps = <Snapshot>(
  scene: ShowcaseScene,
  select: (step: FixtureSceneStep) => Snapshot | undefined,
  publish: (snapshot: Snapshot) => Effect.Effect<Snapshot>,
) =>
  Effect.forEach(
    scene.steps ?? [],
    (step) =>
      Effect.sleep(Duration.millis(step.afterMs)).pipe(
        Effect.andThen(
          Effect.suspend(() => {
            const snapshot = select(step);
            return snapshot === undefined ? Effect.void : publish(snapshot).pipe(Effect.asVoid);
          }),
        ),
      ),
    { discard: true },
  );

const jsonContentSignature = (snapshot: unknown): string => JSON.stringify(snapshot);

const emptyLifecycle = (threadId: ThreadId): ZeropsLifecycleSnapshot => ({
  threadId,
  recentTools: [],
});

const makeLifecycle = (scene: ShowcaseScene) =>
  Effect.gen(function* () {
    const publisher = yield* makeSnapshotPublisher(scene.lifecycle, jsonContentSignature);
    yield* replaySteps(scene, (step) => step.lifecycle, publisher.publishIfChanged).pipe(
      Effect.forkScoped,
    );

    const get = (threadId: ThreadId) =>
      publisher.latest.pipe(
        Effect.map((snapshot) =>
          snapshot.threadId === threadId ? snapshot : emptyLifecycle(threadId),
        ),
      );

    return {
      get,
      subscribe: (threadId) =>
        publisher.subscribeWith(get(threadId)).pipe(
          Effect.map(({ latest, changes }) => ({
            latest,
            changes: Stream.filter(changes, (snapshot) => snapshot.threadId === threadId),
          })),
        ),
      // The scripted scene is authoritative in fixture mode, so provider events
      // cannot mutate the deterministic lifecycle presented to clients.
      ingest: () => Effect.void,
    } satisfies ZeropsLifecycle.ZeropsLifecycle["Service"];
  });

const makeAgentAuth = (scene: ShowcaseScene) =>
  Effect.gen(function* () {
    const publisher = yield* makeSnapshotPublisher<ZeropsAgentAuthSnapshot>(
      scene.agentAuth,
      jsonContentSignature,
    );
    yield* replaySteps(scene, (step) => step.agentAuth, publisher.publishIfChanged).pipe(
      Effect.forkScoped,
    );

    return {
      latest: publisher.latest,
      changes: publisher.changes,
      subscribe: publisher.subscribe,
      recheckNow: () => publisher.publishCurrent.pipe(Effect.asVoid),
      // A fixture/showcase run never has a sign-out in flight to invalidate.
      invalidatePendingMark: () => Effect.void,
    } satisfies ZeropsAgentAuth.ZeropsAgentAuth["Service"];
  });

const normalizeLogins = (logins: ShowcaseAgentLoginSnapshot): ZeropsAgentLoginByAgent => ({
  "claude-code": logins["claude-code"],
  codex: logins.codex,
});

const awaitingLoginDetails: Readonly<
  Record<ZeropsAgentId, Pick<ZeropsAgentLoginState, "url" | "code">>
> = {
  "claude-code": { url: "https://claude.ai/login" },
  codex: { url: "https://auth.openai.com/codex/device", code: "FIXTURE-CODE" },
};

const isActiveLogin = (login: ZeropsAgentLoginState | undefined): boolean =>
  login !== undefined &&
  login.phase !== "succeeded" &&
  login.phase !== "failed" &&
  login.phase !== "cancelled";

const makeAgentLogin = (scene: ShowcaseScene) =>
  Effect.gen(function* () {
    const zeropsAgentAuth = yield* ZeropsAgentAuth.ZeropsAgentAuth;
    const serviceScope = yield* Scope.Scope;
    const initialLogins = normalizeLogins(scene.agentLogin);
    const publisher = yield* makeSnapshotPublisher<ZeropsAgentLoginByAgent>(
      initialLogins,
      jsonContentSignature,
    );
    const initialActiveTokens = new Map<ZeropsAgentId, symbol>();
    for (const agentId of ["claude-code", "codex"] as const) {
      if (isActiveLogin(initialLogins[agentId])) {
        initialActiveTokens.set(agentId, Symbol(agentId));
      }
    }
    const activeTokens = yield* Ref.make(initialActiveTokens);
    const unavailable = new ZeropsAgentLoginError({
      reason: "unavailable",
      detail: "This environment does not offer a server-driven login.",
    });

    const publishLogins = (logins: ZeropsAgentLoginByAgent) =>
      Ref.update(activeTokens, (tokens) => {
        const next = new Map(tokens);
        for (const agentId of ["claude-code", "codex"] as const) {
          if (isActiveLogin(logins[agentId])) {
            if (!next.has(agentId)) {
              next.set(agentId, Symbol(agentId));
            }
          } else {
            next.delete(agentId);
          }
        }
        return next;
      }).pipe(Effect.andThen(publisher.publishIfChanged(logins)));

    yield* replaySteps(
      scene,
      (step) => (step.agentLogin === undefined ? undefined : normalizeLogins(step.agentLogin)),
      publishLogins,
    ).pipe(Effect.forkScoped);

    const setLogin = (agentId: ZeropsAgentId, login: ZeropsAgentLoginState) =>
      publisher.latest.pipe(
        Effect.flatMap((current) => publishLogins({ ...current, [agentId]: login })),
        Effect.asVoid,
      );

    const isActive = (agentId: ZeropsAgentId, token: symbol) =>
      Ref.get(activeTokens).pipe(Effect.map((tokens) => tokens.get(agentId) === token));

    const finishLogin = (
      agentId: ZeropsAgentId,
      token: symbol,
      startedAt: DateTime.Utc,
      startedBy: string,
    ) =>
      Effect.gen(function* () {
        yield* Effect.sleep(Duration.millis(500));
        if (!(yield* isActive(agentId, token))) {
          return;
        }
        yield* setLogin(agentId, {
          phase: "awaiting-browser",
          terminalId: ZeropsAgentLoginModule.loginTerminalId(agentId),
          startedAt,
          startedBy,
          ...awaitingLoginDetails[agentId],
        });

        yield* Effect.sleep(Duration.millis(2_500));
        if (!(yield* isActive(agentId, token))) {
          return;
        }
        yield* zeropsAgentAuth.recheckNow(agentId);
        yield* setLogin(agentId, {
          phase: "succeeded",
          terminalId: ZeropsAgentLoginModule.loginTerminalId(agentId),
          startedAt,
          startedBy,
        });
      });

    const start = (agentId: ZeropsAgentId, _threadId: string, subject: string) =>
      Effect.gen(function* () {
        if (!scene.agentAuth.available) {
          return yield* unavailable;
        }

        const terminalId = ZeropsAgentLoginModule.loginTerminalId(agentId);
        if ((yield* Ref.get(activeTokens)).has(agentId)) {
          return { terminalId: (yield* publisher.latest)[agentId]?.terminalId ?? terminalId };
        }

        const token = Symbol(agentId);
        const startedAt = yield* DateTime.now;
        yield* Ref.update(activeTokens, (tokens) => new Map(tokens).set(agentId, token));
        yield* setLogin(agentId, { phase: "starting", terminalId, startedAt, startedBy: subject });
        yield* finishLogin(agentId, token, startedAt, subject).pipe(
          Effect.forkIn(serviceScope),
          Effect.asVoid,
        );
        return { terminalId };
      });

    const cancel = (agentId: ZeropsAgentId) =>
      Effect.gen(function* () {
        if (!scene.agentAuth.available) {
          return yield* unavailable;
        }

        const token = (yield* Ref.get(activeTokens)).get(agentId);
        if (token === undefined) {
          return;
        }
        const current = (yield* publisher.latest)[agentId];
        yield* setLogin(agentId, {
          phase: "cancelled",
          terminalId: current?.terminalId ?? ZeropsAgentLoginModule.loginTerminalId(agentId),
          startedAt: current?.startedAt ?? (yield* DateTime.now),
          startedBy: current?.startedBy ?? "",
        });
      });

    // The scene's login finishes on its own clock; a submitted code only
    // shows the step it would take.
    const submitCode = (agentId: ZeropsAgentId, _code: string) =>
      Effect.gen(function* () {
        if (!scene.agentAuth.available) {
          return yield* unavailable;
        }
        const current = (yield* publisher.latest)[agentId];
        if (
          agentId !== "claude-code" ||
          current === undefined ||
          (current.phase !== "awaiting-browser" && current.phase !== "awaiting-code")
        ) {
          return yield* new ZeropsAgentLoginError({
            reason: "not-awaiting-code",
            detail: "This sign-in is not waiting for a code. Start it again.",
          });
        }
        yield* setLogin(agentId, { ...current, phase: "verifying-code" });
      });

    return {
      latest: publisher.latest,
      changes: publisher.changes,
      subscribe: publisher.subscribe,
      start,
      cancel,
      submitCode,
    } satisfies ZeropsAgentLoginModule.ZeropsAgentLogin["Service"];
  });

const lifecycleLayer = (scene: ShowcaseScene) =>
  Layer.effect(ZeropsLifecycle.ZeropsLifecycle, makeLifecycle(scene));

const agentAuthLayer = (scene: ShowcaseScene) =>
  Layer.effect(ZeropsAgentAuth.ZeropsAgentAuth, makeAgentAuth(scene));

const agentLoginLayer = (scene: ShowcaseScene) =>
  Layer.effect(ZeropsAgentLoginModule.ZeropsAgentLogin, makeAgentLogin(scene));

/**
 * A fixture/showcase run has no container to sign anything out of — unlike
 * `start`/`cancel`, sign-out is never simulated for a scene, it just
 * reports the same "unavailable" a real, non-Zerops server would.
 */
const signOutFixtureLayer = Layer.succeed(
  ZeropsSignOutModule.ZeropsSignOut,
  ZeropsSignOutModule.unavailable,
);

/**
 * A fixture/showcase run never has a real agent-browser daemon and must
 * never touch the real filesystem or open a real socket (determinism) — this
 * always reports `no-browser`. Reuses {@link ZeropsBrowserStreamModule.make}
 * (rather than a bespoke stub) so the reported behavior is provably the same
 * "port unresolvable" path the live service exercises; `connect` is asserted
 * unreachable since `readStreamPort` never resolves to a port.
 */
const browserStreamLayer = () =>
  Layer.effect(
    ZeropsBrowserStreamModule.ZeropsBrowserStream,
    ZeropsBrowserStreamModule.make({
      readStreamPort: Effect.succeed(undefined),
      connect: () => {
        throw new Error("ZeropsBrowserStream fixture: connect is unreachable (always no-browser)");
      },
    }),
  );

/**
 * A fixture/showcase run never has a real `zcp` and must never spawn a
 * process (determinism) — mate update is reported unavailable, matching a
 * standalone server (spec-mate.md §2.9 MU-3: absent, never fabricated).
 */
const zeropsCliFixtureLayer = () =>
  Layer.succeed(
    ZeropsCliModule.ZeropsCli,
    ZeropsCliModule.ZeropsCli.of({
      mateStatus: () => {
        throw new Error("ZeropsCli fixture: mateStatus is unreachable");
      },
      mateUpdate: () => {
        throw new Error("ZeropsCli fixture: mateUpdate is unreachable");
      },
    }),
  );

const zeropsMateUpdateFixtureLayer = () =>
  Layer.succeed(
    ZeropsMateUpdateModule.ZeropsMateUpdate,
    ZeropsMateUpdateModule.ZeropsMateUpdate.of({
      current: Effect.succeed(undefined),
      changes: Stream.make(undefined),
      refresh: Effect.void,
      check: Effect.succeed(undefined),
    }),
  );

/**
 * A fixture/showcase run never has a real `zcp` binary to spawn, so its Data
 * session is `unavailable` the way a missing binary makes it live: the fake
 * spawn fails on its own microtask (`"zcp is not available"`), and every
 * *Try again* fails the same way.
 */
const dataConsoleLayer = () =>
  Layer.effect(
    ZeropsDataConsoleModule.ZeropsDataConsole,
    ZeropsDataConsoleModule.make({
      spawnDataConsole: () => {
        let errorListener: ((error: unknown) => void) | undefined;
        queueMicrotask(() => errorListener?.(new Error("spawn zcp ENOENT")));
        return {
          onStdout: () => {},
          onStderr: () => {},
          onExit: () => {},
          onError: (listener) => {
            errorListener = listener;
          },
          endStdin: () => {},
          kill: () => {},
        };
      },
    }),
  ).pipe(Layer.provide(FetchHttpClient.layer));

// A fixture scene saw nobody sign anything in, has no member list to confirm
// anybody's membership by, and signs nothing out.
const fixtureSignersLayer = Layer.succeed(
  ZeropsProjectSigners.ZeropsProjectSigners,
  ZeropsProjectSigners.ZeropsProjectSigners.of({
    signers: Effect.succeed({}),
    turnRefusal: ({ agent, subject }) =>
      Effect.succeed(ZeropsProjectSigners.turnRefusal({ agent, signer: undefined, subject })),
    loginRefusal: ({ state, token, subject }) =>
      Effect.succeed(
        ZeropsProjectSigners.loginTurnRefusal({ state, token, signer: undefined, subject }),
      ),
    hasProjectAccess: () => Effect.succeed(undefined),
  }),
);

/**
 * A fixture scene lists the two default logins its agents are and nothing
 * beyond them: there is no settings file to add one to, and nothing to sign out.
 */
const loginsFixtureLayer = Layer.effect(
  ZeropsLoginsModule.ZeropsLogins,
  ZeropsLoginsModule.unavailable,
);

/**
 * A fixture scene's attention: one fixed value, nothing at work or waiting. A scene follows no
 * chats of its own, and a revision that never moves claims nothing it did not see.
 */
export const FIXTURE_ATTENTION: MateAttention = {
  source: {
    environmentId: EnvironmentId.make("fixture"),
    epoch: 1,
    incarnation: "fixture",
    revision: 0,
  },
  mainThreadId: null,
  lastThreadId: null,
  working: 0,
  waiting: 0,
  results: [],
  questions: [],
  truncated: false,
};

export const makeFixtureZeropsLayer = (scene: ShowcaseScene) => {
  const auth = agentAuthLayer(scene);
  const login = agentLoginLayer(scene);
  // The live gate, over this scene's agents and signers — a fixture admits
  // and refuses turns exactly as a live Mate would on the same facts.
  const admission = ZeropsTurnAdmission.layer.pipe(
    Layer.provide(login),
    Layer.provide(auth),
    Layer.provide(loginsFixtureLayer),
    Layer.provide(fixtureSignersLayer),
    Layer.provide(providerInstancesLayer),
  );
  return Layer.mergeAll(
    lifecycleLayer(scene),
    login.pipe(Layer.provideMerge(auth)),
    admission,
    signOutFixtureLayer,
    loginsFixtureLayer,
    browserStreamLayer(),
    Layer.succeed(
      ZeropsMateAttentionModule.ZeropsMateAttention,
      ZeropsMateAttentionModule.ZeropsMateAttention.of({
        healthCurrent: Effect.succeed(Option.none()),
        healthChanges: Stream.empty,
        current: Effect.succeed(FIXTURE_ATTENTION),
        changes: Stream.make(FIXTURE_ATTENTION),
      }),
    ),
    zeropsCliFixtureLayer(),
    zeropsMateUpdateFixtureLayer(),
    dataConsoleLayer(),
    // A fixture scene has no remote either: nothing to probe, and saying so
    // is honest where inventing "reachable" would not be.
    Layer.succeed(
      ZeropsGitRemoteProbe.ZeropsGitRemoteProbe,
      ZeropsGitRemoteProbe.ZeropsGitRemoteProbe.of({
        probe: (input) =>
          Effect.succeed({
            reachable: false,
            remote: input.remote ?? ZeropsGitRemoteProbe.DEFAULT_REMOTE,
            refCount: 0,
            detail: "this is a fixture scene, which has no remote",
          }),
      }),
    ),
    fixtureSignersLayer,
    // A fixture scene has no dev services for a crew to work on: crew mode
    // is off, the feed says so and every crew request is refused.
    crewLayerInert,
    // The engine the switch names, as on a live Mate: its runs pass the same
    // gate, and a scene has no platform to read a restart from.
    engineLayer.pipe(
      Layer.provideMerge(Layer.mergeAll(zeropsRunAdmission, noRestartEvidence, serverWorkspace)),
      Layer.provide(admission),
    ),
    // A fixture scene has no live env store either: the reader answers
    // `undefined` explicitly, never a hidden default. `ZeropsIdentityStatus`
    // is not provided here — it is supplied once, live or fixture alike, in
    // `server.ts`'s `RuntimeBaseDependenciesLive`, above the point where
    // this layer is selected; a second instance here would shadow it for
    // nothing that needs it.
    Layer.succeed(
      ZeropsMateKeyModule.ZeropsMateKey,
      ZeropsMateKeyModule.snapshotOnlyReader(undefined),
    ),
    // The project and the member list the door would read with that key
    // answer the same, and reach for no platform: there is no key to read
    // them with.
    Layer.succeed(
      ZeropsOrgReadModule.ZeropsOrgRead,
      ZeropsOrgReadModule.ZeropsOrgRead.of({
        project: () => Effect.succeed({ kind: "no-key" }),
        members: () => Effect.succeed({ kind: "no-key" }),
      }),
    ),
    // No HQ relays to a fixture scene, and nothing is read for it either.
    Layer.succeed(
      ZeropsProjectAccessModule.ZeropsProjectAccess,
      ZeropsProjectAccessModule.ZeropsProjectAccess.of({
        relayed: () => Effect.void,
        relay: Effect.succeed(Option.none()),
        read: Effect.succeed({ ok: false }),
        changes: Stream.empty,
      }),
    ),
  );
};

import type {
  ThreadId,
  ZeropsAgentAuthSnapshot,
  ZeropsAgentId,
  ZeropsAgentLoginState,
  ZeropsLifecycle as ZeropsLifecycleSnapshot,
} from "@t3tools/contracts";
import { ZeropsAgentLoginError } from "@t3tools/contracts";
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
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import { subscribeBeforeSnapshot } from "../utils/subscribeBeforeSnapshot.ts";
import * as ZeropsAgentAuth from "./ZeropsAgentAuth.ts";
import * as ZeropsAgentLoginModule from "./ZeropsAgentLogin.ts";
import type { ZeropsAgentLoginByAgent } from "./ZeropsAgentLogin.ts";
import * as ZeropsBrowserStreamModule from "./ZeropsBrowserStream.ts";
import * as ZeropsLifecycle from "./ZeropsLifecycle.ts";

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

    const finishLogin = (agentId: ZeropsAgentId, token: symbol, startedAt: DateTime.Utc) =>
      Effect.gen(function* () {
        yield* Effect.sleep(Duration.millis(500));
        if (!(yield* isActive(agentId, token))) {
          return;
        }
        yield* setLogin(agentId, {
          phase: "awaiting-browser",
          terminalId: ZeropsAgentLoginModule.loginTerminalId(agentId),
          startedAt,
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
        });
      });

    const start = (agentId: ZeropsAgentId, _threadId: string) =>
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
        yield* setLogin(agentId, { phase: "starting", terminalId, startedAt });
        yield* finishLogin(agentId, token, startedAt).pipe(
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
        });
      });

    return {
      latest: publisher.latest,
      changes: publisher.changes,
      subscribe: publisher.subscribe,
      start,
      cancel,
    } satisfies ZeropsAgentLoginModule.ZeropsAgentLogin["Service"];
  });

const lifecycleLayer = (scene: ShowcaseScene) =>
  Layer.effect(ZeropsLifecycle.ZeropsLifecycle, makeLifecycle(scene));

const agentAuthLayer = (scene: ShowcaseScene) =>
  Layer.effect(ZeropsAgentAuth.ZeropsAgentAuth, makeAgentAuth(scene));

const agentLoginLayer = (scene: ShowcaseScene) =>
  Layer.effect(ZeropsAgentLoginModule.ZeropsAgentLogin, makeAgentLogin(scene));

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

export const makeFixtureZeropsLayer = (scene: ShowcaseScene) => {
  const auth = agentAuthLayer(scene);
  return Layer.mergeAll(
    lifecycleLayer(scene),
    agentLoginLayer(scene).pipe(Layer.provideMerge(auth)),
    browserStreamLayer(),
  );
};

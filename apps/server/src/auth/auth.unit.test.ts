import { expect, it } from "@effect/vitest";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { AuthSessionId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import * as ServerConfig from "../config.ts";
import { resolveZeropsEnvironment } from "../zerops/ZeropsEnvironment.ts";
import * as EnvironmentAuthPolicy from "./EnvironmentAuthPolicy.ts";
import { mapDpopReplayStoreError } from "./dpop.ts";
import { pruneExpiredReplayMarkers, REPLAY_MARKER_MAX_AGE } from "./replayMarkers.ts";
import * as ServerSecretStore from "./ServerSecretStore.ts";
import type { SessionCredentialChange } from "./SessionStore.ts";
import { awaitSessionEnd } from "./sessionLifetime.ts";
import { isRemoteReachableHost, resolveSessionCookieName } from "./utils.ts";

// witness: apps/server/src/auth/EnvironmentAuthPolicy.ts | ? ["bearer-access-token"] → ? ["bearer-access-token", "dpop-access-token"]
it.effect(
  "AU1: Inside a Zerops container the server offers only the Zerops ticket door and bearer access tokens, and counts as remote-reachable though it binds loopback",
  () =>
    Effect.gen(function* () {
      const policy = yield* EnvironmentAuthPolicy.EnvironmentAuthPolicy;
      const descriptor = yield* policy.getDescriptor();

      expect(descriptor.policy).toBe("remote-reachable");
      expect(descriptor.bootstrapMethods).toEqual(["ticket"]);
      expect(descriptor.sessionMethods).toEqual(["bearer-access-token"]);
    }).pipe(
      Effect.provide(
        EnvironmentAuthPolicy.layer.pipe(
          Layer.provide(
            Layer.effect(
              ServerConfig.ServerConfig,
              Effect.map(ServerConfig.ServerConfig, (config) => ({
                ...config,
                zeropsFixtures: undefined,
                mode: "web" as const,
                host: "127.0.0.1",
                zerops: resolveZeropsEnvironment({
                  projectId: "TEST000000000000000023",
                  apiHost: undefined,
                }),
              })),
            ).pipe(
              Layer.provide(
                ServerConfig.layerTest(process.cwd(), { prefix: "t3-auth-policy-test-" }),
              ),
            ),
          ),
          Layer.provide(NodeServices.layer),
        ),
      ),
    ),
);

// witness: apps/server/src/auth/EnvironmentAuthPolicy.ts | const bootstrapMethods: ServerAuthDescriptor["bootstrapMethods"] = isZerops ? ["ticket"] : []; → const bootstrapMethods: ServerAuthDescriptor["bootstrapMethods"] = ["ticket"];
it.effect(
  "AU2: Outside a Zerops container the server offers no bootstrap door, on loopback or beyond",
  () =>
    Effect.gen(function* () {
      const descriptorUnder = (overrides: Partial<ServerConfig.ServerConfig["Service"]>) =>
        Effect.flatMap(EnvironmentAuthPolicy.EnvironmentAuthPolicy, (policy) =>
          policy.getDescriptor(),
        ).pipe(
          Effect.provide(
            EnvironmentAuthPolicy.layer.pipe(
              Layer.provide(
                Layer.effect(
                  ServerConfig.ServerConfig,
                  Effect.map(ServerConfig.ServerConfig, (config) => ({
                    ...config,
                    zeropsFixtures: undefined,
                    ...overrides,
                  })),
                ).pipe(
                  Layer.provide(
                    ServerConfig.layerTest(process.cwd(), { prefix: "t3-auth-policy-test-" }),
                  ),
                ),
              ),
            ),
          ),
        );

      const loopback = yield* descriptorUnder({ mode: "web", host: "127.0.0.1", port: 3773 });
      expect(loopback.bootstrapMethods).toEqual([]);

      const wildcard = yield* descriptorUnder({ mode: "web", host: "0.0.0.0" });
      expect(wildcard.bootstrapMethods).toEqual([]);
    }).pipe(Effect.provide(NodeServices.layer)),
);

// witness: apps/server/src/auth/utils.ts | if (!input.development && isRemoteReachableHost(input.host)) { → if (isRemoteReachableHost(input.host)) {
it("AU3: A hosted web server's session cookie is `t3_session` whatever its port, host or state directory, while a development server's carries its port and a hash of its state directory, on loopback and on a wildcard host alike", () => {
  expect(
    resolveSessionCookieName({
      mode: "web",
      port: 8080,
      host: "0.0.0.0",
      instanceKey: "/srv/release-a",
      development: false,
    }),
  ).toBe("t3_session");
  expect(
    resolveSessionCookieName({
      mode: "web",
      port: 9090,
      host: "app.example.com",
      instanceKey: "/srv/release-b",
      development: false,
    }),
  ).toBe("t3_session");

  const first = resolveSessionCookieName({
    mode: "web",
    port: 5775,
    host: "127.0.0.1",
    instanceKey: "/tmp/t3-agent-one",
    development: true,
  });
  const second = resolveSessionCookieName({
    mode: "web",
    port: 5775,
    host: "127.0.0.1",
    instanceKey: "/tmp/t3-agent-two",
    development: true,
  });
  expect(first).toMatch(/^t3_session_5775_[a-f0-9]{12}$/);
  expect(second).toMatch(/^t3_session_5775_[a-f0-9]{12}$/);
  expect(first).not.toBe(second);

  expect(
    resolveSessionCookieName({
      mode: "web",
      port: 5775,
      host: "0.0.0.0",
      instanceKey: "/tmp/t3-wildcard-dev",
      development: true,
    }),
  ).toMatch(/^t3_session_5775_[a-f0-9]{12}$/);
});

// witness: apps/server/src/auth/utils.ts | host.startsWith("127.") → host.startsWith("127.0.")
it("AU4: `localhost`, every `127.` address and `::1` count as loopback, and the wildcard and any other address as reachable from outside", () => {
  expect(isRemoteReachableHost(undefined)).toBe(false);
  expect(isRemoteReachableHost("localhost")).toBe(false);
  expect(isRemoteReachableHost("127.12.0.1")).toBe(false);
  expect(isRemoteReachableHost("[::1]")).toBe(false);
  expect(isRemoteReachableHost("0.0.0.0")).toBe(true);
  expect(isRemoteReachableHost("192.168.1.50")).toBe(true);
});

// witness: apps/server/src/auth/dpop.ts | ServerSecretStore.isSecretAlreadyExistsError(error) → !ServerSecretStore.isSecretAlreadyExistsError(error)
it("AU5: A DPoP proof whose replay marker already exists is refused as an invalid credential, and any other replay-store failure is an internal error, never a refusal", () => {
  const storeFailure = (tag: "AlreadyExists" | "PermissionDenied") =>
    new ServerSecretStore.SecretStorePersistError({
      resource: "DPoP proof",
      cause: PlatformError.systemError({
        _tag: tag,
        module: "FileSystem",
        method: "open",
        pathOrDescriptor: "dpop-proof.bin",
      }),
    });

  expect(mapDpopReplayStoreError(storeFailure("AlreadyExists"))._tag).toBe(
    "ServerAuthInvalidCredentialError",
  );
  expect(mapDpopReplayStoreError(storeFailure("PermissionDenied"))._tag).toBe(
    "ServerAuthDpopReplayStateRecordError",
  );
});

// witness: apps/server/src/auth/sessionLifetime.ts | (change) => change.type === "clientRemoved" && change.sessionId === input.sessionId, → (change) => change.type === "clientRemoved",
it.effect(
  "AU6: A live connection's session ends as expired when its own deadline passes and as revoked when its own session is removed, never for another session's removal, and a session with no deadline is never ended by the clock",
  () =>
    Effect.gen(function* () {
      const sessionId = AuthSessionId.make("session-under-test");
      const watch = (
        expiresAt: DateTime.DateTime | undefined,
        changes: Stream.Stream<SessionCredentialChange>,
      ) =>
        Effect.forkChild(awaitSessionEnd({ sessionId, expiresAt, changes }), {
          startImmediately: true,
        });

      // Each clock-driven row starts its own clock at zero, as each old case did.
      yield* Effect.gen(function* () {
        const outcome = yield* watch(DateTime.makeUnsafe(900_000), Stream.never);
        yield* TestClock.adjust("14 minutes");
        expect(outcome.pollUnsafe()).toBeUndefined();
        yield* TestClock.adjust("2 minutes");
        expect(yield* Fiber.join(outcome)).toBe("expired");
      }).pipe(Effect.provide(TestClock.layer()));

      const revoked = yield* watch(
        DateTime.makeUnsafe(4_000_000_000_000),
        Stream.succeed<SessionCredentialChange>({ type: "clientRemoved", sessionId }),
      );
      expect(yield* Fiber.join(revoked)).toBe("revoked");

      yield* Effect.gen(function* () {
        const consumed = yield* Deferred.make<void>();
        const outcome = yield* watch(
          DateTime.makeUnsafe(900_000),
          Stream.concat(
            Stream.succeed<SessionCredentialChange>({
              type: "clientRemoved",
              sessionId: AuthSessionId.make("someone-elses-session"),
            }),
            Stream.fromEffect(
              Deferred.succeed(consumed, undefined).pipe(Effect.andThen(Effect.never)),
            ),
          ),
        );
        yield* Effect.raceFirst(Deferred.await(consumed), Fiber.await(outcome));
        yield* TestClock.adjust("1 minute");
        expect(outcome.pollUnsafe()).toBeUndefined();
      }).pipe(Effect.provide(TestClock.layer()));

      yield* Effect.gen(function* () {
        const outcome = yield* watch(undefined, Stream.never);
        yield* TestClock.adjust("30 days");
        expect(outcome.pollUnsafe()).toBeUndefined();
      }).pipe(Effect.provide(TestClock.layer()));
    }),
);

// witness: apps/server/src/auth/replayMarkers.ts | name.endsWith(".bin") && REPLAY_MARKER_PREFIXES.some((prefix) => name.startsWith(prefix)), → REPLAY_MARKER_PREFIXES.some((prefix) => name.startsWith(prefix)),
it.effect(
  "AU7: The replay sweep deletes only replay markers older than a day, never another secret, a marker exactly a day old, or a pending write's temporary file",
  () =>
    Effect.gen(function* () {
      // Every secret name the server stores today. The last two stand for names
      // built from an id at runtime.
      const realSecretNames = [
        "server-signing-key",
        "asset-access-signing-key",
        "cloud-cli-oauth-token",
        "cloud-cli-desired-link",
        "cloud-link-ed25519-key-pair",
        "cloud-link-ed25519-private-key",
        "cloud-link-ed25519-public-key",
        "cloud-mint-ed25519-public-key",
        "cloud-endpoint-runtime-config",
        "cloud-endpoint-confirmed-origin",
        "cloud-linked-user-id",
        "cloud-relay-url",
        "cloud-relay-issuer",
        "cloud-relay-environment-credential",
        "cloud-publish-agent-activity",
        "provider-env-Y29kZXg-T1BFTkFJX0FQSV9LRVk",
        "usage-limit-source-aHVi",
      ];
      const secretStore = yield* ServerSecretStore.ServerSecretStore;
      const { secretsDir } = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const now = DateTime.makeUnsafe("2026-01-01T00:00:00Z");
      const setAge = (fileName: string, age: Duration.Duration) => {
        const mtime = DateTime.toDateUtc(DateTime.subtractDuration(now, age));
        return fileSystem.utimes(path.join(secretsDir, fileName), mtime, mtime);
      };
      const writeAged = (name: string, age: Duration.Duration) =>
        secretStore
          .create(name, Uint8Array.from([1]))
          .pipe(Effect.andThen(setAge(`${name}.bin`, age)));

      const justExpired = Duration.sum(REPLAY_MARKER_MAX_AGE, Duration.seconds(1));
      for (const name of [
        "dpop-proof-old",
        "cloud-mint-jti-old",
        "cloud-mint-nonce-old",
        "cloud-health-jti-old",
        "cloud-health-nonce-old",
      ]) {
        yield* writeAged(name, justExpired);
      }
      yield* writeAged("dpop-proof-at-max-age", REPLAY_MARKER_MAX_AGE);
      for (const name of realSecretNames) yield* writeAged(name, Duration.days(30));
      const pendingSetFile = "dpop-proof-pending.bin.0000.tmp";
      yield* fileSystem.writeFile(path.join(secretsDir, pendingSetFile), Uint8Array.from([1]));
      yield* setAge(pendingSetFile, Duration.days(30));
      yield* TestClock.setTime(DateTime.toEpochMillis(now));

      yield* pruneExpiredReplayMarkers();

      const remaining = yield* fileSystem.readDirectory(secretsDir);
      expect(remaining.toSorted()).toEqual(
        [
          ...realSecretNames.map((name) => `${name}.bin`),
          "dpop-proof-at-max-age.bin",
          pendingSetFile,
        ].toSorted(),
      );
    }).pipe(
      Effect.provide(
        ServerSecretStore.layer.pipe(
          Layer.provideMerge(
            ServerConfig.layerTest(process.cwd(), { prefix: "t3-replay-markers-test-" }),
          ),
          Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
        ),
      ),
    ),
);

// witness: apps/server/src/auth/ServerSecretStore.ts | yield* fileSystem.chmod(serverConfig.secretsDir, 0o700).pipe( → yield* fileSystem.chmod(serverConfig.secretsDir, 0o755).pipe(
it.effect(
  "AU8: The server's secrets directory is readable by its own user only (0700) and each secret file too (0600)",
  () =>
    Effect.gen(function* () {
      const chmodCalls: Array<{ readonly path: string; readonly mode: number }> = [];
      const recordingFileSystemLayer = Layer.effect(
        FileSystem.FileSystem,
        Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem;

          return {
            ...fileSystem,
            makeDirectory: () => Effect.void,
            writeFile: () => Effect.void,
            rename: () => Effect.void,
            chmod: (path, mode) =>
              Effect.sync(() => {
                chmodCalls.push({ path: String(path), mode });
              }),
          } satisfies FileSystem.FileSystem;
        }),
      ).pipe(Layer.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)));

      const secretStore = yield* Effect.service(ServerSecretStore.ServerSecretStore).pipe(
        Effect.provide(
          ServerSecretStore.layer.pipe(
            Layer.provide(
              ServerConfig.layerTest(process.cwd(), { prefix: "t3-secret-store-test-" }),
            ),
            Layer.provideMerge(recordingFileSystemLayer),
          ),
        ),
      );

      yield* secretStore.set("session-signing-key", Uint8Array.from([1, 2, 3]));

      expect(
        chmodCalls.some((call) => call.mode === 0o700 && /[\\/]secrets$/.test(call.path)),
      ).toBe(true);
      expect(chmodCalls.filter((call) => call.mode === 0o600).length).toBeGreaterThanOrEqual(2);
    }).pipe(Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))),
);

// Both creators of one secret read it missing before either writes it.
const ConcurrentReadMissFileSystemLayer = Layer.effect(
  FileSystem.FileSystem,
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const readCountRef = yield* Ref.make(0);
    const readBarrier = yield* Deferred.make<void>();

    return {
      ...fileSystem,
      readFile: (path) =>
        /[\\/]session-signing-key\.bin$/.test(String(path))
          ? Ref.updateAndGet(readCountRef, (count) => count + 1).pipe(
              Effect.flatMap((count) => {
                if (count > 2) {
                  return fileSystem.readFile(path);
                }
                return Effect.gen(function* () {
                  if (count === 2) {
                    yield* Deferred.succeed(readBarrier, void 0);
                  }
                  yield* Deferred.await(readBarrier);
                  return yield* Effect.failCause(
                    Cause.fail(
                      PlatformError.systemError({
                        _tag: "NotFound",
                        module: "FileSystem",
                        method: "readFile",
                        pathOrDescriptor: String(path),
                        description: "Secret file does not exist yet.",
                      }),
                    ),
                  );
                });
              }),
            )
          : fileSystem.readFile(path),
    } satisfies FileSystem.FileSystem;
  }),
).pipe(Layer.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)));

// witness: apps/server/src/auth/ServerSecretStore.ts | Effect.andThen(fileSystem.link(tempPath, secretPath)), → Effect.andThen(fileSystem.rename(tempPath, secretPath)),
it.effect(
  "AU9: Two creators racing for one missing secret both get the one value that was persisted",
  () =>
    Effect.gen(function* () {
      const secretStore = yield* ServerSecretStore.ServerSecretStore;

      const [first, second] = yield* Effect.all(
        [
          secretStore.getOrCreateRandom("session-signing-key", 32),
          secretStore.getOrCreateRandom("session-signing-key", 32),
        ],
        { concurrency: "unbounded" },
      );
      const persistedBytes = Option.getOrThrow(yield* secretStore.get("session-signing-key"));

      expect(Array.from(first)).toEqual(Array.from(persistedBytes));
      expect(Array.from(second)).toEqual(Array.from(persistedBytes));
    }).pipe(
      Effect.provide(
        ServerSecretStore.layer.pipe(
          Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-secret-store-test-" })),
          Layer.provideMerge(ConcurrentReadMissFileSystemLayer),
          Layer.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
        ),
      ),
    ),
);

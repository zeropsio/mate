import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Semaphore from "effect/Semaphore";

import { ServerConfig } from "../config.ts";
import { fingerprintOf } from "./ZeropsGitCredentialFile.ts";

export class ZeropsObserveCredentialFile extends Context.Service<
  ZeropsObserveCredentialFile,
  {
    /** True only after the complete file was replaced or removed. No secret leaves this service. */
    readonly write: (credential: string | null) => Effect.Effect<boolean>;
    /** What the credential held is, without its secret (`fingerprintOf`); none while the file is missing or unreadable. */
    readonly fingerprint: Effect.Effect<Option.Option<string>>;
  }
>()("t3/zerops/ZeropsObserveCredentialFile") {}

/** One writer for zcp's fixed profile credential, independent of provider and browser lifetimes. */
export const makeObserveCredentialFile = (at: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const writes = yield* Semaphore.make(1);
    const directory = path.dirname(at);
    const staged = path.join(directory, `.${path.basename(at)}.next`);
    const keep = (credential: string) =>
      Effect.gen(function* () {
        yield* fs.makeDirectory(directory, { recursive: true, mode: 0o700 });
        yield* fs.chmod(directory, 0o700);
        yield* fs.remove(staged, { force: true });
        yield* fs.writeFileString(staged, credential, { mode: 0o600 });
        yield* fs.chmod(staged, 0o600);
        yield* fs.rename(staged, at);
      }).pipe(Effect.onError(() => fs.remove(staged, { force: true }).pipe(Effect.ignore)));
    return ZeropsObserveCredentialFile.of({
      write: (credential) =>
        writes.withPermits(1)(
          // An interrupted old link must finish its filesystem operation before the next one starts.
          Effect.uninterruptible(
            (credential === null ? fs.remove(at, { force: true }) : keep(credential)).pipe(
              Effect.as(true),
              Effect.catch((error) =>
                Effect.logWarning("zerops observe credential: file update failed", {
                  reason: error.reason._tag,
                }).pipe(Effect.as(false)),
              ),
            ),
          ),
        ),
      fingerprint: fs.readFileString(at).pipe(
        Effect.map((credential) => Option.some(fingerprintOf(credential))),
        Effect.orElseSucceed(Option.none),
      ),
    });
  });

/** Outside a Zerops container there is no credential destination and every delivery is refused. */
export const layer = Layer.effect(
  ZeropsObserveCredentialFile,
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const path = yield* Path.Path;
    return config.zerops === undefined
      ? ZeropsObserveCredentialFile.of({
          write: () => Effect.succeed(false),
          fingerprint: Effect.succeed(Option.none()),
        })
      : yield* makeObserveCredentialFile(
          path.join(config.homeDir, ".zcp", "hq", "observe-credential"),
        );
  }),
);

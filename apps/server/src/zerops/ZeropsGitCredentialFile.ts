/**
 * ZeropsGitCredentialFile — the Mate's Git credential, kept where zcp reads it (spec-mate §3.3,
 * C-7).
 *
 * HQ sends the credential down the Mate's link (`git-credential`, `ZeropsHqLink`); this keeps it
 * in the one file `T3CODE_ZEROPS_HQ_GIT_CREDENTIAL` names, readable by the server's own user only,
 * written whole in a single rename so zcp's repository pass never reads half a value. HQ's `null`
 * (revoked) removes the file. Nothing else writes it, and the credential is never logged.
 *
 * @module ZeropsGitCredentialFile
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import { ServerConfig } from "../config.ts";

export class ZeropsGitCredentialFile extends Context.Service<
  ZeropsGitCredentialFile,
  {
    /** Keeps HQ's credential, or removes the file on HQ's `null`. */
    readonly write: (credential: string | null) => Effect.Effect<void>;
    /** Whether the file holds a credential now. */
    readonly held: Effect.Effect<boolean>;
  }
>()("t3/zerops/ZeropsGitCredentialFile") {}

const OWNER_ONLY = 0o600;

/**
 * The file at `at`. A write that fails is logged without the value and leaves the last file as it
 * was: HQ sends the credential again on the next link.
 */
export const makeGitCredentialFile = (at: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const staged = path.join(path.dirname(at), `.${path.basename(at)}.next`);
    const keep = (credential: string) =>
      Effect.gen(function* () {
        yield* fs.makeDirectory(path.dirname(at), { recursive: true });
        yield* fs.remove(staged, { force: true });
        yield* fs.writeFileString(staged, credential, { mode: OWNER_ONLY });
        yield* fs.chmod(staged, OWNER_ONLY);
        yield* fs.rename(staged, at);
      });
    return ZeropsGitCredentialFile.of({
      write: (credential) =>
        (credential === null ? fs.remove(at, { force: true }) : keep(credential)).pipe(
          Effect.catch((error) =>
            Effect.logWarning("zerops git credential: the file was not written", {
              path: at,
              reason: error.reason._tag,
            }),
          ),
        ),
      held: fs.exists(at).pipe(Effect.orElseSucceed(() => false)),
    });
  });

/** The file zcp names (`ZeropsEnvironment.hqGitCredentialPath`); where it names none, nothing is kept. */
export const layer = Layer.effect(
  ZeropsGitCredentialFile,
  Effect.gen(function* () {
    const at = (yield* ServerConfig).zerops?.hqGitCredentialPath;
    return at === undefined
      ? ZeropsGitCredentialFile.of({ write: () => Effect.void, held: Effect.succeed(false) })
      : yield* makeGitCredentialFile(at);
  }),
);

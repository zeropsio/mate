// @effect-diagnostics nodeBuiltinImport:off -- the fingerprint is a SHA-256 digest.
/**
 * ZeropsGitCredentialFile — the Mate's Git credential, kept where zcp reads it (spec-mate §3.3,
 * C-7).
 *
 * HQ sends the credential down the Mate's link (`git-credential`, `ZeropsHqLink`); this keeps it
 * in the one file `ZeropsEnvironment.hqGitCredentialPath` names, readable by the server's own user only,
 * written whole in a single rename so zcp's repository pass never reads half a value. HQ's `null`
 * (revoked) removes the file. Nothing else writes it, and the credential is never logged. The
 * link's `hello` reports its fingerprint, so HQ can tell a Mate that holds its live credential
 * from one that lost it.
 *
 * @module ZeropsGitCredentialFile
 */
import * as NodeCrypto from "node:crypto";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import { ServerConfig } from "../config.ts";

export class ZeropsGitCredentialFile extends Context.Service<
  ZeropsGitCredentialFile,
  {
    /** Keeps HQ's credential, or removes the file on HQ's `null`. */
    readonly write: (credential: string | null) => Effect.Effect<void>;
    /** Whether the file holds a credential now. */
    readonly held: Effect.Effect<boolean>;
    /** What the credential held is, without its secret (`fingerprintOf`); none while there is none. */
    readonly fingerprint: Effect.Effect<Option.Option<string>>;
  }
>()("t3/zerops/ZeropsGitCredentialFile") {}

const OWNER_ONLY = 0o600;

const sha256 = (value: string) => NodeCrypto.createHash("sha256").update(value).digest("hex");

/** The digest of the credential's digest: HQ stores the first and compares this one (`spec/protocol.md`, _Mate Git credential_). */
const fingerprintOf = (credential: string) => sha256(sha256(credential));

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
      fingerprint: fs.readFileString(at).pipe(
        Effect.map((credential) => Option.some(fingerprintOf(credential))),
        Effect.orElseSucceed(Option.none),
      ),
    });
  });

/** The file `ZeropsEnvironment.hqGitCredentialPath` names; outside a Zerops container (and in a test that names none), nothing is kept. */
export const layer = Layer.effect(
  ZeropsGitCredentialFile,
  Effect.gen(function* () {
    const at = (yield* ServerConfig).zerops?.hqGitCredentialPath;
    return at === undefined
      ? ZeropsGitCredentialFile.of({
          write: () => Effect.void,
          held: Effect.succeed(false),
          fingerprint: Effect.succeed(Option.none()),
        })
      : yield* makeGitCredentialFile(at);
  }),
);

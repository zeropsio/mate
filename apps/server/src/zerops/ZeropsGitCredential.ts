// @effect-diagnostics nodeBuiltinImport:off -- the fingerprint is a SHA-256 digest.
/**
 * ZeropsGitCredential — the Mate's Git credential, held in the server's memory only.
 *
 * HQ sends the credential down the Mate's link (`git-credential`, `ZeropsHqLink`); this holds it
 * in the server process and nowhere else: no file, so the agent's shell, which runs as the
 * server's user, has nothing to read. HQ's `null` (revoked) drops it. Nothing else writes it, and
 * the credential is never logged. The link's `hello` reports its fingerprint, so HQ can tell a
 * Mate that holds its live credential from one that lost it; after a restart it holds none and HQ
 * sends a new one on that link (`spec/protocol.md`, _Mate Git credential_).
 *
 * @module ZeropsGitCredential
 */
import * as NodeCrypto from "node:crypto";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";

export class ZeropsGitCredential extends Context.Service<
  ZeropsGitCredential,
  {
    /** Holds HQ's credential in place of the last one, or drops it on HQ's `null`. */
    readonly write: (credential: string | null) => Effect.Effect<void>;
    /** Whether a credential is held now. */
    readonly held: Effect.Effect<boolean>;
    /** What the credential held is, without its secret (`fingerprintOf`); none while there is none. */
    readonly fingerprint: Effect.Effect<Option.Option<string>>;
  }
>()("t3/zerops/ZeropsGitCredential") {}

const sha256 = (value: string) => NodeCrypto.createHash("sha256").update(value).digest("hex");

/** The digest of the credential's digest: HQ stores the first and compares this one (`spec/protocol.md`, _Mate Git credential_). */
export const fingerprintOf = (credential: string) => sha256(sha256(credential));

/** A keeper that starts empty. */
export const makeGitCredential = Effect.gen(function* () {
  const held = yield* Ref.make(Option.none<string>());
  return ZeropsGitCredential.of({
    write: (credential) => Ref.set(held, Option.fromNullOr(credential)),
    held: Ref.get(held).pipe(Effect.map(Option.isSome)),
    fingerprint: Ref.get(held).pipe(Effect.map(Option.map(fingerprintOf))),
  });
});

export const layer = Layer.effect(ZeropsGitCredential, makeGitCredential);

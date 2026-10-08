// @effect-diagnostics nodeBuiltinImport:off -- AES-256-GCM and HMAC are the system's.
/**
 * HQ's key for its environments' deploy tokens (audit D4): `HQ_KEY_SECRET`, 32 random bytes in
 * base64, kept in HQ's own service env — outside the database and every backup set.
 *
 * @module deployKeys
 */
import * as NodeCrypto from "node:crypto";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as SqlClient from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";

/** `HQ_KEY_SECRET`'s length in bytes: an AES-256 key. */
const KEY_BYTES = 32;

/** The way a token is sealed: AES-256-GCM, a 12-byte nonce, the project's id as its data. */
const SCHEME = "v1";
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

/**
 * HQ's key as its env gives it: none, one that is no key, or the key with its id — the scheme and
 * an HMAC of the key, no part of it — which every token sealed under it carries.
 */
export type KeySecret =
  | { readonly state: "no_secret" }
  | { readonly state: "bad_secret" }
  | KeySecretOk;

export interface KeySecretOk {
  readonly state: "ok";
  readonly id: string;
  readonly key: Redacted.Redacted<Buffer>;
}

/** A deploy token as its row keeps it: the key's id, and the nonce, ciphertext and tag. */
export interface Sealed {
  readonly keyId: string;
  readonly sealed: Uint8Array;
}

/** `HQ_KEY_SECRET`, read: 32 bytes in base64 with its padding, or no key. */
export const keySecretOf = (raw: Option.Option<Redacted.Redacted>): KeySecret => {
  const text = Option.match(raw, {
    onNone: () => "",
    onSome: (secret) => Redacted.value(secret).trim(),
  });
  if (text === "") return { state: "no_secret" };
  const key = Buffer.from(text, "base64");
  // Node reads past what is no base64; only the canonical spelling of 32 bytes is a key.
  if (key.length !== KEY_BYTES || key.toString("base64") !== text) return { state: "bad_secret" };
  const id = NodeCrypto.createHmac("sha256", key).update("hq deploy key id").digest("hex");
  return { state: "ok", id: `${SCHEME}-${id.slice(0, 16)}`, key: Redacted.make(key) };
};

/** What binds a sealed token to its row: a token copied onto another row does not open there. */
const rowOf = (projectId: string) => Buffer.from(`hq_deploy_token:${projectId}`, "utf8");

/** `token`, sealed under `secret` for the environment of `projectId`. */
export const sealToken = (
  secret: KeySecretOk,
  projectId: string,
  token: Redacted.Redacted,
): Sealed => {
  const nonce = NodeCrypto.randomBytes(NONCE_BYTES);
  const cipher = NodeCrypto.createCipheriv("aes-256-gcm", Redacted.value(secret.key), nonce);
  cipher.setAAD(rowOf(projectId));
  const body = Buffer.concat([cipher.update(Redacted.value(token), "utf8"), cipher.final()]);
  return { keyId: secret.id, sealed: Buffer.concat([nonce, body, cipher.getAuthTag()]) };
};

/**
 * The token `sealed` holds for the environment of `projectId`, opened under `secret`; none where it
 * was sealed under another key, for another row, or was changed since.
 */
export const openToken = (
  secret: KeySecretOk,
  projectId: string,
  sealed: Sealed,
): Redacted.Redacted | undefined => {
  const bytes = Buffer.from(sealed.sealed);
  if (sealed.keyId !== secret.id || bytes.length < NONCE_BYTES + TAG_BYTES) return undefined;
  const decipher = NodeCrypto.createDecipheriv(
    "aes-256-gcm",
    Redacted.value(secret.key),
    bytes.subarray(0, NONCE_BYTES),
  );
  decipher.setAAD(rowOf(projectId));
  decipher.setAuthTag(bytes.subarray(bytes.length - TAG_BYTES));
  try {
    const body = bytes.subarray(NONCE_BYTES, bytes.length - TAG_BYTES);
    return Redacted.make(Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8"));
  } catch {
    return undefined;
  }
};

/**
 * The pass over the tokens kept before they were sealed (`0028_sealed_deploy_tokens.sql`), run by
 * the leading Core at its start under the lead's lock (`leader.ts`): each plain one sealed under
 * `secret`, in one transaction, their count logged — never a value. Without a key, they are left
 * plain and counted; the next start with one seals them.
 */
export const sealPlainTokens = (secret: KeySecret) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql.withTransaction(
      Effect.gen(function* () {
        const plain = yield* sql<{ readonly project_id: string; readonly sealed: Uint8Array }>`
          SELECT project_id, sealed FROM hq_deploy_token WHERE key_id IS NULL FOR UPDATE`;
        if (plain.length === 0) return;
        if (secret.state !== "ok") {
          return yield* Effect.logWarning("deploy tokens left plain: HQ has no key to seal them", {
            count: plain.length,
            keys: secret.state,
          });
        }
        for (const row of plain) {
          const token = Redacted.make(Buffer.from(row.sealed).toString("utf8"));
          const { keyId, sealed } = sealToken(secret, row.project_id, token);
          yield* sql`
            UPDATE hq_deploy_token SET key_id = ${keyId}, sealed = ${sealed}
            WHERE project_id = ${row.project_id}`;
        }
        yield* Effect.logInfo("deploy tokens sealed", { count: plain.length });
      }),
    );
  });

/**
 * Where HQ's key stands, for `/health`: none, one that is no key, the key, or the key and a token
 * it does not open — sealed under another key, as after a restore onto an HQ with another one.
 */
export type KeysStatus = KeySecret["state"] | "other_secret";

export class DeployKeys extends Context.Service<
  DeployKeys,
  {
    /** The key as HQ's env gives it. */
    readonly state: KeySecret["state"];
    readonly status: Effect.Effect<KeysStatus, SqlError>;
    /** `token`, sealed for the environment of `projectId`; none without a key. */
    readonly seal: (projectId: string, token: Redacted.Redacted) => Sealed | undefined;
    /** The token `sealed` holds; none without a key, or where it does not open under it. */
    readonly open: (projectId: string, sealed: Sealed) => Redacted.Redacted | undefined;
  }
>()("@t3tools/hq/deployKeys") {}

export const deployKeysLayer = (
  secret: KeySecret,
): Layer.Layer<DeployKeys, never, SqlClient.SqlClient> =>
  Layer.effect(
    DeployKeys,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return DeployKeys.of(
        secret.state === "ok"
          ? {
              state: "ok",
              status: Effect.map(
                sql<{ readonly other: boolean }>`
                  SELECT EXISTS (
                    SELECT 1 FROM hq_deploy_token WHERE key_id IS DISTINCT FROM ${secret.id}
                  ) AS other`,
                ([row]) => (row?.other === true ? "other_secret" : "ok"),
              ),
              seal: (projectId, token) => sealToken(secret, projectId, token),
              open: (projectId, sealed) => openToken(secret, projectId, sealed),
            }
          : {
              state: secret.state,
              status: Effect.succeed(secret.state),
              seal: () => undefined,
              open: () => undefined,
            },
      );
    }),
  );

/**
 * HQ's key in the tests: fixed fake values of `HQ_KEY_SECRET`, never a real one, and deploy tokens
 * sealed under them as their rows keep them.
 *
 * @module test/harness/deployKeys
 */
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";

import { type KeySecretOk, type Sealed, keySecretOf, sealToken } from "../../src/deployKeys.ts";

/** Bytes 0…31, base64: the key every test Core has unless it is given another or none. */
export const TEST_KEY_SECRET = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=";

/** Bytes 255…224, base64: another HQ's key. */
export const OTHER_KEY_SECRET = "//79/Pv6+fj39vX08/Lx8O/u7ezr6uno5+bl5OPi4eA=";

/** The key `raw` gives; the test fails where it gives none. */
export const testKey = (raw = TEST_KEY_SECRET): KeySecretOk => {
  const secret = keySecretOf(Option.some(Redacted.make(raw)));
  if (secret.state !== "ok") throw new Error(`no key: ${secret.state}`);
  return secret;
};

/** `value`, sealed for the environment of `projectId` under the key `raw` gives. */
export const sealedFor = (projectId: string, value: string, raw = TEST_KEY_SECRET): Sealed =>
  sealToken(testKey(raw), projectId, Redacted.make(value));

/** A sealed token as the values of its row's `key_id` and `sealed`, in SQL. */
export const sealedSql = ({ keyId, sealed }: Sealed) =>
  `'${keyId}', '\\x${Buffer.from(sealed).toString("hex")}'::bytea`;

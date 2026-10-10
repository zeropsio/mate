/**
 * A value the agent asks the person for, read off zcp's answer to `zerops_env action=request`:
 * the key, the vault it goes to, plain or sensitive, and one line of why. zcp writes nothing and
 * answers at once; the engine opens the ask on that call and the person answers it on a card,
 * their value going from their client to the vault — never through this answer, which holds none.
 *
 * @module engine/pump/vaultAsk
 */
import type { ItemBody, RequestAsk } from "@t3tools/contracts";

/** zcp's tool that asks (`action=request`). */
export const VAULT_REQUEST_TOOL = "zerops_env";

/** A name the vault stores a value under (zcp's `ops.ValidateEnvKey`). */
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/u;
/** The longest reason a card shows (zcp refuses longer). */
const REASON_MAX = 280;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The ask a closed call made of the person; `null` for every other call, or a malformed answer. */
export function vaultAskOfCall(body: ItemBody): Extract<RequestAsk, { kind: "vault" }> | null {
  if (body.kind !== "call" || body.state !== "done") return null;
  const result = body.result;
  if (result?.toolName !== VAULT_REQUEST_TOOL || result.resultText === undefined) return null;
  let answer: unknown;
  try {
    answer = JSON.parse(result.resultText);
  } catch {
    return null;
  }
  const requested = isRecord(answer) ? answer.requested : undefined;
  if (!isRecord(requested)) return null;
  const { key, scope, serviceHostname, sensitive, reason } = requested;
  if (typeof key !== "string" || !ENV_KEY.test(key) || typeof sensitive !== "boolean") return null;
  const vault =
    scope === "shared"
      ? ({ kind: "shared" } as const)
      : scope === "service" && typeof serviceHostname === "string" && serviceHostname !== ""
        ? ({ kind: "service", hostname: serviceHostname } as const)
        : null;
  if (vault === null) return null;
  const why = typeof reason === "string" ? reason.trim().slice(0, REASON_MAX) : "";
  return { kind: "vault", key, scope: vault, sensitive, reason: why === "" ? null : why };
}

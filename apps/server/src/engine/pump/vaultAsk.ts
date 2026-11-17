/**
 * A value the agent asks the person for, read off zcp's answer to `zerops_env action=request`:
 * the key, what it is in people's words, the vault it goes to, plain or sensitive, and one line of
 * why. zcp writes nothing and
 * answers at once; the engine opens the ask on that call and the person answers it on a card,
 * their value going from their client to the vault — never through this answer, which holds none.
 * zcp's answer to `action=set` names the keys the agent stored and their vault: an open ask for
 * one of them has nothing left for the person to give.
 *
 * @module engine/pump/vaultAsk
 */
import type { ItemBody, RequestAsk } from "@t3tools/contracts";

/** zcp's tool that asks (`action=request`). */
export const VAULT_REQUEST_TOOL = "zerops_env";
/**
 * zcp's tool that asks for a secret in the application's stage or production (`secret=true`): its
 * answer is the same `requested`, naming the environment and the services the card restarts.
 */
export const ENVIRONMENT_SECRET_TOOL = "zerops_propose_env";

/** A name the vault stores a value under (zcp's `ops.ValidateEnvKey`). */
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/u;
/** The longest why and label a person is shown (zcp refuses longer). */
const REASON_MAX = 280;
const LABEL_MAX = 80;
/** A preprocessor directive zcp allows for a generated secret (`SecretGenerate`), and no more. */
const GENERATE = /^<@generateRandom(String\(<\d{1,4}>\)|Int\(<-?\d{1,19}>, <-?\d{1,19}>\))>$/u;

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

type VaultScope = Extract<RequestAsk, { kind: "vault" }>["scope"];
type VaultEnvironment = NonNullable<Extract<RequestAsk, { kind: "vault" }>["environment"]>;
type VaultRestart = NonNullable<Extract<RequestAsk, { kind: "vault" }>["restart"]>;

/** zcp's answer to a closed call of `tool`; `null` for every other call, or one that is not JSON. */
export function zcpAnswerOfCall(body: ItemBody, tool: string): Record<string, unknown> | null {
  if (body.kind !== "call" || body.state !== "done") return null;
  const result = body.result;
  if (result?.toolName !== tool || result.resultText === undefined) return null;
  try {
    const answer: unknown = JSON.parse(result.resultText);
    return isRecord(answer) ? answer : null;
  } catch {
    return null;
  }
}

/** The vault an answer names: Shared, or one service's own by its hostname; `null` for none. */
const vaultOf = (scope: unknown, serviceHostname: unknown): VaultScope | null =>
  scope === "shared"
    ? { kind: "shared" }
    : scope === "service" && typeof serviceHostname === "string" && serviceHostname !== ""
      ? { kind: "service", hostname: serviceHostname }
      : null;

/** The stage or production an answer names; `null` for none or one it cannot place. */
const environmentOf = (value: unknown): VaultEnvironment | null => {
  if (!isRecord(value)) return null;
  const { kind, projectId, name } = value;
  return (kind === "stage" || kind === "production") &&
    typeof projectId === "string" &&
    projectId !== "" &&
    typeof name === "string" &&
    name !== ""
    ? { kind, projectId, name }
    : null;
};

/** The services an answer names to restart, each whole. */
const restartOf = (value: unknown): VaultRestart =>
  Array.isArray(value)
    ? value.flatMap((service: unknown) =>
        isRecord(service) &&
        typeof service.serviceId === "string" &&
        service.serviceId !== "" &&
        typeof service.hostname === "string" &&
        service.hostname !== ""
          ? [{ serviceId: service.serviceId, hostname: service.hostname }]
          : [],
      )
    : [];

/** The ask a closed call made of the person; `null` for every other call, or a malformed answer. */
export function vaultAskOfCall(body: ItemBody): Extract<RequestAsk, { kind: "vault" }> | null {
  const own = zcpAnswerOfCall(body, VAULT_REQUEST_TOOL)?.requested;
  const elsewhere = own === undefined ? zcpAnswerOfCall(body, ENVIRONMENT_SECRET_TOOL) : null;
  const requested = own ?? elsewhere?.requested;
  if (!isRecord(requested)) return null;
  // A secret for stage or production goes nowhere without the environment it names.
  const environment = elsewhere === null ? null : environmentOf(requested.environment);
  if (elsewhere !== null && environment === null) return null;
  const restart = environment === null ? [] : restartOf(requested.restart);
  // A random secret's recipe, as zcp allowed it: the card reads it, and makes the value itself.
  const generate =
    environment !== null &&
    typeof requested.generate === "string" &&
    GENERATE.test(requested.generate)
      ? requested.generate
      : null;
  const { key, scope, serviceHostname, sensitive, label } = requested;
  // `why`, from a zcp that names the value; `reason`, from one before it.
  const reason = requested.why ?? requested.reason;
  if (typeof key !== "string" || !ENV_KEY.test(key) || typeof sensitive !== "boolean") return null;
  const vault = vaultOf(scope, serviceHostname);
  if (vault === null) return null;
  const why = typeof reason === "string" ? reason.trim().slice(0, REASON_MAX) : "";
  const named = typeof label === "string" ? label.trim().slice(0, LABEL_MAX) : "";
  return {
    kind: "vault",
    key,
    scope: vault,
    sensitive,
    reason: why === "" ? null : why,
    ...(named === "" ? {} : { label: named }),
    ...(environment === null ? {} : { environment }),
    ...(restart.length === 0 ? {} : { restart }),
    ...(generate === null ? {} : { generate }),
  };
}

/**
 * The keys a closed call stored and the vault they went to; `null` for every other call. An answer
 * that names no vault (a zcp before it did) stored nothing an ask can be matched to.
 */
export function vaultStoredOfCall(
  body: ItemBody,
): { readonly keys: ReadonlyArray<string>; readonly scope: VaultScope } | null {
  const answer = zcpAnswerOfCall(body, VAULT_REQUEST_TOOL);
  if (answer === null || answer.requested !== undefined || !Array.isArray(answer.stored)) {
    return null;
  }
  const scope = vaultOf(answer.scope, answer.serviceHostname);
  // Only the keys: the answer's values (masked or not) never leave it.
  const keys = answer.stored.flatMap((stored: unknown) =>
    isRecord(stored) && typeof stored.key === "string" && ENV_KEY.test(stored.key)
      ? [stored.key]
      : [],
  );
  return scope === null || keys.length === 0 ? null : { keys, scope };
}

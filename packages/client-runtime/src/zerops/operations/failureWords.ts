/**
 * A deploy's failure in the person's words, from zcp's classification of it
 * (`internal/ops/deploy_failure.go`, its categories in
 * `internal/topology/failure_class.go`): what failed and what that meant,
 * never the platform's terms. zcp's `likelyCause` is written for the agent,
 * which still reads it in the tool result unchanged; the specific line — a
 * missing module, an exit code — is the log's.
 */

export interface DeployFailureClassification {
  readonly category?: string | undefined;
  readonly signals?: ReadonlyArray<string> | undefined;
}

const DEPLOY_FAILED = "The deploy failed.";

const CATEGORY_WORDS: Readonly<Record<string, string>> = {
  build: "Its build failed, so nothing new was deployed.",
  start: "Its start-up command failed, so the new version didn't go live.",
  verify: "It deployed, but its checks didn't pass.",
  network: "The deploy couldn't connect, so it never ran.",
  config: "Its deploy settings were rejected, so it never ran.",
  credential: "A sign-in was refused, so the deploy never ran.",
  other: DEPLOY_FAILED,
};

/** A start that failed while its runtime was prepared, before any start-up command ran. */
const PREPARE_WORDS = "Preparing its runtime failed, so the new version didn't go live.";

/** Undefined where zcp classified nothing: the caller's own line stands. */
export function deployFailureWords(
  classification: DeployFailureClassification | undefined,
): string | undefined {
  if (classification === undefined) return undefined;
  const { category, signals = [] } = classification;
  if (category === "start" && signals.some((signal) => /^(phase:)?prepare\b/u.test(signal))) {
    return PREPARE_WORDS;
  }
  return (category === undefined ? undefined : CATEGORY_WORDS[category]) ?? DEPLOY_FAILED;
}

/** zcp's `failureClassification` off a result document, as the words read it. */
export function readFailureClassification(value: unknown): DeployFailureClassification | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const category = typeof record.category === "string" ? record.category : undefined;
  const signals = Array.isArray(record.signals)
    ? record.signals.filter((signal): signal is string => typeof signal === "string")
    : [];
  return { category, signals };
}

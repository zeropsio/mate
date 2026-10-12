import { admissionRefusalWords, projectLimitError } from "@t3tools/client-runtime/data";
import { mateFailureWords } from "../../zerops/noticeWords";

/**
 * A failure no run of the conversation shows — a send the app refused, a Mate that cannot say its
 * run state — as the quiet row at the conversation's end (S6). A run's own failure is its card's.
 */
export interface ThreadEndNotice {
  readonly words: string;
  /** An expected refusal — a usage limit, a sign-in — said calmly, never as an alert. */
  readonly calm: boolean;
}

export function threadErrorNotice(input: {
  readonly error: string | null;
  readonly mateName?: string | undefined;
  /** The conversation's agent driver (its session's `providerName`): only its own sign-in failure is one. */
  readonly driver?: string | null | undefined;
  /** The timeline already owns this expected pause; say it once. */
  readonly usageLimitShown?: boolean | undefined;
}): ThreadEndNotice | null {
  const { error, driver, mateName } = input;
  if (!error) return null;
  const limit = projectLimitError(error);
  if (limit !== null && input.usageLimitShown === true) return null;
  const refusal = admissionRefusalWords(error, driver, mateName);
  if (refusal !== null) return { words: refusal, calm: true };
  return { words: mateFailureWords(error, driver, mateName), calm: limit !== null };
}

/**
 * What web and mobile read from a broker resource: view models over its
 * `Shown` state, so no consumer outside `cr/zerops` narrows a `Known` to its
 * value (DESIGN §3.6).
 */
import type { Shown } from "../knowledge/index.ts";

/**
 * A one-shot reader's answer: the value the read that settled the resource
 * succeeded with. A failure, a withholding and a value whose revalidation
 * failed answer nothing.
 */
export const settledValue = <T>(shown: Shown<T>): { readonly value: T } | null =>
  shown.state === "known" && shown.freshness.kind === "settled" ? { value: shown.value } : null;

/**
 * One-shot reads of the account's cells, for a caller that asks once and awaits what settles.
 */
import type {
  ZeropsCells,
  ZeropsCellRequest,
  ZeropsCellValue,
} from "@t3tools/client-runtime/zerops/data";
import { settledValue } from "@t3tools/client-runtime/zerops/data";
import * as Effect from "effect/Effect";

/**
 * A one-shot action demand owns its lease until the resource settles, or
 * until `signal` aborts — an unmount abandoning the flow releases the lease
 * immediately instead of holding it until the read finally settles. Rejects
 * unless the read that settled it succeeded: a failure, a withholding, or a
 * value whose revalidation failed.
 */
export function readZeropsCell<Request extends ZeropsCellRequest>(
  cells: ZeropsCells,
  request: Request,
  signal?: AbortSignal,
): Promise<ZeropsCellValue<Request>> {
  return Effect.runPromise(
    Effect.scoped(cells.acquire(request).pipe(Effect.flatMap((lease) => lease.awaitSettled))),
    signal === undefined ? undefined : { signal },
  ).then((shown) => {
    const answer = settledValue(shown);
    if (answer !== null) return answer.value;
    throw new Error(`The ${request.kind} read did not succeed (${shown.state}).`);
  });
}

/** {@link readZeropsCell} for a caller that treats a failed read as no answer. */
export function readZeropsCellOnce<Request extends ZeropsCellRequest>(
  cells: ZeropsCells,
  request: Request,
  signal?: AbortSignal,
): Promise<ZeropsCellValue<Request> | undefined> {
  return readZeropsCell(cells, request, signal).catch(() => undefined);
}

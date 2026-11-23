/**
 * What an Admin's press on a read access request starts at HQ (`useReadAccessRequests`).
 */
import type { HqAccessChange, ReadAccessRequest } from "@t3tools/client-runtime/zerops/hq";

/**
 * A request granted: one access change of kind `readAccess` naming the request, which HQ answers
 * with `READ_ONLY` on its one project for the person who asked, under the change id `id`.
 */
export function readAccessGrantChanges(
  request: ReadAccessRequest,
  id: string,
): ReadonlyArray<{ readonly id: string; readonly change: HqAccessChange }> {
  return [{ id, change: { kind: "readAccess", requestId: request.id } }];
}

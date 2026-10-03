/**
 * A Mate's birth at HQ, as the press writes it: its record — in its application, before its
 * container (F6b) — with whether the person pressing asks for its stand-up, in the one write
 * (audit B3); then, at the press's close-off, that its project is closed off. HQ takes the mark
 * only on a Mate it holds a record of (`mate_not_found` otherwise), so the record comes first —
 * and the mark never rides with it, written before the isolation it marks.
 *
 * @module hqMateBirth
 */
import { HqError, type HqApi } from "@t3tools/client-runtime/zerops/hq";

const refusedAs = (cause: unknown, code: string) =>
  cause instanceof HqError && cause.kind === "refused" && cause.code === code;

/**
 * The close-off marked at HQ, by the press's close-off step. A Mate HQ holds no record of — its
 * attach refused — has nothing to mark: Finish setup, which writes its record first, marks it at
 * its own close-off.
 */
export async function markClosedOffAtHq(api: HqApi, projectId: string): Promise<void> {
  try {
    await api.recordClosedOff(projectId);
  } catch (cause) {
    if (!refusedAs(cause, "mate_not_found")) throw cause;
  }
}

/** A Mate's record in no application (`POST /api/mates`); one HQ holds already stands. */
export async function createMateRecord(
  api: HqApi,
  mate: Parameters<HqApi["createMate"]>[0],
): Promise<void> {
  try {
    await api.createMate(mate);
  } catch (cause) {
    if (!refusedAs(cause, "conflict")) throw cause;
  }
}

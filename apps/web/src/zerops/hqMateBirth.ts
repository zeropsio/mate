/**
 * A Mate's birth at HQ, as the press writes it: its record, who asks for its stand-up — the
 * person pressing — and that its project is closed off. HQ takes a mark only on a Mate it holds
 * a record of (`mate_not_found` otherwise), so the record comes first; the Mate's server stands
 * it up once HQ names who asked, and zcp imports its runtimes once HQ says it is closed off.
 *
 * @module hqMateBirth
 */
import { HqError, type HqApi } from "@t3tools/client-runtime/zerops/hq";

/** What a press records of a Mate's birth after its record. */
export interface MateBirth {
  /** The person pressing asks for its stand-up: a dev Mate with its agent. */
  readonly standUp: boolean;
  /** The press closed its project off before it registered it. */
  readonly closedOff: boolean;
}

/** The ask, then the close-off, as the press made them; each safe to write again. */
export async function recordMateBirth(
  api: HqApi,
  projectId: string,
  birth: MateBirth,
): Promise<void> {
  if (birth.standUp) await api.recordStandUp(projectId);
  if (birth.closedOff) await api.recordClosedOff(projectId);
}

const refusedAs = (cause: unknown, code: string) =>
  cause instanceof HqError && cause.kind === "refused" && cause.code === code;

/**
 * The close-off marked at HQ. A Mate HQ holds no record of yet — its press closes it off before it
 * registers it — is marked with its record, by the registration after.
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

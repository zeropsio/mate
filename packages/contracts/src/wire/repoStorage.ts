/**
 * A repository's Git storage (mate-hq `spec/protocol.md` "Applications, repositories, Git"):
 * `GET`/`PUT /api/apps/:appId/repos/:repo/storage`. Whoever reads the application reads it; an
 * Owner or Admin of the organization sets its cap.
 */
import * as Schema from "effect/Schema";

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

/**
 * The cap in whole GiB, what counts against it and the cap in bytes (`capGiB × 2³⁰`, the home's
 * `about.storage.limitBytes`): HQ's answer to a read and to a set, as the repository stands.
 */
export const HqRepoStorage = Schema.Struct({
  capGiB: Count,
  usedBytes: Count,
  limitBytes: Count,
});
export type HqRepoStorage = typeof HqRepoStorage.Type;

/** A set's body. HQ alone decides the range (1–100, `cap_range` otherwise) and the usage floor. */
export const HqRepoCapRequest = Schema.Struct({ capGiB: Schema.Int });
export type HqRepoCapRequest = typeof HqRepoCapRequest.Type;

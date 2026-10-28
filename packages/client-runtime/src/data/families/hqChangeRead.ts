/**
 * A demanded change read's identity: the change, at the head and main revision it displays, and
 * HQ's judgement of whether it merges as the person is shown it.
 */
import { ChangeDetailQuery, type ChangeLink } from "@t3tools/shared/hqChanges";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type { MergeabilityKind } from "../../zerops/changeMergeability.ts";
export interface ChangeReadRequest {
  readonly link: ChangeLink;
  readonly snapshot?: ChangeDetailQuery;
  /**
   * HQ works a change out after each push or move of `main`, and its record says so only once it
   * has: a record read while HQ still checked is read again once the live change says it judged.
   * Never sent; it only names the read.
   */
  readonly judged?: MergeabilityKind;
}
export const changeReadOwner = (request: ChangeReadRequest): string => JSON.stringify(request);
const Owner = Schema.fromJsonString(
  Schema.Struct({
    link: Schema.Struct({ appId: Schema.String, repo: Schema.String, number: Schema.Int }),
    snapshot: Schema.optionalKey(ChangeDetailQuery),
    judged: Schema.optionalKey(Schema.Literals(["checking", "mergeable", "conflicting", "empty"])),
  }),
);
const decodeOwner = Schema.decodeUnknownOption(Owner);
export const changeReadRequest = (owner: string): ChangeReadRequest | null =>
  Option.getOrNull(decodeOwner(owner));
export const changeReadId = (orgId: string, owner: string): string =>
  JSON.stringify([orgId, owner]);

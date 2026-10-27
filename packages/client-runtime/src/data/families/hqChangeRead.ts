/** A demanded change read's identity: the change, at the head and main revision it displays. */
import { ChangeDetailQuery, type ChangeLink } from "@t3tools/shared/hqChanges";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
export interface ChangeReadRequest {
  readonly link: ChangeLink;
  readonly snapshot?: ChangeDetailQuery;
}
export const changeReadOwner = (request: ChangeReadRequest): string => JSON.stringify(request);
const Owner = Schema.fromJsonString(
  Schema.Struct({
    link: Schema.Struct({ appId: Schema.String, repo: Schema.String, number: Schema.Int }),
    snapshot: Schema.optionalKey(ChangeDetailQuery),
  }),
);
const decodeOwner = Schema.decodeUnknownOption(Owner);
export const changeReadRequest = (owner: string): ChangeReadRequest | null =>
  Option.getOrNull(decodeOwner(owner));
export const changeReadId = (orgId: string, owner: string): string =>
  JSON.stringify([orgId, owner]);

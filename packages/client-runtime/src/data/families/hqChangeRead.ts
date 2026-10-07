/** A demanded review's body and commits, read at the head and main revision it displays. */
import {
  ChangeDetailResponse,
  ChangeDetailQuery,
  type ChangeLink,
} from "@t3tools/shared/hqChanges";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { scopeOf, type FamilySpec } from "./spec.ts";
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
const decode = Schema.decodeUnknownOption(ChangeDetailResponse);
declare module "../model.ts" {
  interface FamilyValues {
    readonly hqChangeRead: ChangeDetailResponse;
  }
}
export const hqChangeReadFamily: FamilySpec<"hqChangeRead"> = {
  family: "hqChangeRead",
  authority: "hq",
  scope: { source: "hq", suffix: "hq-change-read", leaving: "removed", demand: "detail" },
  sampled: {
    path: ({ ownerId }) => {
      const request = changeReadRequest(ownerId);
      if (request === null) throw new Error("Invalid change identity.");
      const { appId, repo, number } = request.link;
      return `/api/apps/${encodeURIComponent(appId)}/changes/${encodeURIComponent(repo)}/${number}`;
    },
    freshMs: null,
    decode: (raw) => Option.getOrNull(decode(raw)),
  },
};
export const changeReadId = (orgId: string, owner: string): string =>
  JSON.stringify([orgId, owner]);
export const changeReadScope = (orgId: string, owner: string) =>
  scopeOf(hqChangeReadFamily, orgId, owner);

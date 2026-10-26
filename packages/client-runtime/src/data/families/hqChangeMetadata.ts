/** A change's metadata, separate from its full review contents. */
import { ChangeMetadataResponse } from "@t3tools/shared/hqChanges";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { changeReadRequest } from "./hqChangeRead.ts";
import { scopeOf, type FamilySpec } from "./spec.ts";
const decode = Schema.decodeUnknownOption(ChangeMetadataResponse);
declare module "../model.ts" {
  interface FamilyValues {
    readonly hqChangeMetadata: ChangeMetadataResponse;
  }
}
export const hqChangeMetadataFamily: FamilySpec<"hqChangeMetadata"> = {
  family: "hqChangeMetadata",
  authority: "hq",
  scope: { source: "hq", suffix: "hq-change-metadata", leaving: "removed", demand: "detail" },
  sampled: {
    path: ({ ownerId }) => {
      const request = changeReadRequest(ownerId);
      if (request === null) throw new Error("Invalid change identity.");
      const { appId, repo, number } = request.link;
      return `/api/apps/${encodeURIComponent(appId)}/changes/${encodeURIComponent(repo)}/${number}/metadata`;
    },
    freshMs: null,
    decode: (raw) => Option.getOrNull(decode(raw)),
  },
};
export const changeMetadataScope = (orgId: string, owner: string) =>
  scopeOf(hqChangeMetadataFamily, orgId, owner);

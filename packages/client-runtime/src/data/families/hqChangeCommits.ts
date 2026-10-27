/** A change's commits, read from its repository on the person's press. */
import { ChangeCommitsResponse } from "@t3tools/shared/hqChanges";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { changeReadRequest } from "./hqChangeRead.ts";
import { scopeOf, type FamilySpec } from "./spec.ts";
const decode = Schema.decodeUnknownOption(ChangeCommitsResponse);
declare module "../model.ts" {
  interface FamilyValues {
    readonly hqChangeCommits: ChangeCommitsResponse;
  }
}
export const hqChangeCommitsFamily: FamilySpec<"hqChangeCommits"> = {
  family: "hqChangeCommits",
  authority: "hq",
  scope: { source: "hq", suffix: "hq-change-commits", leaving: "removed", demand: "detail" },
  sampled: {
    path: ({ ownerId }) => {
      const request = changeReadRequest(ownerId);
      if (request === null) throw new Error("Invalid change identity.");
      const { appId, repo, number } = request.link;
      return `/api/apps/${encodeURIComponent(appId)}/changes/${encodeURIComponent(repo)}/${number}/commits`;
    },
    freshMs: null,
    decode: (raw) => Option.getOrNull(decode(raw)),
  },
};
export const changeCommitsScope = (orgId: string, owner: string) =>
  scopeOf(hqChangeCommitsFamily, orgId, owner);

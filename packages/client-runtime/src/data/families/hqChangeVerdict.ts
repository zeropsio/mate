/**
 * Whether a change merges, as HQ judges it now at the head and `main` the person is shown: read only
 * while HQ's record of the change has no verdict yet. No file or commit is read for it.
 */
import { ChangeDetailResponse } from "@t3tools/shared/hqChanges";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { changeReadRequest } from "./hqChangeRead.ts";
import { scopeOf, type FamilySpec } from "./spec.ts";
const decode = Schema.decodeUnknownOption(ChangeDetailResponse);
declare module "../model.ts" {
  interface FamilyValues {
    readonly hqChangeVerdict: ChangeDetailResponse;
  }
}
export const hqChangeVerdictFamily: FamilySpec<"hqChangeVerdict"> = {
  family: "hqChangeVerdict",
  authority: "hq",
  scope: { source: "hq", suffix: "hq-change-verdict", leaving: "removed", demand: "detail" },
  sampled: {
    path: ({ ownerId }) => {
      const request = changeReadRequest(ownerId);
      if (request === null) throw new Error("Invalid change identity.");
      const { appId, repo, number } = request.link;
      const search = new URLSearchParams(request.snapshot ?? {}).toString();
      return `/api/apps/${encodeURIComponent(appId)}/changes/${encodeURIComponent(repo)}/${number}${search === "" ? "" : `?${search}`}`;
    },
    freshMs: null,
    decode: (raw) => Option.getOrNull(decode(raw)),
  },
};
export const changeVerdictScope = (orgId: string, owner: string) =>
  scopeOf(hqChangeVerdictFamily, orgId, owner);

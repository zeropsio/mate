/** The exact production creation plan HQ persisted for the immutable release inputs. */
import { CreateReleaseRequest, ReleaseServicePlan } from "@t3tools/shared/hqRelease";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { scopeOf, type FamilySpec } from "./spec.ts";

export interface ReleaseReviewRequest {
  readonly appId: string;
  readonly request: CreateReleaseRequest;
}
export const releaseReviewOwner = (input: ReleaseReviewRequest): string => JSON.stringify(input);
const decodeOwner = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ appId: Schema.String, request: CreateReleaseRequest })),
);
export const releaseReviewRequest = (owner: string): ReleaseReviewRequest | null =>
  Option.getOrNull(decodeOwner(owner));
export const releaseReviewId = (orgId: string, owner: string): string =>
  JSON.stringify([orgId, owner]);
const decodePlan = Schema.decodeUnknownOption(ReleaseServicePlan);
declare module "../model.ts" {
  interface FamilyValues {
    readonly hqReleaseReview: ReleaseServicePlan;
  }
}
export const hqReleaseReviewFamily: FamilySpec<"hqReleaseReview"> = {
  family: "hqReleaseReview",
  authority: "hq",
  scope: {
    source: "hq",
    suffix: "hq-release-review",
    leaving: "removed",
    demand: "detail",
    mode: "once",
  },
  sampled: {
    path: ({ ownerId }) => {
      const input = releaseReviewRequest(ownerId);
      if (input === null) throw new Error("Invalid release review identity.");
      return `/api/apps/${encodeURIComponent(input.appId)}/releases/review`;
    },
    search: ({ ownerId }) => {
      const input = releaseReviewRequest(ownerId);
      if (input === null) throw new Error("Invalid release review identity.");
      return input.request;
    },
    decode: (raw) => Option.getOrNull(decodePlan(raw)),
    freshMs: 0,
  },
};
export const releaseReviewScope = (orgId: string, owner: string) =>
  scopeOf(hqReleaseReviewFamily, orgId, owner);

import { expect, it } from "vite-plus/test";
import type { HqOperation } from "../../zerops/hq/client.ts";
import { hqOperationOf, type HqOperationStanding } from "./hqOperation.ts";

const AT = "2026-11-23T10:00:00.000Z";
const failure = (code: string, step = "create") => ({ step, code, at: AT, origin: "zerops" });
const listed = (
  kind: string,
  phase: string,
  more: Partial<Pick<HqOperation, "failure" | "continueBy" | "needs">> = {},
): HqOperation => ({ id: "op-1", kind, phase, at: AT, acceptedAt: AT, ...more });

// witness: packages/client-runtime/src/data/projections/hqOperation.ts | yours: operation.continueBy === viewer, → yours: operation.continueBy !== undefined,
it("PJ131: An application's environment, deploy-key and Put it live operation stands as HQ lists it, for each kind asked: none where another kind or nothing is listed, going at every phase until it fails or needs a decision, waiting on its maker only for a lapsed token HQ names a maker for, yours only for that maker, and failed for every other failure; breaks: a second device draws no stage being added, or a failed deploy key reads as waiting", () => {
  const cases: ReadonlyArray<
    readonly [HqOperation | undefined, string, HqOperationStanding["kind"], boolean?]
  > = [
    [undefined, "environment", "none"],
    [undefined, "deploy_key", "none"],
    [undefined, "put_live", "none"],
    [listed("environment", "accepted"), "deploy_key", "none"],
    [listed("deploy_key", "key_requested"), "environment", "none"],
    [listed("put_live", "release_requested"), "environment", "none"],
    [listed("environment", "accepted"), "environment", "going"],
    [listed("environment", "project_created"), "environment", "going"],
    [listed("deploy_key", "accepted"), "deploy_key", "going"],
    [listed("deploy_key", "retire_requested"), "deploy_key", "going"],
    [listed("put_live", "accepted"), "put_live", "going"],
    [listed("put_live", "release_requested"), "put_live", "going"],
    [listed("put_live", "release_requested", { needs: "release_review" }), "put_live", "needs"],
    [
      listed("environment", "accepted", { failure: failure("token_expired"), continueBy: "u-me" }),
      "environment",
      "waiting",
      true,
    ],
    [
      listed("deploy_key", "key_requested", {
        failure: failure("token_expired"),
        continueBy: "u-other",
      }),
      "deploy_key",
      "waiting",
      false,
    ],
    [listed("put_live", "accepted", { failure: failure("token_expired") }), "put_live", "failed"],
    [
      listed("environment", "accepted", { failure: failure("projectLimitReached") }),
      "environment",
      "failed",
    ],
    [
      listed("deploy_key", "retire_requested", {
        failure: failure("ownerRoleRequired", "retire"),
        continueBy: "u-me",
      }),
      "deploy_key",
      "failed",
    ],
    [
      listed("put_live", "release_requested", {
        failure: failure("release_refused", "release"),
        needs: "release_review",
      }),
      "put_live",
      "failed",
    ],
  ];
  for (const [operation, kind, standing, yours] of cases) {
    const said = hqOperationOf(operation, kind, "u-me");
    const label = JSON.stringify([operation, kind]);
    expect(said.kind, label).toBe(standing);
    if (said.kind === "waiting") expect(said.yours, label).toBe(yours);
    if (said.kind === "needs") expect(said.needs, label).toBe("release_review");
    if (said.kind === "failed") expect(said.failure, label).toBe(operation?.failure);
  }
});

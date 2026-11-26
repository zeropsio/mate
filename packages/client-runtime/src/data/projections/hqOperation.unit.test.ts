import * as Schema from "effect/Schema";
import { expect, it } from "vite-plus/test";
import { recorded } from "../__fixtures__/recorded.ts";
import { HqOperation } from "../../zerops/hq/client.ts";
import { hqOperationOf, type HqOperationStanding } from "./hqOperation.ts";

const AT = "2026-11-23T10:00:00.000Z";
const failure = (code: string, step = "create") => ({ step, code, at: AT, origin: "zerops" });
const listed = (
  kind: string,
  phase: string,
  more: Partial<Pick<HqOperation, "failure" | "continueBy" | "needs" | "offers">> = {},
): HqOperation => ({ id: "op-1", kind, phase, at: AT, acceptedAt: AT, ...more });

const decodeApplication = Schema.decodeUnknownSync(
  Schema.Struct({ operation: Schema.optionalKey(HqOperation) }),
);
/** The operation HQ's recorded delivery shows on its application; none once it ended. */
const answered = (name: string): HqOperation | undefined => {
  const applications = recorded("scope-values", `mate-hq/navigation.${name}`)
    .values.filter((v) => v.key.startsWith("app:"))
    .map((v) => decodeApplication(v.value).operation);
  return applications.find((operation) => operation !== undefined);
};

// witness: packages/client-runtime/src/data/projections/hqOperation.ts | yours: operation.offers?.includes(CONTINUE) === true, → yours: operation.continueBy !== undefined,
it("PJ131: An application's environment, deploy-key, rename and Put it live operation stands as HQ lists it, for each kind asked: none where another kind or nothing is listed, going at every phase until it fails or needs a decision, waiting on its maker exactly where HQ names one to continue it, whatever it waits on, yours only where HQ offers the reader its Continue, and failed for every other failure; breaks: a second device draws no stage being added, a failed deploy key reads as waiting, or a maker who lost the right is shown a Continue HQ refuses", () => {
  const cases: ReadonlyArray<
    readonly [HqOperation | undefined, string, HqOperationStanding["kind"], boolean?]
  > = [
    [answered("environment.ended"), "environment", "none"],
    [answered("deploy-key.ended"), "deploy_key", "none"],
    [answered("put-live.ended"), "put_live", "none"],
    [listed("environment", "accepted"), "deploy_key", "none"],
    [listed("deploy_key", "key_requested"), "environment", "none"],
    [listed("put_live", "release_requested"), "environment", "none"],
    [answered("environment.running"), "environment", "going"],
    [listed("environment", "project_created"), "environment", "going"],
    [answered("deploy-key.running"), "deploy_key", "going"],
    [listed("deploy_key", "retire_requested"), "deploy_key", "going"],
    [answered("put-live.running"), "put_live", "going"],
    [listed("put_live", "release_requested"), "put_live", "going"],
    [answered("put-live.needs-release-review"), "put_live", "needs"],
    [answered("app-rename.running"), "app_rename", "going"],
    [answered("app-rename.ended"), "app_rename", "none"],
    [
      listed("environment", "accepted", {
        failure: failure("token_expired"),
        continueBy: "u-me",
        offers: ["continue"],
      }),
      "environment",
      "waiting",
      true,
    ],
    [
      listed("environment", "project_created", {
        failure: failure("token_expired", "watch"),
        continueBy: "u-me",
        offers: [],
      }),
      "environment",
      "waiting",
      false,
    ],
    [
      listed("deploy_key", "key_requested", {
        failure: failure("token_expired"),
        continueBy: "u-other",
        offers: [],
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
      }),
      "deploy_key",
      "failed",
    ],
    [
      listed("environment", "project_created", {
        failure: failure("access_lost", "watch"),
        continueBy: "u-other",
        offers: [],
      }),
      "environment",
      "waiting",
      false,
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
    const said = hqOperationOf(operation, kind);
    const label = JSON.stringify([operation, kind]);
    expect(said.kind, label).toBe(standing);
    if (said.kind === "waiting") expect(said.yours, label).toBe(yours);
    if (said.kind === "needs") expect(said.needs, label).toBe("release_review");
    if (said.kind === "going" || said.kind === "failed") expect(said.id, label).toBe(operation?.id);
    if (said.kind === "failed") expect(said.failure, label).toBe(operation?.failure);
  }
});

// witness: packages/client-runtime/src/data/projections/operationFailure.ts | const ZEROPS_PLATFORM_ERROR = "zerops_platform_error"; → const ZEROPS_PLATFORM_ERROR = "zerops_platform_err";
it("PJ147: A waiting operation's one offered press is worded by what it waits on: Continue after a lapsed sign-in or lost access, where the work resumes, and Try again after a Zerops platform error, where a failed step is sent again; breaks: a person is told their work merely continues when the press repeats a failed step", () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ["token_expired", "Continue"],
    ["access_lost", "Continue"],
    ["zerops_platform_error", "Try again"],
  ];
  for (const [code, press] of cases) {
    const said = hqOperationOf(
      listed("environment", "project_created", {
        failure: failure(code, "watch"),
        continueBy: "u-maker",
        offers: ["continue"],
      }),
      "environment",
    );
    expect(said.kind === "waiting" ? said.press : null, code).toBe(press);
  }
});

// witness: packages/client-runtime/src/data/projections/hqOperation.ts | ...(operation.offers?.includes(END) === true ? { endable: true as const } : {}), → ...(operation.offers?.includes(CONTINUE) !== true ? { endable: true as const } : {}),
it("PJ136: A waiting application operation offers its End only where HQ offers the reader its end, never to its maker's Continue or to another reader; breaks: an Owner is never shown how to free an application whose maker lost the right, or a reader HQ refuses is shown an End", () => {
  const waiting = (offers: ReadonlyArray<string>) =>
    listed("environment", "project_created", {
      failure: failure("token_expired", "watch"),
      continueBy: "u-maker",
      offers,
    });
  const cases: ReadonlyArray<readonly [ReadonlyArray<string>, boolean]> = [
    [["end"], true],
    [["continue"], false],
    [[], false],
  ];
  for (const [offers, endable] of cases) {
    const said = hqOperationOf(waiting(offers), "environment");
    expect(said.kind === "waiting" && said.endable === true, JSON.stringify(offers)).toBe(endable);
  }
});

// witness: packages/client-runtime/src/data/projections/hqOperation.ts | operation.offers?.includes(AGAIN) === true → false
it("PJ+1: An operation that ended failed is offered again only where HQ offers the reader its start again, and a running, waiting or decided one never is; breaks: a person is shown a Delete again or a Remove that HQ and Zerops refuse the same way, or the Owner who alone can finish is shown none.", () => {
  for (const kind of ["app_deletion", "production_removal"]) {
    const cases: ReadonlyArray<{
      readonly name: string;
      readonly operation: HqOperation;
      readonly standing: HqOperationStanding["kind"];
      readonly again: boolean;
    }> = [
      {
        name: "offered",
        operation: listed(kind, "accepted", { failure: failure("refused"), offers: ["again"] }),
        standing: "failed",
        again: true,
      },
      {
        name: "empty",
        operation: listed(kind, "accepted", { failure: failure("refused"), offers: [] }),
        standing: "failed",
        again: false,
      },
      {
        name: "absent",
        operation: listed(kind, "accepted", { failure: failure("refused") }),
        standing: "failed",
        again: false,
      },
      {
        name: "unknown",
        operation: listed(kind, "accepted", { failure: failure("refused"), offers: ["future"] }),
        standing: "failed",
        again: false,
      },
      {
        name: "waiting",
        operation: listed(kind, "accepted", {
          failure: failure("token_expired"),
          continueBy: "maker",
          offers: ["continue", "again"],
        }),
        standing: "waiting",
        again: false,
      },
      {
        name: "running",
        operation: listed(kind, "accepted", { offers: ["again"] }),
        standing: "going",
        again: false,
      },
      {
        name: "decided",
        operation: listed(kind, "accepted", { needs: "release_review", offers: ["again"] }),
        standing: "needs",
        again: false,
      },
    ];
    for (const row of cases) {
      const standing = hqOperationOf(row.operation, kind);
      expect(standing.kind, `${kind}: ${row.name}`).toBe(row.standing);
      expect("again" in standing, `${kind}: ${row.name}`).toBe(row.again);
      if (standing.kind === "failed" && row.again) expect(standing.again).toBe(true);
      if (standing.kind === "waiting") expect(standing.yours).toBe(true);
    }
  }
});

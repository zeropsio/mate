/**
 * ADR 0003: a Mate observes its application's environments through HQ, never a sibling grant.
 * Every person its door opens for must be a reader of the environment: a shared terminal cannot
 * safely inherit just one controller's reach. Only runtime facts leave here; no env, userData,
 * deploy credential or platform DTO. Permission facts are read for this call, never the outage fallback.
 */
import {
  type EnvironmentLogs,
  type EnvironmentStatus,
  type ObservedEnvironment,
} from "@t3tools/shared/hqObservation";
import { can } from "./permissions.ts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";
import { DeployKeys } from "./deployKeys.ts";
import { reachesOnly } from "./deployTokens.ts";
import { Roles, WriteConfirm, type OrgView } from "./roles.ts";
import { ZeropsApi, ZeropsObservation, type ZeropsError } from "./zerops/api.ts";

export class ObservationRefused extends Schema.TaggedError<ObservationRefused>()(
  "ObservationRefused",
  {
    reason: Schema.Literals([
      "forbidden",
      "mate_not_in_app",
      "deploy_key_unavailable",
      "service_not_found",
    ]),
  },
) {}
type ObservationError = ObservationRefused | SqlError | ZeropsError;

export const mayObserve = (view: OrgView, mateProjectId: string, projectId: string) => {
  const people = view.members.filter(
    (member) =>
      member.kind === "person" &&
      can(
        { kind: "person", userId: member.userId },
        "observe_mate",
        { projectId: mateProjectId },
        view,
      ).allow,
  );
  return (
    people.length > 0 &&
    people.every(
      (member) =>
        can({ kind: "person", userId: member.userId }, "read_project", { projectId }, view).allow,
    )
  );
};

export class Observation extends Context.Service<
  Observation,
  {
    readonly environments: (mateProjectId: string) => Effect.Effect<
      {
        readonly appId: string;
        readonly environments: ReadonlyArray<ObservedEnvironment>;
      },
      ObservationError
    >;
    readonly logs: (
      mateProjectId: string,
      projectId: string,
      serviceId: string,
      limit: number,
    ) => Effect.Effect<EnvironmentLogs, ObservationError>;
    readonly status: (
      mateProjectId: string,
      projectId: string,
    ) => Effect.Effect<EnvironmentStatus, ObservationError>;
  }
>()("@t3tools/hq/observation") {}

export const observationLayer = Layer.effect(
  Observation,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const roles = yield* Roles;
    const keys = yield* DeployKeys;
    const api = yield* ZeropsApi;
    const platform = yield* ZeropsObservation;
    const refused = (reason: ObservationRefused["reason"]) => new ObservationRefused({ reason });
    const scopeOf = (mateProjectId: string) =>
      Effect.gen(function* () {
        const view = yield* roles.forWrite.pipe(
          Effect.provideService(WriteConfirm, { fresh: true, until: undefined }),
        );
        const [placement] = yield* sql<{ readonly app_id: string }>`
      SELECT app_id FROM hq_app_project WHERE project_id = ${mateProjectId} AND kind IN ('mate', 'devstage')`;
        if (placement === undefined || !view.projects.some((p) => p.id === mateProjectId)) {
          return yield* refused("mate_not_in_app");
        }
        const rows = yield* sql<{
          readonly project_id: string;
          readonly name: string;
          readonly tier: "stage" | "production";
        }>`
      SELECT project_id, name, tier FROM hq_environment WHERE app_id = ${placement.app_id}::uuid ORDER BY declared_seq`;
        return {
          view,
          appId: placement.app_id,
          environments: rows
            .filter((row) => mayObserve(view, mateProjectId, row.project_id))
            .map((row) => ({ projectId: row.project_id, name: row.name, tier: row.tier })),
        };
      });
    const target = (mateProjectId: string, projectId: string) =>
      Effect.gen(function* () {
        const scope = yield* scopeOf(mateProjectId);
        const environment = scope.environments.find((row) => row.projectId === projectId);
        if (environment === undefined) return yield* refused("forbidden");
        const [kept] = yield* sql<{ readonly key_id: string | null; readonly sealed: Uint8Array }>`
      SELECT key_id, sealed FROM hq_deploy_token WHERE project_id = ${projectId}`;
        const token =
          kept === undefined
            ? undefined
            : keys.open(projectId, { keyId: kept.key_id ?? "", sealed: kept.sealed });
        if (token === undefined) return yield* refused("deploy_key_unavailable");
        const own = yield* api
          .ownToken(token)
          .pipe(Effect.catchTag("ZeropsRefused", () => refused("deploy_key_unavailable")));
        if (!reachesOnly(own, scope.view.orgId, projectId))
          return yield* refused("deploy_key_unavailable");
        return { environment, token };
      });
    return Observation.of({
      logs: (mateProjectId, projectId, serviceId, limit) =>
        Effect.gen(function* () {
          const { token } = yield* target(mateProjectId, projectId);
          const service = yield* api.service(serviceId)(token);
          if (service.projectId !== projectId || service.isSystem)
            return yield* refused("service_not_found");
          return {
            projectId,
            serviceId,
            entries: yield* platform.logs(projectId, serviceId, limit)(token),
          };
        }),
      environments: (mateProjectId) =>
        Effect.map(scopeOf(mateProjectId), ({ appId, environments }) => ({ appId, environments })),
      status: (mateProjectId, projectId) =>
        Effect.gen(function* () {
          const { environment, token } = yield* target(mateProjectId, projectId);
          const services = yield* api.services(projectId)(token);
          if (services.some((service) => service.projectId !== projectId))
            return yield* refused("forbidden");
          return {
            environment,
            services: yield* Effect.forEach(
              services.filter((service) => !service.isSystem),
              (service) =>
                Effect.gen(function* () {
                  const activeVersion =
                    service.activeVersionId === null
                      ? null
                      : yield* platform.activeVersion(service.activeVersionId)(token);
                  return {
                    id: service.id,
                    name: service.name,
                    status: service.status,
                    activeVersion,
                  };
                }),
              { concurrency: 4 },
            ),
          };
        }),
    });
  }),
);

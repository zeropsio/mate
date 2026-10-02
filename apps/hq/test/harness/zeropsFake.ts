/**
 * The in-memory ZeropsApi. It exists only because it passes the same contract suite as the HTTP
 * implementation against the real API (`src/zerops/contract.test.ts`): every refusal mirrors what
 * the platform answered there — a bogus credential `401 notAuthorized`, another org `403
 * insufficientPermissions`, an unknown project `400 projectNotFound`, a sensitive value `REDACTED`
 * to a Read only credential — and `down` makes every read unavailable.
 *
 * @module test/harness/zeropsFake
 */
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";

import {
  type ZeropsApi,
  type ZeropsError,
  type ZeropsMember,
  type ZeropsOwnToken,
  type ZeropsProject,
  ZeropsRefused,
  ZeropsUnavailable,
} from "../../src/zerops/api.ts";

export interface FakeWorld {
  /** Members by org id. */
  members: Map<string, Array<ZeropsMember>>;
  projects: Array<ZeropsProject>;
  /** Project env by project id. */
  env: Map<
    string,
    Array<{ readonly key: string; readonly value: string; readonly sensitive: boolean }>
  >;
  /** Integration tokens by their value; the fake's clock stamps `readAtMs` on each read. */
  tokens: Map<string, Omit<ZeropsOwnToken, "readAtMs">>;
  down: boolean;
  /** Every call, as `<operation>:<credential>`, for a test that counts what a credential spent. */
  calls: Array<string>;
}

export const emptyWorld = (): FakeWorld => ({
  members: new Map(),
  projects: [],
  env: new Map(),
  tokens: new Map(),
  down: false,
  calls: [],
});

export const fakeZeropsApi = (world: FakeWorld): ZeropsApi["Service"] => {
  /** The token behind `credential`, as the platform would judge the call. */
  const caller = (operation: string, credential: Redacted.Redacted) =>
    Effect.suspend((): Effect.Effect<Omit<ZeropsOwnToken, "readAtMs">, ZeropsError> => {
      world.calls.push(`${operation}:${Redacted.value(credential)}`);
      if (world.down) {
        return Effect.fail(new ZeropsUnavailable({ operation, message: "fake: platform down" }));
      }
      const token = world.tokens.get(Redacted.value(credential));
      return token === undefined
        ? Effect.fail(
            new ZeropsRefused({
              operation,
              reason: "unauthorized",
              status: 401,
              code: "notAuthorized",
            }),
          )
        : Effect.succeed(token);
    });

  const inOrg = (operation: string, credential: Redacted.Redacted, orgId: string) =>
    caller(operation, credential).pipe(
      Effect.filterOrFail(
        (token) => token.orgId === orgId,
        () =>
          new ZeropsRefused({
            operation,
            reason: "forbidden",
            status: 403,
            code: "insufficientPermissions",
          }),
      ),
    );

  const project = (operation: string, credential: Redacted.Redacted, projectId: string) =>
    Effect.flatMap(caller(operation, credential), (token) => {
      const found = world.projects.find((candidate) => candidate.id === projectId);
      if (found === undefined) {
        return Effect.fail(
          new ZeropsRefused({
            operation,
            reason: "not_found",
            status: 400,
            code: "projectNotFound",
          }),
        );
      }
      return inOrg(operation, credential, found.orgId).pipe(Effect.as({ token, project: found }));
    });

  return {
    members: (orgId) => (credential) =>
      inOrg("members", credential, orgId).pipe(Effect.as([...(world.members.get(orgId) ?? [])])),
    projects: (orgId) => (credential) =>
      inOrg("projects", credential, orgId).pipe(
        Effect.as(world.projects.filter((candidate) => candidate.orgId === orgId)),
      ),
    project: (projectId) => (credential) =>
      project("project", credential, projectId).pipe(Effect.map((found) => found.project)),
    projectEnv: (projectId) => (credential) =>
      project("projectEnv", credential, projectId).pipe(
        Effect.map(
          ({ token }) =>
            new Map(
              (world.env.get(projectId) ?? []).map((variable) => [
                variable.key,
                variable.sensitive && token.roleCode !== "ADMIN" ? "REDACTED" : variable.value,
              ]),
            ),
        ),
      ),
    ownToken: (credential) =>
      Effect.zipWith(caller("ownToken", credential), Clock.currentTimeMillis, (token, now) => ({
        ...token,
        readAtMs: now,
      })),
  };
};

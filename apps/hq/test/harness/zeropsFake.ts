/**
 * The in-memory ZeropsApi. It exists only because it passes the same contract suite as the HTTP
 * implementation against the real API (`src/zerops/contract.test.ts`): every refusal mirrors what
 * the platform answered there — a bogus credential `401 notAuthorized`, another org `403
 * insufficientPermissions`, an unknown project `400 projectNotFound`, a sensitive value `REDACTED`
 * to a Read only credential — and `down` makes every read unavailable. `apiClock: false` answers
 * without the API's clock (its `Date` header): a knob for HQ's own refusal to judge without it,
 * never measured on the real API.
 *
 * Its deploy ({@link fakeZeropsDeploy}) moves as the rig measured one with an environment's Basic
 * user token (2026-10-02): the service's own variables name the new version as its job starts,
 * the active version switches when it ends; an org Read only token is refused a write
 * (`403 insufficientPermissions`). Each job ends at its first read, as `outcome` says.
 *
 * @module test/harness/zeropsFake
 */
import { roleAtLeast } from "@t3tools/shared/zeropsRoles";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";

import {
  type ZeropsApi,
  type ZeropsObservation,
  type ZeropsDeploy,
  type ZeropsError,
  type ZeropsMember,
  type ZeropsOwnToken,
  type ZeropsProcess,
  type ZeropsProject,
  ZeropsRefused,
  type ZeropsService,
  ZeropsUnavailable,
} from "../../src/zerops/api.ts";

/** A service as the fake holds it: its record, changed in place by a deploy. */
export type FakeService = { -readonly [K in keyof ZeropsService]: ZeropsService[K] };

/** How a deploy's job ends at its first read: it runs, its build fails, or it is still at it. */
export type FakeOutcome = "ACTIVE" | "BUILD_FAILED" | "BUILDING";

export interface FakeAppVersion {
  readonly id: string;
  readonly serviceId: string;
  readonly name: string;
  status: string;
  archive: Uint8Array | undefined;
  zeropsYaml: string | undefined;
  setup: string | undefined;
  /** When a build Zerops took shows, ms: it reads UPLOADING until then (`buildSeenAfter`). */
  buildSeenAtMs?: number;
}

interface FakeJob {
  status: ZeropsProcess["status"];
  failure: string | null;
  /** The version a deploy's job builds; none for a subdomain's. */
  readonly appVersionId: string | undefined;
  /** The services an import's process brings up; none for any other. */
  readonly imports?: ReadonlyArray<string>;
  /** A subdomain's: how many more reads it answers RUNNING before it is FINISHED. */
  runningReads?: number;
}

export interface FakeWorld {
  /** Members by org id. */
  members: Map<string, Array<ZeropsMember>>;
  projects: Array<ZeropsProject>;
  /** Setup marker presence by zcp service id. */
  setupMarkers: Set<string>;
  /** Project env by project id. */
  env: Map<
    string,
    Array<{ readonly key: string; readonly value: string; readonly sensitive: boolean }>
  >;
  /** Integration tokens by their value; the fake's clock stamps `readAtMs` on each read. */
  tokens: Map<string, Omit<ZeropsOwnToken, "readAtMs">>;
  down: boolean;
  /** How long the org's member list takes to answer, ms: KRLS's stalls (F22); none at 0. */
  membersTake: number;
  /** Whether answers carry the API's clock (`readAtMs`). */
  apiClock: boolean;
  /** Every call, as `<operation>:<credential>`, for a test that counts what a credential spent. */
  calls: Array<string>;
  services: Array<FakeService>;
  appVersions: Map<string, FakeAppVersion>;
  jobs: Map<string, FakeJob>;
  /** How a version's deploy ends; `ACTIVE` unless it says otherwise. */
  outcome: (version: FakeAppVersion) => FakeOutcome;
  /** How an import's process ends at its next read: its services up, failed, or still running. */
  importOutcome: () => "FINISHED" | "FAILED" | "RUNNING";
  /** How many reads a subdomain's process answers RUNNING before it is FINISHED; none by default. */
  subdomainRunningReads: number;
  /** Every services import, as asked. */
  imports: Array<{ readonly projectId: string; readonly yaml: string }>;
  /**
   * Deploy writes whose next answer is lost on its way back: the platform does it, and the caller
   * hears Zerops not answering — what no idempotency key guards against (audit H6).
   */
  lost: Set<"createAppVersion" | "upload" | "buildAndDeploy" | "importServices">;
  /** Operations Zerops does not answer while they are named here, as `down` does every one. */
  unanswered: Set<string>;
  /** How long an archive's upload takes to answer, ms: a large archive's; none at 0. */
  uploadTakes: number;
  /** How long a version whose build Zerops took still reads UPLOADING, ms; none at 0. */
  buildSeenAfter: number;
}

export const emptyWorld = (): FakeWorld => ({
  members: new Map(),
  projects: [],
  env: new Map(),
  setupMarkers: new Set(),
  tokens: new Map(),
  down: false,
  membersTake: 0,
  apiClock: true,
  calls: [],
  services: [],
  appVersions: new Map(),
  jobs: new Map(),
  outcome: () => "ACTIVE",
  importOutcome: () => "FINISHED",
  subdomainRunningReads: 0,
  imports: [],
  lost: new Set(),
  unanswered: new Set(),
  uploadTakes: 0,
  buildSeenAfter: 0,
});

export const fakeZeropsApi = (world: FakeWorld): ZeropsApi["Service"] => {
  /** The token behind `credential`, as the platform would judge the call. */
  const caller = (operation: string, credential: Redacted.Redacted) =>
    tokenOf(world, operation, credential);

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
      Effect.suspend(() => {
        const read = inOrg("members", credential, orgId).pipe(
          Effect.as([...(world.members.get(orgId) ?? [])]),
        );
        return world.membersTake > 0 ? Effect.delay(read, world.membersTake) : read;
      }),
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
    mateSetupMarker: (orgId, projectId, serviceId) => (credential) =>
      inOrg("mateSetupMarker", credential, orgId).pipe(
        Effect.map(() =>
          serviceId === null
            ? world.services.some(
                (service) => service.projectId === projectId && world.setupMarkers.has(service.id),
              )
            : world.setupMarkers.has(serviceId),
        ),
      ),
    tokenProjects: (orgId, tokenId) => (credential) =>
      inOrg("tokenProjects", credential, orgId).pipe(
        Effect.flatMap(() => {
          // An id of no token: `400 *NotFound`; another org's token: `403`, as the platform
          // refuses its other reads (neither measured for this one).
          const token = [...world.tokens.values()].find((candidate) => candidate.id === tokenId);
          if (token === undefined) {
            return Effect.fail(notFound("tokenProjects", "integrationTokenNotFound"));
          }
          return token.orgId === orgId
            ? Effect.succeed(token.projects)
            : Effect.fail(
                new ZeropsRefused({
                  operation: "tokenProjects",
                  reason: "forbidden",
                  status: 403,
                  code: "insufficientPermissions",
                }),
              );
        }),
      ),
    ownToken: (credential) =>
      Effect.zipWith(caller("ownToken", credential), Clock.currentTimeMillis, (token, now) => ({
        ...token,
        readAtMs: world.apiClock ? now : undefined,
      })),
    services: (projectId) => (credential) =>
      project("services", credential, projectId).pipe(
        Effect.as(
          world.services
            .filter((service) => service.projectId === projectId)
            .map((service) => ({ ...service })),
        ),
      ),
    service: (serviceId) => (credential) =>
      serviceOf(world, "service", credential, serviceId).pipe(
        Effect.map((service) => ({ ...service })),
      ),
  };
};

const notFound = (operation: string, code: string) =>
  new ZeropsRefused({ operation, reason: "not_found", status: 400, code });

/** The token behind `credential`, refused unless it is one; the platform down refuses all. */
const tokenOf = (world: FakeWorld, operation: string, credential: Redacted.Redacted) =>
  Effect.suspend((): Effect.Effect<Omit<ZeropsOwnToken, "readAtMs">, ZeropsError> => {
    world.calls.push(`${operation}:${Redacted.value(credential)}`);
    if (world.down || world.unanswered.has(operation)) {
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

/** A service the credential reads: one of a project of its org. */
const serviceOf = (
  world: FakeWorld,
  operation: string,
  credential: Redacted.Redacted,
  serviceId: string,
) =>
  Effect.flatMap(tokenOf(world, operation, credential), (token) => {
    const service = world.services.find((candidate) => candidate.id === serviceId);
    const project = world.projects.find((candidate) => candidate.id === service?.projectId);
    if (service === undefined || project === undefined) {
      return Effect.fail(notFound(operation, "serviceStackNotFound"));
    }
    return project.orgId === token.orgId
      ? Effect.succeed(service)
      : Effect.fail(
          new ZeropsRefused({
            operation,
            reason: "forbidden",
            status: 403,
            code: "insufficientPermissions",
          }),
        );
  });

/** A service the credential deploys to: Basic user or more there, by its org role or a grant. */
const deployedBy = (
  world: FakeWorld,
  operation: string,
  credential: Redacted.Redacted,
  serviceId: string,
) =>
  Effect.flatMap(tokenOf(world, operation, credential), (token) =>
    Effect.flatMap(serviceOf(world, operation, credential, serviceId), (service) => {
      const grant = token.projects.find((entry) => entry.projectId === service.projectId);
      return roleAtLeast(token.roleCode, "BASIC_USER") || roleAtLeast(grant?.roleCode, "BASIC_USER")
        ? Effect.succeed(service)
        : Effect.fail(
            new ZeropsRefused({
              operation,
              reason: "forbidden",
              status: 403,
              code: "insufficientPermissions",
            }),
          );
    }),
  );

/** A deploy write's answer, unless the world loses it once (`lost`). */
const answered = <A>(
  world: FakeWorld,
  operation: "createAppVersion" | "upload" | "buildAndDeploy" | "importServices",
  value: A,
) =>
  world.lost.delete(operation)
    ? Effect.fail(new ZeropsUnavailable({ operation, message: "fake: the answer was lost" }))
    : Effect.succeed(value);

export const fakeZeropsDeploy = (world: FakeWorld): ZeropsDeploy["Service"] => {
  let made = 0;
  const id = (prefix: string) => `${prefix}-${String((made += 1))}`;
  const versionOf = (operation: string, credential: Redacted.Redacted, appVersionId: string) =>
    Effect.flatMap(
      Effect.suspend(() => {
        const version = world.appVersions.get(appVersionId);
        return version === undefined
          ? Effect.fail(notFound(operation, "appVersionNotFound"))
          : Effect.succeed(version);
      }),
      (version) => Effect.as(deployedBy(world, operation, credential, version.serviceId), version),
    );
  /** A running job, read: it ends as `outcome` says — an import's as `importOutcome` — or runs on. */
  const advance = (job: FakeJob) => {
    if (job.runningReads !== undefined) {
      if (job.runningReads === 0) job.status = "FINISHED";
      else job.runningReads -= 1;
      return;
    }
    if (job.status === "RUNNING" && job.imports !== undefined) {
      const ended = world.importOutcome();
      if (ended === "RUNNING") return;
      job.status = ended;
      if (ended === "FAILED") job.failure = "Import failed: the service could not be created";
      for (const service of world.services) {
        if (job.imports.includes(service.id))
          service.status = ended === "FINISHED" ? "ACTIVE" : "ACTION_FAILED";
      }
      return;
    }
    const version =
      job.appVersionId === undefined ? undefined : world.appVersions.get(job.appVersionId);
    if (job.status !== "RUNNING" || version === undefined) return;
    const outcome = world.outcome(version);
    if (outcome === "ACTIVE") {
      for (const other of world.appVersions.values()) {
        if (other.serviceId === version.serviceId && other.status === "ACTIVE") {
          other.status = "BACKUP";
        }
      }
      version.status = "ACTIVE";
      job.status = "FINISHED";
      const service = world.services.find((candidate) => candidate.id === version.serviceId);
      if (service !== undefined) service.activeVersionId = version.id;
    } else if (outcome === "BUILD_FAILED") {
      version.status = "BUILD_FAILED";
      job.status = "FAILED";
      job.failure = "Build failed: npm run build exited 1";
    }
  };
  return {
    createAppVersion: (serviceId, name) => (credential) =>
      Effect.map(deployedBy(world, "createAppVersion", credential, serviceId), () => {
        const version: FakeAppVersion = {
          id: id("V"),
          serviceId,
          name,
          status: "UPLOADING",
          archive: undefined,
          zeropsYaml: undefined,
          setup: undefined,
        };
        world.appVersions.set(version.id, version);
        return { id: version.id };
      }).pipe(Effect.flatMap((made) => answered(world, "createAppVersion", made))),
    upload: (appVersionId, archive) => (credential) =>
      Effect.map(versionOf("upload", credential, appVersionId), (version) => {
        version.archive = archive;
      }).pipe(
        Effect.delay(world.uploadTakes),
        Effect.flatMap(() => answered(world, "upload", undefined)),
      ),
    buildAndDeploy: (appVersionId, zeropsYaml, setup) => (credential) =>
      Effect.flatMap(
        Effect.zip(versionOf("buildAndDeploy", credential, appVersionId), Clock.currentTimeMillis),
        ([version, now]): Effect.Effect<{ readonly processId: string }, ZeropsError> => {
          if (version.archive === undefined) {
            return Effect.fail(
              new ZeropsRefused({
                operation: "buildAndDeploy",
                reason: "invalid",
                status: 400,
                code: "appVersionNotUploaded",
              }),
            );
          }
          version.zeropsYaml = zeropsYaml;
          version.setup = setup;
          if (world.buildSeenAfter > 0) version.buildSeenAtMs = now + world.buildSeenAfter;
          else version.status = "BUILDING";
          const service = world.services.find((candidate) => candidate.id === version.serviceId);
          if (service !== undefined) service.named = { id: version.id, name: version.name };
          const processId = id("process");
          world.jobs.set(processId, { status: "RUNNING", failure: null, appVersionId: version.id });
          return answered(world, "buildAndDeploy", { processId });
        },
      ),
    process: (processId) => (credential) =>
      Effect.flatMap(tokenOf(world, "process", credential), () => {
        const job = world.jobs.get(processId);
        if (job === undefined) return Effect.fail(notFound("process", "processNotFound"));
        advance(job);
        return Effect.succeed({ status: job.status, failure: job.failure });
      }),
    appVersion: (appVersionId) => (credential) =>
      Effect.map(
        Effect.zip(versionOf("appVersion", credential, appVersionId), Clock.currentTimeMillis),
        ([version, now]) => {
          if (version.buildSeenAtMs !== undefined) {
            if (now < version.buildSeenAtMs) return { status: version.status };
            if (version.status === "UPLOADING") version.status = "BUILDING";
          }
          for (const job of world.jobs.values()) {
            if (job.appVersionId === version.id) advance(job);
          }
          return { status: version.status };
        },
      ),
    importServices: (projectId, yaml) => (credential) =>
      Effect.flatMap(
        tokenOf(world, "importServices", credential),
        (
          token,
        ): Effect.Effect<
          {
            readonly services: ReadonlyArray<{
              readonly name: string;
              readonly processes: ReadonlyArray<string>;
            }>;
          },
          ZeropsError
        > => {
          const project = world.projects.find((candidate) => candidate.id === projectId);
          if (project === undefined)
            return Effect.fail(notFound("importServices", "projectNotFound"));
          const grant = token.projects.find((entry) => entry.projectId === projectId);
          if (
            project.orgId !== token.orgId ||
            !(
              roleAtLeast(token.roleCode, "BASIC_USER") ||
              roleAtLeast(grant?.roleCode, "BASIC_USER")
            )
          ) {
            return Effect.fail(
              new ZeropsRefused({
                operation: "importServices",
                reason: "forbidden",
                status: 403,
                code: "insufficientPermissions",
              }),
            );
          }
          world.imports.push({ projectId, yaml });
          const hostnames = [...yaml.matchAll(/^\s*-\s+hostname:\s*(\S+)\s*$/gmu)].map(
            (match) => match[1] ?? "",
          );
          const services = hostnames.map((name) => {
            const serviceId = id("S");
            world.services.push({
              id: serviceId,
              projectId,
              name,
              status: "CREATING",
              isSystem: false,
              subdomainAccess: false,
              http: false,
              named: null,
              activeVersionId: null,
            });
            const processId = id("process");
            world.jobs.set(processId, {
              status: "RUNNING",
              failure: null,
              appVersionId: undefined,
              imports: [serviceId],
            });
            return { name, processes: [processId] };
          });
          return answered(world, "importServices", { services });
        },
      ),
    enableSubdomainAccess: (serviceId) => (credential) =>
      Effect.map(deployedBy(world, "enableSubdomainAccess", credential, serviceId), (service) => {
        service.subdomainAccess = true;
        const processId = id("process");
        world.jobs.set(processId, {
          status: world.subdomainRunningReads === 0 ? "FINISHED" : "RUNNING",
          failure: null,
          appVersionId: undefined,
          runningReads: world.subdomainRunningReads,
        });
        return { processId };
      }),
  };
};

export const fakeZeropsObservation = (world: FakeWorld): ZeropsObservation["Service"] => ({
  logs: (_projectId, _serviceId, _limit) => (credential) =>
    tokenOf(world, "logs", credential).pipe(Effect.as([])),
  activeVersion: (id) => (credential) =>
    Effect.gen(function* () {
      yield* tokenOf(world, "activeVersion", credential);
      const version = world.appVersions.get(id);
      if (version === undefined)
        return yield* new ZeropsRefused({
          operation: "activeVersion",
          reason: "not_found",
          status: 404,
          code: "appVersionNotFound",
        });
      return { id: version.id, name: version.name };
    }),
});

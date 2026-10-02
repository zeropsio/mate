/**
 * The birth of an organization's HQ (SPEC §3.1, §6.2.1), run by an org Owner or Admin's client:
 * the HQ project, its anchor and working credential, and Core deployed from the build the client
 * itself came with.
 *
 * Seven steps, each reading what is there before it writes:
 *
 * 1. `project` — the HQ project from an import: `hq` (Core; never `core`, every project's reserved
 *    system service, T0 §4), `db` and `vol`, named `Headquarters` as the Gitea project was, tagged
 *    `mate:hq` and with the birth's own tag. Never while the member list names an HQ already, nor
 *    while a `mate:hq` project no anchor names stands: one is being set up elsewhere, or stopped.
 * 2. `services` — the three services up.
 * 3. `credential` — `mate-hq-org:<projectId>`, org Read only and nothing else, written as the
 *    sensitive `HQ_ORG_TOKEN` of `hq`, once the import's variables have synced. A token's value is
 *    shown once: a token whose variable is missing is regenerated; a variable that is there is
 *    never written again.
 * 4. `deploy` — Core's archive and `zerops.yml` (`core`), as an app version built and deployed. Core
 *    starts as a standby, its anchor missing; its deploy opens `hq`'s HTTP port, which a fresh
 *    import's `hq` does not have (measured in KRLS, 2026-10-02: a routing before it is refused,
 *    400 "ServiceStack must supported http protocol"). The version is uploaded once and kept: a
 *    build refused while the variables `credential` wrote still sync is asked again, and a step
 *    that stopped builds the same version on *Try again*.
 * 5. `domain` — HQ's address is its project's own domain (`publicZone`), the one Core names itself
 *    by: a routing of it to Core's port with SSL, the project's routings synced, and its
 *    certificate active (about ten seconds, measured on the rig 2026-10-02). An address that never
 *    serves over HTTPS stops here, with the platform's reason. A record at this step with no deploy
 *    behind it deploys first.
 * 6. `anchor` — `mate-hq:<projectId>:<address>`, org Admin, its value dropped at once: the mark
 *    that makes this HQ the official one (`anchor.ts`). Never while an anchor names another one.
 * 7. `ready` — `/health` answering `official: ok` and `state: active`, which follows the anchor
 *    within Core's 30 s recheck.
 *
 * The **record** (`HqBirthRecord`) is what a step leaves for the next, and what *Try again* — or a
 * reload, where the client keeps it — resumes from: a step that stopped runs again, the ones
 * before it do not. The import is sent at most once a birth: the birth's tag
 * (`mate:hq-birth:<id>`) is kept before the import is sent, and a birth that keeps one never sends
 * it again — whatever became of its answer, it takes up the one project carrying that tag, or stops
 * `uncertain`. Only an import Zerops refused outright made nothing, and is sent anew. No project is
 * ever taken for HQ's by its name or the `mate:hq` tag alone.
 *
 * Pure of platform globals (rule R1): the platform, Core's artifact, the health read, the clock
 * and the sleeps are passed in.
 *
 * @module hq/birth
 */
import { ZeropsApiError, type ZeropsApiClient } from "../api.ts";
import { findOfficialHq, hqAnchorName, hqOrgTokenName } from "./anchor.ts";
import type { HqEndpoint, HqHealth } from "./client.ts";

export const HQ_PROJECT_NAME = "Headquarters";
/**
 * Marks HQ's project for the Zerops GUI, and for a birth to see one underway: the official HQ is
 * the one its anchor names, never a tag.
 */
export const HQ_PROJECT_TAG = "mate:hq";
/** One birth's own tag on the project it imports: what finds that project, and nothing else. */
const hqBirthTag = (birthId: string): string => `mate:hq-birth:${birthId}`;
/** A project on its way out, or out: nothing a birth counts. */
const GONE_PROJECT_STATUSES: ReadonlySet<string> = new Set(["DELETING", "DELETED"]);
const HQ_SERVICE = "hq";
const HQ_PORT = 8080;
const HQ_SERVICES = ["db", "vol", HQ_SERVICE] as const;
/** Core's working credential, as Core reads it (`apps/hq/src/main.ts`). */
const HQ_ORG_TOKEN_ENV = "HQ_ORG_TOKEN";
/** The `zerops.yml` entry Core deploys from (`apps/hq/zerops.yml`). */
const HQ_SETUP = "hq";
/**
 * Zerops refuses a build, or a variable's write, while the service's variables sync, which a
 * variable just written starts (measured in Mate s.r.o., 2026-10-03: a build refused 400 right after
 * `HQ_ORG_TOKEN`), and the import's own `envSecrets` too.
 */
const VARIABLES_SYNCING = "userDataSyncRunning";
/** The longest wait between two builds refused while the variables sync. */
const SYNC_BACKOFF_MAX_MS = 30_000;

export type HqBirthStep =
  | "project"
  | "services"
  | "credential"
  | "deploy"
  | "domain"
  | "anchor"
  | "ready";

export const HQ_BIRTH_STEPS: ReadonlyArray<HqBirthStep> = [
  "project",
  "services",
  "credential",
  "deploy",
  "domain",
  "anchor",
  "ready",
];

/** What each step is doing, as its line says while it runs and names it when it stops. */
export const HQ_BIRTH_DOING: Readonly<Record<HqBirthStep, string>> = {
  project: "Creating HQ's project",
  services: "Starting HQ's services",
  credential: "Giving HQ its access",
  deploy: "Deploying HQ",
  domain: "Giving HQ its address",
  anchor: "Marking it this organization's HQ",
  ready: "Waiting for HQ to answer",
};

/** What a birth has made so far. */
export interface HqBirthRecord {
  /** The step to run next; `done` once HQ answered as the official one. */
  readonly step: HqBirthStep | "done";
  /**
   * The birth's own tag (`hqBirthTag`), kept before its import is sent: from then on the import
   * is never sent again, and the project is found by it. Null before.
   */
  readonly importTag: string | null;
  readonly projectId: string | null;
  /** The `hq` service. */
  readonly serviceId: string | null;
  /** Core's address, as its anchor names it. */
  readonly address: string | null;
  /** Core's app version, its archive uploaded: what the deploy builds, made once. */
  readonly appVersionId: string | null;
  /** The deploy Zerops took, followed until it ends. */
  readonly deployProcessId: string | null;
}

export const HQ_BIRTH_START: HqBirthRecord = {
  step: "project",
  importTag: null,
  projectId: null,
  serviceId: null,
  address: null,
  appVersionId: null,
  deployProcessId: null,
};

/** The platform calls a birth makes, as the account's client offers them. */
export type HqBirthPlatform = Pick<
  ZeropsApiClient,
  | "listClientProjects"
  | "listOrganizationMembers"
  | "listIntegrationTokens"
  | "importProject"
  | "listProjectServices"
  | "fetchProject"
  | "mintIntegrationToken"
  | "regenerateIntegrationToken"
  | "listServiceVariableNames"
  | "writeServiceSecret"
  | "createAppVersion"
  | "uploadAppVersionArchive"
  | "buildAndDeployAppVersion"
  | "readProcessStatus"
  | "listPublicHttpRoutings"
  | "createPublicHttpRouting"
  | "syncPublicHttpRouting"
>;

/** Core as this build of the app carries it (`hq-core/`). */
export interface HqCoreArtifact {
  readonly archive: Uint8Array<ArrayBuffer>;
  readonly zeropsYaml: string;
}

export interface HqBirthWaits {
  readonly pollMs: number;
  readonly servicesCapMs: number;
  readonly domainCapMs: number;
  readonly deployCapMs: number;
  readonly readyCapMs: number;
}

/**
 * The import takes about a minute, a deploy about one (T0 §3, §4); both get ten times that. A
 * domain's certificate takes about ten seconds; it gets a few minutes.
 */
export const HQ_BIRTH_WAITS: HqBirthWaits = {
  pollMs: 3_000,
  servicesCapMs: 10 * 60_000,
  domainCapMs: 5 * 60_000,
  deployCapMs: 15 * 60_000,
  readyCapMs: 5 * 60_000,
};

export interface HqBirthDeps {
  readonly platform: HqBirthPlatform;
  /** Read only when a deploy is made. */
  readonly core: () => Promise<HqCoreArtifact>;
  readonly health: (address: string) => Promise<HqHealth>;
  readonly sleep: (ms: number) => Promise<void>;
  readonly now: () => number;
  /** A new birth's id, for its tag. */
  readonly newBirthId: () => string;
  readonly waits?: Partial<HqBirthWaits>;
}

export type HqBirthOutcome =
  | { readonly ok: true; readonly hq: HqEndpoint }
  | {
      readonly ok: false;
      readonly step: HqBirthStep;
      readonly reason: string;
      /** The platform may have carried the step out though its answer was lost. */
      readonly uncertain: boolean;
    };

/** A stop of the birth's own, in words the person reads. */
class BirthStopped extends Error {}

/** The import may have made a project this birth knows nothing of. */
class ImportUnanswered extends Error {}

const IMPORT_UNANSWERED =
  "Zerops did not confirm HQ's project, and lists none of this setup's. Try again in a moment; before starting over, look for a Headquarters project in Zerops and delete it.";

/** Zerops answered the import with a no: it made nothing. */
const refusedOutright = (cause: unknown): boolean =>
  cause instanceof ZeropsApiError &&
  (cause.kind === "invalid-input" || cause.kind === "forbidden" || cause.kind === "not-found");

/**
 * HQ's import: Core, its Postgres, its volume and its backup bucket, and the variables Core reads
 * besides its token. The bucket's quota is 80 GB: a day of hourly sets, two weeks of daily, six
 * months of monthly, at five times today's data (vysledky/hq-backup.md §4).
 */
export function hqImportYaml(input: {
  /** The birth's own tag (`hqBirthTag`). */
  readonly birthTag: string;
  /** The client origins HQ's API answers (`HQ_CLIENT_ORIGINS`). */
  readonly origins: ReadonlyArray<string>;
  /** The Zerops REST API Core reads with (`HQ_ZEROPS_API`). */
  readonly zeropsApi: string;
}): string {
  return [
    "project:",
    `  name: ${HQ_PROJECT_NAME}`,
    "  tags:",
    `    - ${JSON.stringify(HQ_PROJECT_TAG)}`,
    `    - ${JSON.stringify(input.birthTag)}`,
    "services:",
    "  - hostname: db",
    "    type: postgresql:single@18",
    "    mode: NON_HA",
    "  - hostname: vol",
    "    type: local-storage:single@1",
    "  - hostname: backup",
    "    type: objectstorage",
    "    objectStorageSize: 80",
    "    objectStoragePolicy: private",
    `  - hostname: ${HQ_SERVICE}`,
    "    type: nodejs@24",
    "    startWithoutCode: true",
    "    minContainers: 1",
    "    maxContainers: 1",
    "    verticalAutoscaling:",
    "      minRam: 0.5",
    "    envSecrets:",
    `      HQ_CLIENT_ORIGINS: ${JSON.stringify([...new Set(input.origins)].join(","))}`,
    `      HQ_ZEROPS_API: ${JSON.stringify(input.zeropsApi)}`,
    // The bucket's own variables, by reference: Core's backup reads them (apps/hq bucketStore.ts).
    "      HQ_BACKUP_URL: ${backup_apiUrl}",
    "      HQ_BACKUP_KEY_ID: ${backup_accessKeyId}",
    "      HQ_BACKUP_SECRET: ${backup_secretAccessKey}",
    "      HQ_BACKUP_BUCKET: ${backup_bucketName}",
    "      HQ_BACKUP_QUOTA_GB: ${backup_quotaGBytes}",
    "",
  ].join("\n");
}

export async function runHqBirth(input: {
  readonly record: HqBirthRecord;
  readonly clientId: string;
  readonly origins: ReadonlyArray<string>;
  readonly zeropsApi: string;
  readonly deps: HqBirthDeps;
  /** Told of each step's result, so a *Try again* resumes from it. */
  readonly moved: (patch: Partial<HqBirthRecord>) => void;
}): Promise<HqBirthOutcome> {
  const { clientId, deps } = input;
  const { platform } = deps;
  const waits = { ...HQ_BIRTH_WAITS, ...deps.waits };
  let record = input.record;
  const advance = (patch: Partial<HqBirthRecord>) => {
    record = { ...record, ...patch };
    input.moved(patch);
  };
  // The domain is routed to Core's HTTP port, which Core's deploy opens: a record at the domain
  // with no deploy behind it gives Core its access and deploys it first.
  if (record.step === "domain" && record.deployProcessId === null) advance({ step: "credential" });

  /** Polls `probe` until it answers, or stops once `capMs` has passed. */
  const waitFor = async <T>(capMs: number, what: string, probe: () => Promise<T | undefined>) => {
    const startedAt = deps.now();
    for (;;) {
      const value = await probe();
      if (value !== undefined) return value;
      if (deps.now() - startedAt >= capMs) throw new BirthStopped(`${what} took too long.`);
      await deps.sleep(waits.pollMs);
    }
  };

  /**
   * `call`, again while Zerops refuses it for the service's variables still syncing: waits twice as
   * long each time, up to {@link SYNC_BACKOFF_MAX_MS}, and stops once `capMs` has passed. Any other
   * refusal stops at once, in its own words.
   */
  const afterVariablesSync = async <T>(capMs: number, call: () => Promise<T>): Promise<T> => {
    const startedAt = deps.now();
    let backoffMs = waits.pollMs;
    for (;;) {
      try {
        return await call();
      } catch (cause) {
        if (!(cause instanceof ZeropsApiError && cause.code === VARIABLES_SYNCING)) throw cause;
        if (deps.now() - startedAt >= capMs) {
          throw new BirthStopped("Zerops was still syncing HQ's variables. Try again in a minute.");
        }
        await deps.sleep(backoffMs);
        backoffMs = Math.min(backoffMs * 2, SYNC_BACKOFF_MAX_MS);
      }
    }
  };

  /** Anchors naming a project but this one stop the birth: two HQs are none. */
  const assertNoOtherHq = async (own: string | null) => {
    const found = findOfficialHq(await platform.listOrganizationMembers(clientId));
    const others =
      found.kind === "official"
        ? [found.projectId]
        : found.kind === "unclear"
          ? found.projectIds
          : [];
    if (others.some((projectId) => projectId !== own)) {
      throw new BirthStopped("This organization has an HQ already.");
    }
  };

  /**
   * A `Headquarters` project no anchor names yet stops a birth from nothing: it is one being set up
   * elsewhere, or one whose setup stopped, and a second import would make two.
   */
  const assertNoHqUnderway = async () => {
    const underway = (await platform.listClientProjects(clientId)).find(
      (project) =>
        !GONE_PROJECT_STATUSES.has(project.status) &&
        (project.tagList ?? []).includes(HQ_PROJECT_TAG),
    );
    if (underway !== undefined) {
      throw new BirthStopped(
        `This organization has a Headquarters project already (${underway.id}) that is not its HQ yet: HQ is being set up elsewhere, or a setup stopped. Finish it where it started, or delete that project in Zerops and try again.`,
      );
    }
  };

  try {
    /** The one project carrying the birth's tag `tag`; or a stop where none, or more, stand. */
    const importedBy = async (tag: string) => {
      const made = (await platform.listClientProjects(clientId)).filter(
        (project) =>
          !GONE_PROJECT_STATUSES.has(project.status) &&
          (project.tagList ?? []).includes(HQ_PROJECT_TAG) &&
          (project.tagList ?? []).includes(tag),
      );
      if (made.length !== 1) throw new ImportUnanswered(IMPORT_UNANSWERED);
      return made[0]!.id;
    };

    if (record.step === "project") {
      const sent = record.importTag;
      if (sent !== null) {
        advance({ step: "services", projectId: await importedBy(sent) });
      } else {
        await assertNoOtherHq(null);
        await assertNoHqUnderway();
        const tag = hqBirthTag(deps.newBirthId());
        advance({ importTag: tag });
        const projectId = await platform
          .importProject(
            clientId,
            hqImportYaml({ birthTag: tag, origins: input.origins, zeropsApi: input.zeropsApi }),
          )
          .then(
            (imported) => imported.projectId,
            (cause: unknown) => {
              if (!refusedOutright(cause)) return importedBy(tag);
              // Nothing was made, and Try again imports.
              advance({ importTag: null });
              throw cause;
            },
          );
        advance({ step: "services", projectId });
      }
    }

    const projectId = record.projectId!;
    if (record.step === "services") {
      const hq = await waitFor(waits.servicesCapMs, "Starting HQ's services", async () => {
        const services = await platform.listProjectServices(projectId);
        const named = (name: string) => services.find((service) => service.name === name);
        const up = HQ_SERVICES.every((name) => named(name)?.status === "ACTIVE");
        return up ? named(HQ_SERVICE) : undefined;
      });
      advance({ step: "credential", serviceId: hq.id });
    }

    const serviceId = record.serviceId!;
    if (record.step === "credential") {
      const written = await platform.listServiceVariableNames(serviceId);
      if (!written.includes(HQ_ORG_TOKEN_ENV)) {
        const name = hqOrgTokenName(projectId);
        const held = (await platform.listIntegrationTokens(clientId)).filter(
          (token) => token.name === name,
        );
        if (held.length > 1) {
          throw new BirthStopped(`More than one token is named ${name}. Delete them in Zerops.`);
        }
        const content =
          held[0] === undefined
            ? (
                await platform.mintIntegrationToken({
                  clientId,
                  name,
                  roleCode: "READ_ONLY",
                  projects: [],
                })
              ).token
            : await platform.regenerateIntegrationToken({ clientId, tokenId: held[0].id });
        // The import's own variables may still sync: the write waits them out with the token held.
        await afterVariablesSync(waits.servicesCapMs, () =>
          platform.writeServiceSecret({ serviceId, key: HQ_ORG_TOKEN_ENV, content }),
        );
      }
      advance({ step: "deploy" });
    }

    if (record.step === "deploy") {
      if (record.deployProcessId === null) {
        const core = await deps.core();
        if (record.appVersionId === null) {
          const version = await platform.createAppVersion(serviceId, "hq-core");
          await platform.uploadAppVersionArchive(version.id, core.archive);
          advance({ appVersionId: version.id });
        }
        const appVersionId = record.appVersionId!;
        const { processId } = await afterVariablesSync(waits.deployCapMs, () =>
          platform.buildAndDeployAppVersion(appVersionId, {
            zeropsYaml: core.zeropsYaml,
            setup: HQ_SETUP,
          }),
        );
        advance({ deployProcessId: processId });
      }
      const processId = record.deployProcessId!;
      const status = await waitFor(waits.deployCapMs, "Deploying HQ", async () => {
        const read = await platform.readProcessStatus(processId);
        return read === "FINISHED" || read === "FAILED" || read === "CANCELED" ? read : undefined;
      });
      if (status !== "FINISHED") {
        // Try again uploads and deploys anew.
        advance({ deployProcessId: null, appVersionId: null });
        throw new BirthStopped("HQ's deploy did not finish. Its build log in Zerops says why.");
      }
      advance({ step: "domain" });
    }

    if (record.step === "domain") {
      const domain = await waitFor(
        waits.servicesCapMs,
        "HQ's domain",
        async () => (await platform.fetchProject(projectId)).publicZone,
      );
      /** The routing of the domain, with the domain's state in it. */
      const routed = async () => {
        for (const routing of await platform.listPublicHttpRoutings(projectId)) {
          const named = routing.domains.find((entry) => entry.domainName === domain);
          if (named !== undefined) return { routing, domain: named };
        }
        return undefined;
      };
      if ((await routed()) === undefined) {
        await platform.createPublicHttpRouting(projectId, {
          domains: [domain],
          locations: [{ path: "/", port: HQ_PORT, serviceStackId: serviceId }],
        });
      }
      if ((await routed())?.routing.isSynced !== true) {
        const { processId } = await platform.syncPublicHttpRouting(projectId);
        if (processId !== undefined) {
          const status = await waitFor(
            waits.domainCapMs,
            "Putting HQ's domain in place",
            async () => {
              const read = await platform.readProcessStatus(processId);
              return read === "FINISHED" || read === "FAILED" || read === "CANCELED"
                ? read
                : undefined;
            },
          );
          if (status !== "FINISHED") {
            throw new BirthStopped("Zerops could not put HQ's domain in place. Try again.");
          }
        }
      }
      let sslError: string | undefined;
      await waitFor(waits.domainCapMs, "HQ's certificate", async () => {
        const state = (await routed())?.domain;
        sslError = state?.sslError;
        return state?.sslStatus === "ACTIVE" ? true : undefined;
      }).catch((cause: unknown) => {
        throw sslError === undefined
          ? cause
          : new BirthStopped(`HQ's certificate for ${domain} is not ready: ${sslError}`);
      });
      advance({ step: "anchor", address: `https://${domain}` });
    }

    const address = record.address!;
    if (record.step === "anchor") {
      await assertNoOtherHq(projectId);
      const name = hqAnchorName(projectId, address);
      const tokens = await platform.listIntegrationTokens(clientId);
      if (!tokens.some((token) => token.name === name)) {
        // A mark in the member list, never a credential: its value goes nowhere.
        await platform.mintIntegrationToken({ clientId, name, roleCode: "ADMIN", projects: [] });
      }
      advance({ step: "ready" });
    }

    if (record.step === "ready") {
      await waitFor(waits.readyCapMs, "HQ answering as this organization's HQ", async () =>
        (await deps.health(address)).kind === "healthy" ? true : undefined,
      );
      advance({ step: "done" });
    }
    return { ok: true, hq: { projectId, address } };
  } catch (cause) {
    const step = record.step === "done" ? "ready" : record.step;
    return {
      ok: false,
      step,
      reason:
        cause instanceof Error && cause.message.length > 0
          ? cause.message
          : "Zerops could not be reached.",
      // Every later step reads what is there before it writes.
      uncertain: cause instanceof ImportUnanswered,
    };
  }
}

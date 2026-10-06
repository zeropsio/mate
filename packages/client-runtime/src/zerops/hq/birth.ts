/**
 * HQ starts automatically for an org admin. Its nascent project's plain env holds an append-only
 * journal, create-once action intents/receipts and expiring claims (birthJournal.ts). A browser
 * reads that journal before doing anything. Failed steps require Again; uncertain writes are
 * followed through their saved handles, never automatically replayed. Credential values go only
 * to HQ's sensitive service variables.
 */
import { ZeropsApiError, type ZeropsApiClient } from "../api.ts";
import type { RandomBytes } from "../newProject.ts";
import { findOfficialHq, hqAnchorName, hqOrgTokenName } from "./anchor.ts";
import type { HqEndpoint, HqHealth } from "./client.ts";
import {
  birthSnapshot,
  HQ_BIRTH_RECORD_KEY,
  HqBirthJournal,
  HqBirthUncertain,
  readBirthRecord,
} from "./birthJournal.ts";

export const HQ_PROJECT_NAME = "Headquarters";
/** A project on its way out, or out: nothing a birth counts. */
const GONE_PROJECT_STATUSES: ReadonlySet<string> = new Set(["DELETING", "DELETED"]);
/** Core's service: never `core`, every project's reserved system service. */
export const HQ_SERVICE = "hq";
const HQ_PORT = 8080;
const HQ_SERVICES = ["db", "vol", HQ_SERVICE] as const;
/** Core's working credential, as Core reads it (`apps/hq/src/main.ts`). */
const HQ_ORG_TOKEN_ENV = "HQ_ORG_TOKEN";
/** Core's key for its environments' deploy tokens, as Core reads it: an AES-256 key's 32 bytes. */
const HQ_KEY_SECRET_ENV = "HQ_KEY_SECRET";
const HQ_KEY_SECRET_BYTES = 32;
/** The `zerops.yml` entry Core deploys from (`apps/hq/zerops.yml`). */
export const HQ_SETUP = "hq";
/** The app version a birth or an update names after the Core it deploys (`update.ts`). */
export const HQ_CORE_VERSION_PREFIX = "hq-core.";

export function hqCoreVersionName(build: string): string {
  return `${HQ_CORE_VERSION_PREFIX}${build}`;
}
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
   * The bootstrap import's id, kept before its import is sent: from then on the import
   * is never sent again, and its seeded journal records it. Null before.
   */
  readonly importId: string | null;
  readonly projectId: string | null;
  /** The `hq` service. */
  readonly serviceId: string | null;
  /** Core's address, as its anchor names it. */
  readonly address: string | null;
  /** Core's app version, its archive uploaded: what the deploy builds, made once. */
  readonly appVersionId: string | null;
  /** The deploy Zerops took, followed until it ends. */
  readonly deployProcessId: string | null;
  readonly serviceIds?: Readonly<Record<string, string>>;
  readonly importProcessId?: string;
  readonly importProcesses?: Readonly<Record<string, string>>;
  readonly orgTokenId?: string;
  readonly anchorTokenId?: string;
  readonly routingId?: string;
  readonly syncProcessId?: string | null;
  readonly archiveUploaded?: boolean;
  readonly coreYaml?: string;
  readonly attempt?: number;
  readonly stopped?: {
    readonly step: HqBirthStep;
    readonly reason: string;
    readonly uncertain: boolean;
  } | null;
}

export const HQ_BIRTH_START: HqBirthRecord = {
  step: "project",
  importId: null,
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
  | "hasServiceVariable"
  | "writeServiceSecret"
  | "createAppVersion"
  | "uploadAppVersionArchive"
  | "buildAndDeployAppVersion"
  | "readProcessStatus"
  | "listPublicHttpRoutings"
  | "createPublicHttpRouting"
  | "syncPublicHttpRouting"
  | "readProjectBirthEnv"
  | "createProjectEnv"
  | "readProjectCreation"
>;

/** Core as this build of the app carries it (`hq-core/`). */
export interface HqCoreArtifact {
  /** Its identity (`hq-core/build.json`, `apps/hq/src/coreIdentity.ts`). */
  readonly build: string;
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
  /** A new bootstrap import or claim id. */
  readonly newBirthId: () => string;
  /** Draws HQ's key (`HQ_KEY_SECRET`): the platform's cryptographic randomness. */
  readonly randomBytes: RandomBytes;
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
  "Zerops did not confirm HQ's project. Press Again to find this setup's project; check Headquarters in Zerops before taking further action.";

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
  /** The bootstrap import's id. */
  readonly birthId: string;
  /** The Zerops REST API Core reads with (`HQ_ZEROPS_API`). */
  readonly zeropsApi: string;
}): string {
  return [
    "project:",
    `  name: ${HQ_PROJECT_NAME}`,
    "  envVariables:",
    `    ${HQ_BIRTH_RECORD_KEY}: ${JSON.stringify(birthSnapshot({ ...HQ_BIRTH_START, step: "services", importId: input.birthId }))}`,
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
  /** Explicit manual action; a fresh browser never retries a recorded failure. */
  readonly again?: boolean;
  readonly clientId: string;
  readonly zeropsApi: string;
  readonly deps: HqBirthDeps;
  /** Told of each step's result, so an *Again* resumes from it. */
  readonly moved: (patch: Partial<HqBirthRecord>) => void;
}): Promise<HqBirthOutcome> {
  const { clientId, deps } = input;
  const { platform } = deps;
  const waits = { ...HQ_BIRTH_WAITS, ...deps.waits };
  let record = input.record;
  let journal: HqBirthJournal | undefined;
  let importHandles: Partial<HqBirthRecord> = {};
  const advance = async (patch: Partial<HqBirthRecord>) => {
    record = { ...record, ...patch };
    if (journal !== undefined) await journal.save(record);
    input.moved(patch);
  };
  const effect = async (
    action: string,
    handles: Readonly<Record<string, string>>,
    call: () => Promise<Readonly<Record<string, string>>>,
  ) => {
    if (journal === undefined) throw new Error("HQ's setup journal is missing.");
    return journal.perform(action, record.attempt ?? 0, handles, call);
  };
  const waitFor = async <T>(capMs: number, what: string, probe: () => Promise<T | undefined>) => {
    const startedAt = deps.now();
    for (;;) {
      await journal?.assertOwned();
      const value = await probe();
      if (value !== undefined) return value;
      if (deps.now() - startedAt >= capMs) throw new BirthStopped(`${what} took too long.`);
      await deps.sleep(waits.pollMs);
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

  try {
    await assertNoOtherHq(record.projectId);
    if (record.projectId === null) {
      // HQ cannot keep records before it exists. The bootstrap journal is seeded by the
      // import and read by project id; its official identity comes only from the org anchor.
      const underway = [] as Array<{ project: { id: string }; record: HqBirthRecord }>;
      for (const project of await platform.listClientProjects(clientId)) {
        if (GONE_PROJECT_STATUSES.has(project.status)) continue;
        const shared = readBirthRecord(await platform.readProjectBirthEnv(project.id));
        if (shared !== undefined && shared.step !== "done")
          underway.push({ project, record: shared });
        else if (shared === undefined) {
          const services = await platform.listProjectServices(project.id);
          if (HQ_SERVICES.every((name) => services.some((service) => service.name === name))) {
            if (record.importId !== null) throw new ImportUnanswered(IMPORT_UNANSWERED);
            throw new BirthStopped(
              "Headquarters has no readable setup record. Ask an organization admin to inspect its project env in Zerops.",
            );
          }
        }
      }
      if (underway.length > 1)
        throw new BirthStopped(
          "More than one HQ project is being set up. Ask an organization admin to inspect Headquarters in Zerops.",
        );
      const found = underway[0];
      if (found !== undefined) {
        if (record.importId !== null && found.record.importId !== record.importId)
          throw new ImportUnanswered(IMPORT_UNANSWERED);
        record = { ...found.record, projectId: found.project.id };
        input.moved(record);
      } else if (record.importId !== null) {
        throw new ImportUnanswered(IMPORT_UNANSWERED);
      } else {
        const tag = deps.newBirthId();
        await advance({ importId: tag });
        // The project does not yet exist: its first record is embedded in this import itself.
        try {
          const imported = await platform.importProject(
            clientId,
            hqImportYaml({ birthId: tag, zeropsApi: input.zeropsApi }),
          );
          if (imported.serviceStacks !== undefined) {
            importHandles = {
              serviceIds: Object.fromEntries(
                imported.serviceStacks.map((service) => [service.name, service.id]),
              ),
              importProcesses: Object.fromEntries(
                imported.serviceStacks.flatMap((service) =>
                  service.processes.map((process) => [process.id, service.id]),
                ),
              ),
            };
          }
          await advance({ step: "services", projectId: imported.projectId, ...importHandles });
        } catch (cause) {
          if (refusedOutright(cause)) {
            await advance({ importId: null });
            throw cause;
          }
          // Follow the import's journal once; a missing answer never permits another import.
          const found = [] as Array<string>;
          for (const project of await platform.listClientProjects(clientId)) {
            if (GONE_PROJECT_STATUSES.has(project.status)) continue;
            const seed = readBirthRecord(await platform.readProjectBirthEnv(project.id));
            if (seed?.importId === tag) found.push(project.id);
          }
          if (found.length !== 1) throw new ImportUnanswered(IMPORT_UNANSWERED);
          await advance({ step: "services", projectId: found[0]! });
        }
      }
    }
    journal = new HqBirthJournal(record.projectId!, deps);
    const project = record.projectId!;
    record = {
      ...(await journal.acquire((shared) => input.moved({ ...shared, projectId: project }))),
      projectId: project,
    };
    if (record.stopped != null && !input.again) {
      await journal.release();
      return { ok: false, ...record.stopped };
    }
    if (input.again && record.stopped != null) {
      await advance({
        attempt: record.stopped.uncertain ? (record.attempt ?? 0) : (record.attempt ?? 0) + 1,
        stopped: null,
      });
    }
    await advance({ projectId: project, ...importHandles });
    if (record.step === "domain" && record.deployProcessId === null)
      await advance({ step: "credential" });

    const projectId = record.projectId!;
    if (record.step === "services") {
      const creation = await platform.readProjectCreation({ clientId, projectId });
      if (creation !== undefined) {
        await advance({ importProcessId: creation.processId });
        if (creation.status === "FAILED" || creation.status === "CANCELED") {
          throw new BirthStopped(
            `${creation.error?.message ?? "HQ's project creation failed"}. Inspect its creation process in Zerops, then press Again.`,
          );
        }
      }
      const hq = await waitFor(waits.servicesCapMs, "Starting HQ's services", async () => {
        if (record.importProcessId !== undefined) {
          const status = await platform.readProcessStatus(record.importProcessId);
          if (status === "FAILED" || status === "CANCELED") {
            const failedCreation = await platform.readProjectCreation({ clientId, projectId });
            const words =
              failedCreation?.processId === record.importProcessId
                ? failedCreation.error?.message
                : undefined;
            throw new BirthStopped(
              `${words ?? "HQ's project creation failed"}. Inspect its creation process in Zerops, then press Again.`,
            );
          }
        }
        let importsFinished = true;
        for (const processId of Object.keys(record.importProcesses ?? {})) {
          const status = await platform.readProcessStatus(processId);
          if (status === "FAILED" || status === "CANCELED") {
            throw new BirthStopped(
              `HQ's service import is ${status}. Inspect process ${processId} in Zerops, fix the cause, then press Again.`,
            );
          }
          if (status !== "FINISHED") importsFinished = false;
        }
        const services = await platform.listProjectServices(projectId);
        const ids = Object.fromEntries(services.map((service) => [service.name, service.id]));
        if (JSON.stringify(ids) !== JSON.stringify(record.serviceIds))
          await advance({ serviceIds: ids });
        const failed = services.find(
          (service) => service.status === "FAILED" || service.status === "CANCELED",
        );
        if (failed !== undefined)
          throw new BirthStopped(
            `HQ's ${failed.name} service is ${failed.status}. Inspect its import process in Zerops, then press Again.`,
          );
        const named = (name: string) => services.find((service) => service.name === name);
        const up = HQ_SERVICES.every((name) => named(name)?.status === "ACTIVE");
        return up && importsFinished ? named(HQ_SERVICE) : undefined;
      });
      const services = await platform.listProjectServices(projectId);
      await advance({
        step: "credential",
        serviceId: hq.id,
        serviceIds: Object.fromEntries(services.map((service) => [service.name, service.id])),
      });
    }

    const serviceId = record.serviceId!;
    if (record.step === "credential") {
      const holds = (key: string) => platform.hasServiceVariable({ clientId, serviceId, key });
      if (!(await holds(HQ_ORG_TOKEN_ENV))) {
        const name = hqOrgTokenName(projectId);
        const held = (await platform.listIntegrationTokens(clientId)).filter(
          (token) => token.name === name,
        );
        if (held.length > 1)
          throw new BirthStopped(`More than one token is named ${name}. Delete them in Zerops.`);
        let content: string | undefined;
        let tokenId = record.orgTokenId ?? held[0]?.id;
        if (tokenId === undefined) {
          const receipt = await effect("token", { projectId }, async () => {
            const token = await platform.mintIntegrationToken({
              clientId,
              name,
              roleCode: "READ_ONLY",
              projects: [],
            });
            content = token.token;
            return { tokenId: token.id };
          });
          tokenId = receipt.tokenId!;
        }
        await advance({ orgTokenId: tokenId });
        // A token value is one-time. After a browser closes before writing it, follow the saved
        // token id through one recorded regeneration, never mint another working token.
        if (content === undefined) {
          await effect("regenerate", { tokenId }, async () => {
            content = await platform.regenerateIntegrationToken({ clientId, tokenId });
            return { tokenId };
          });
        }
        if (content === undefined)
          throw new BirthStopped(
            "HQ's token value was lost before it was written. Press Again to regenerate its recorded token.",
          );
        const tokenValue = content;
        await effect("org_secret", { serviceId, tokenId }, async () => {
          await platform.writeServiceSecret({
            serviceId,
            key: HQ_ORG_TOKEN_ENV,
            content: tokenValue,
          });
          return { serviceId, tokenId };
        });
      }
      if (!(await holds(HQ_KEY_SECRET_ENV))) {
        await effect("key_secret", { serviceId }, async () => {
          const key = deps.randomBytes(new Uint8Array(HQ_KEY_SECRET_BYTES));
          await platform.writeServiceSecret({
            serviceId,
            key: HQ_KEY_SECRET_ENV,
            content: btoa(String.fromCharCode(...key)),
          });
          return { serviceId };
        });
      }
      await advance({ step: "deploy" });
    }

    if (record.step === "deploy") {
      if (record.deployProcessId === null) {
        const core =
          record.archiveUploaded !== true || record.coreYaml === undefined
            ? await deps.core()
            : undefined;
        if (core !== undefined) await advance({ coreYaml: core.zeropsYaml });
        if (record.appVersionId === null) {
          const name = hqCoreVersionName((core ?? (await deps.core())).build);
          const version = await effect("version", { serviceId }, async () => ({
            appVersionId: (await platform.createAppVersion(serviceId, name)).id,
          }));
          await advance({ appVersionId: version.appVersionId! });
        }
        const appVersionId = record.appVersionId!;
        if (record.archiveUploaded !== true) {
          await effect("upload", { appVersionId }, async () => {
            await platform.uploadAppVersionArchive(appVersionId, core!.archive);
            return { appVersionId };
          });
          await advance({ archiveUploaded: true });
        }
        const deployed = await effect("deploy", { appVersionId }, async () => ({
          processId: (
            await platform.buildAndDeployAppVersion(appVersionId, {
              zeropsYaml: record.coreYaml!,
              setup: HQ_SETUP,
            })
          ).processId,
        }));
        await advance({ deployProcessId: deployed.processId! });
      }
      const processId = record.deployProcessId!;
      const status = await waitFor(waits.deployCapMs, "Deploying HQ", async () => {
        const read = await platform.readProcessStatus(processId);
        return read === "FINISHED" || read === "FAILED" || read === "CANCELED" ? read : undefined;
      });
      if (status !== "FINISHED") {
        // Keep the version and the failed process receipt; only manual Again sends a new build.
        await advance({ deployProcessId: null });
        throw new BirthStopped(
          "HQ's deploy did not finish. Its build log in Zerops says why. Fix the cause, then press Again.",
        );
      }
      await advance({ step: "domain" });
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
        await effect("routing", { projectId, serviceId, domain }, async () => {
          await platform.createPublicHttpRouting(projectId, {
            domains: [domain],
            locations: [{ path: "/", port: HQ_PORT, serviceStackId: serviceId }],
          });
          return { projectId, serviceId, domain };
        });
      }
      const routing = await routed();
      if (routing !== undefined) await advance({ routingId: routing.routing.id });
      if (record.syncProcessId != null || routing?.routing.isSynced !== true) {
        const receipt =
          record.syncProcessId == null
            ? await effect(
                "routing_sync",
                { projectId },
                async (): Promise<Readonly<Record<string, string>>> => {
                  const synced = await platform.syncPublicHttpRouting(projectId);
                  return synced.processId === undefined
                    ? { projectId }
                    : { projectId, processId: synced.processId };
                },
              )
            : { processId: record.syncProcessId };
        const processId = receipt.processId;
        if (processId !== undefined) await advance({ syncProcessId: processId });
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
            await advance({ syncProcessId: null });
            throw new BirthStopped(
              "Zerops could not put HQ's domain in place. Inspect its sync process in Zerops, then press Again.",
            );
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
      await advance({ step: "anchor", address: `https://${domain}` });
    }

    const address = record.address!;
    if (record.step === "anchor") {
      await assertNoOtherHq(projectId);
      const name = hqAnchorName(projectId, address);
      const tokens = await platform.listIntegrationTokens(clientId);
      if (!tokens.some((token) => token.name === name)) {
        // A mark in the member list, never a credential: its value goes nowhere.
        const receipt = await effect("anchor", { projectId, address }, async () => ({
          tokenId: (
            await platform.mintIntegrationToken({ clientId, name, roleCode: "ADMIN", projects: [] })
          ).id,
        }));
        await advance({ anchorTokenId: receipt.tokenId! });
      }
      await advance({ step: "ready" });
    }

    if (record.step === "ready") {
      await waitFor(waits.readyCapMs, "HQ answering as this organization's HQ", async () =>
        (await deps.health(address)).kind === "healthy" ? true : undefined,
      );
      await advance({ step: "done" });
    }
    await journal.release();
    return { ok: true, hq: { projectId, address } };
  } catch (cause) {
    const step = record.step === "done" ? "ready" : record.step;
    const words =
      cause instanceof Error && cause.message.length > 0
        ? cause.message
        : "Zerops could not be reached.";
    // Service-secret writes return no sync handle. A definite sync refusal ends this attempt;
    // the journal keeps the uploaded version and only the gate's Again continues setup.
    const reason =
      cause instanceof ZeropsApiError && cause.code === "userDataSyncRunning"
        ? "Variables still syncing. Press Again to continue HQ's setup."
        : /credit/iu.test(`${cause instanceof ZeropsApiError ? (cause.code ?? "") : ""} ${words}`)
          ? `${words}. Ask an organization owner to add credit in Zerops, then press Again.`
          : cause instanceof ZeropsApiError && cause.kind === "forbidden"
            ? `${words}. Ask an organization owner to restore your access in Zerops, then press Again.`
            : words;
    const uncertain =
      cause instanceof ImportUnanswered ||
      cause instanceof HqBirthUncertain ||
      (cause instanceof ZeropsApiError && (cause.kind === "uncertain" || cause.kind === "network"));
    const stopped = { step, reason, uncertain };
    try {
      await advance({ stopped });
      await journal?.release();
    } catch {
      // Lost ownership or an unconfirmed journal write must never authorize another side effect.
    }
    return { ok: false, ...stopped };
  }
}

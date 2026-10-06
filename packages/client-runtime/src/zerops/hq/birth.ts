/**
 * HQ starts automatically for an org admin. HQ cannot execute its own birth: each write it makes is
 * the account's Zerops operation (`data/operations/hqBirth.ts`, the import, HQ's update for its
 * Core), run to its end; each wait is on Zerops's facts in the account's store (`hqBirthWaits`),
 * never on a clock. Its nascent project's plain env holds the birth's journal — an append-only
 * record, create-once intents and receipts, and a lease on who goes on (`birthJournal.ts`) — read
 * before anything is done, so a birth stopped in one browser goes on in another without sending a
 * write twice. Failed steps require Again; uncertain writes are followed through their saved
 * handles, never automatically replayed. Credential values go only to HQ's sensitive service
 * variables.
 */
import type { HqBirthReads } from "../../data/operations/executors/hqBirthReads.ts";
import type { RunToEnd } from "../../data/operations/runToEnd.ts";
import type { HqBirthWaits } from "../../data/hqBirthWaits.ts";
import { ZeropsApiError } from "../api.ts";
import type { HqEndpoint } from "./client.ts";
import {
  birthSnapshot,
  HQ_BIRTH_RECORD_KEY,
  HqBirthJournal,
  HqBirthUncertain,
} from "./birthJournal.ts";

export const HQ_PROJECT_NAME = "Headquarters";
/** Core's service: never `core`, every project's reserved system service. */
export const HQ_SERVICE = "hq";
export const HQ_PORT = 8080;
/** Core's working credential, as Core reads it (`apps/hq/src/main.ts`). */
export const HQ_ORG_TOKEN_ENV = "HQ_ORG_TOKEN";
/** Core's key for its environments' deploy tokens, as Core reads it: an AES-256 key's 32 bytes. */
export const HQ_KEY_SECRET_ENV = "HQ_KEY_SECRET";
export const HQ_KEY_SECRET_BYTES = 32;
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
  /**
   * The step to run next; `done` once HQ is marked the official one, for the member list to name
   * it.
   */
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
  /** The deploy Zerops took, followed until it ends. */
  readonly deployProcessId: string | null;
  readonly serviceIds?: Readonly<Record<string, string>>;
  readonly orgTokenId?: string;
  readonly anchorTokenId?: string;
  /** The sync that puts HQ's domain in place, followed until it ends. */
  readonly syncProcessId?: string | null;
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
  deployProcessId: null,
};

/** Core as this build of the app carries it (`hq-core/`). */
export interface HqCoreArtifact {
  /** Its identity (`hq-core/build.json`, `apps/hq/src/coreIdentity.ts`). */
  readonly build: string;
  readonly archive: Uint8Array<ArrayBuffer>;
  readonly zeropsYaml: string;
}

/** What a birth acts through: the account's operations, its facts, and the journal's reads. */
export interface HqBirthDeps {
  /** Each write, as the account's operation run to its end. */
  readonly run: RunToEnd;
  /** What Zerops says besides the account's facts, read executor-side. */
  readonly reads: HqBirthReads;
  readonly waits: HqBirthWaits;
  /** The journal's claim, a lease. */
  readonly now: () => number;
  /** A new bootstrap import or claim id. */
  readonly newBirthId: () => string;
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

/** What a write says where its end can no longer be followed: it may have landed. */
const WRITE_UNFOLLOWED =
  "Zerops may have taken this step, but it can no longer be followed here. Press Again to read its recorded progress.";

const uncertainOf = (cause: unknown) =>
  cause instanceof ZeropsApiError && (cause.kind === "uncertain" || cause.kind === "network");

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
  const { clientId: orgId, deps } = input;
  const { reads, run, waits } = deps;
  let record = input.record;
  let journal: HqBirthJournal | undefined;
  const advance = async (patch: Partial<HqBirthRecord>) => {
    record = { ...record, ...patch };
    if (journal !== undefined) await journal.save(record);
    input.moved(patch);
  };
  const ran = { orgId, unobserved: WRITE_UNFOLLOWED };
  /** A write's result once Zerops took it; what follows it is the birth's own wait. */
  const taken = <Result>(
    write: (accepted: (result: Result) => void) => Promise<unknown>,
  ): Promise<Result> =>
    new Promise((resolve, reject) => {
      write(resolve).catch(reject);
    });
  const performed = (
    action: string,
    handles: Readonly<Record<string, string>>,
    call: () => Promise<Readonly<Record<string, string>>>,
  ) => {
    if (journal === undefined) throw new Error("HQ's setup journal is missing.");
    return journal.perform(action, record.attempt ?? 0, handles, call);
  };

  /** Anchors naming a project but this one stop the birth: two HQs are none. */
  const assertNoOtherHq = async (own: string | null) => {
    const found = await reads.markedHq(orgId);
    const marked =
      found.kind === "official"
        ? [found.projectId]
        : found.kind === "unclear"
          ? found.projectIds
          : [];
    if (marked.some((projectId) => projectId !== own))
      throw new BirthStopped("This organization has an HQ already.");
  };

  try {
    await assertNoOtherHq(record.projectId);
    if (record.projectId === null) {
      // HQ cannot keep records before it exists. The bootstrap journal is seeded by the
      // import and read by project id; its official identity comes only from the org anchor.
      const { underway, unrecorded } = await reads.births(orgId);
      if (unrecorded) {
        if (record.importId !== null) throw new ImportUnanswered(IMPORT_UNANSWERED);
        throw new BirthStopped(
          "Headquarters has no readable setup record. Ask an organization admin to inspect its project env in Zerops.",
        );
      }
      if (underway.length > 1)
        throw new BirthStopped(
          "More than one HQ project is being set up. Ask an organization admin to inspect Headquarters in Zerops.",
        );
      const found = underway[0];
      if (found !== undefined) {
        if (record.importId !== null && found.record.importId !== record.importId)
          throw new ImportUnanswered(IMPORT_UNANSWERED);
        record = { ...found.record, projectId: found.projectId };
        input.moved(record);
      } else if (record.importId !== null) {
        throw new ImportUnanswered(IMPORT_UNANSWERED);
      } else {
        const tag = deps.newBirthId();
        await advance({ importId: tag });
        // The project does not yet exist: its first record is embedded in this import itself.
        try {
          const { projectId } = await run(
            {
              kind: "import-project",
              orgId,
              name: HQ_PROJECT_NAME,
              yaml: hqImportYaml({ birthId: tag, zeropsApi: input.zeropsApi }),
            },
            { orgId, unobserved: IMPORT_UNANSWERED },
          );
          await advance({ step: "services", projectId });
        } catch (cause) {
          if (!uncertainOf(cause)) {
            await advance({ importId: null });
            throw cause;
          }
          // Follow the import's journal once; a missing answer never permits another import.
          const seeded = (await reads.births(orgId)).underway.filter(
            (birth) => birth.record.importId === tag,
          );
          if (seeded.length !== 1) throw new ImportUnanswered(IMPORT_UNANSWERED);
          await advance({ step: "services", projectId: seeded[0]!.projectId });
        }
      }
    }
    const projectId = record.projectId!;
    // Its services come up, and its seeded journal is in its env, once its imports ended.
    const up =
      record.step === "services" && (record.stopped == null || input.again === true)
        ? await waits.untilServices(orgId, projectId)
        : null;
    journal = new HqBirthJournal(projectId, {
      read: reads.journal,
      append: (journalProject, key, content) =>
        run(
          { kind: "hq-birth-note", orgId, projectId: journalProject, key, content },
          {
            orgId,
            unobserved:
              "Zerops did not confirm HQ's setup record. Press Again to follow its recorded progress.",
          },
        ),
      now: deps.now,
      newId: deps.newBirthId,
    });
    const shared = await journal.acquire((read) => input.moved({ ...read, projectId }));
    if (record.importId !== null && shared.importId !== record.importId)
      throw new ImportUnanswered(IMPORT_UNANSWERED);
    record = { ...shared, projectId };
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
    if (record.step === "domain" && record.deployProcessId === null)
      await advance({ step: "credential" });

    if (record.step === "services") {
      const services = up ?? (await waits.untilServices(orgId, projectId));
      await advance({
        step: "credential",
        serviceId: services.serviceId,
        serviceIds: services.serviceIds,
      });
    }

    const serviceId = record.serviceId!;
    if (record.step === "credential") {
      const token = await performed("org_token", { projectId, serviceId }, async () => {
        const { tokenId } = await run({ kind: "hq-org-token", orgId, projectId, serviceId }, ran);
        return tokenId === null ? {} : { tokenId };
      });
      if (token.tokenId !== undefined) await advance({ orgTokenId: token.tokenId });
      await performed("key_secret", { serviceId }, async () => {
        await run({ kind: "hq-key-secret", orgId, serviceId }, ran);
        return { serviceId };
      });
      await advance({ step: "deploy" });
    }

    if (record.step === "deploy") {
      if (record.deployProcessId === null) {
        // Recorded the moment Zerops takes it: another browser follows the same build.
        const deployed = await performed("deploy", { serviceId }, () =>
          taken<{ readonly processId: string }>((accepted) =>
            run(
              { kind: "hq-update", orgId, projectId, serviceId, running: "" },
              { ...ran, accepted },
            ),
          ),
        );
        await advance({ deployProcessId: deployed.processId! });
      }
      const status = await waits.untilProcessEnds(orgId, projectId, record.deployProcessId!);
      if (status !== "FINISHED") {
        // Only manual Again sends a new build.
        await advance({ deployProcessId: null });
        throw new BirthStopped(
          "HQ's deploy did not finish. Its build log in Zerops says why. Fix the cause, then press Again.",
        );
      }
      await advance({ step: "domain" });
    }

    if (record.step === "domain") {
      const domain = await waits.untilZone(orgId, projectId);
      if (record.syncProcessId == null) {
        const routed = await performed("routing", { projectId, serviceId, domain }, () =>
          taken<{ readonly processId: string | null }>((accepted) =>
            run(
              { kind: "route-hq-domain", orgId, projectId, serviceId, domain },
              { ...ran, accepted },
            ),
          ).then(({ processId }) =>
            processId === null ? { projectId } : { projectId, processId },
          ),
        );
        if (routed.processId !== undefined) await advance({ syncProcessId: routed.processId });
      }
      if (record.syncProcessId != null) {
        const status = await waits.untilProcessEnds(orgId, projectId, record.syncProcessId);
        if (status !== "FINISHED") {
          await advance({ syncProcessId: null });
          throw new BirthStopped(
            "Zerops could not put HQ's domain in place. Inspect its sync process in Zerops, then press Again.",
          );
        }
      }
      await advance({ step: "anchor", address: `https://${domain}` });
    }

    const address = record.address!;
    if (record.step === "anchor") {
      const marked = await performed("anchor", { projectId, address }, async () => ({
        tokenId: (await run({ kind: "mark-official-hq", orgId, projectId, address }, ran)).tokenId,
      }));
      await advance({ step: "ready", anchorTokenId: marked.tokenId! });
    }

    // HQ answers as the official one once the member list names it: the gate reads it again.
    if (record.step === "ready") await advance({ step: "done" });
    await journal.release();
    return { ok: true, hq: { projectId, address } };
  } catch (cause) {
    const step = record.step === "done" ? "ready" : record.step;
    const words =
      cause instanceof Error && cause.message.length > 0
        ? cause.message
        : "Zerops could not be reached.";
    const reason = /credit/iu.test(
      `${cause instanceof ZeropsApiError ? (cause.code ?? "") : ""} ${words}`,
    )
      ? `${words}. Ask an organization owner to add credit in Zerops, then press Again.`
      : words;
    const uncertain =
      cause instanceof ImportUnanswered || cause instanceof HqBirthUncertain || uncertainOf(cause);
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

/**
 * The birth of an organization's HQ (SPEC §3.1, §6.2.1), run by an org Owner or Admin's client:
 * the HQ project, its anchor and working credential, and Core deployed from the build the client
 * itself came with.
 *
 * Seven steps, each reading what is there before it writes:
 *
 * 1. `project` — the HQ project from an import: `hq` (Core; never `core`, every project's reserved
 *    system service, T0 §4), `db` and `vol`, named `Headquarters` as the Gitea project was, tagged
 *    `mate:hq` for the Zerops GUI alone. Never while the member list names an HQ already.
 * 2. `services` — the three services up.
 * 3. `domain` — HQ's address is its project's own domain (`publicZone`), the one Core names itself
 *    by: a routing of it to Core's port with SSL, the project's routings synced, and its
 *    certificate active (about ten seconds, measured on the rig 2026-10-02). An address that never
 *    serves over HTTPS stops here, with the platform's reason.
 * 4. `anchor` — `mate-hq:<projectId>:<address>`, org Admin, its value dropped at once: the mark
 *    that makes this HQ the official one (`anchor.ts`). Never while an anchor names another one.
 * 5. `credential` — `mate-hq-org:<projectId>`, org Read only and nothing else, written as the
 *    sensitive `HQ_ORG_TOKEN` of `hq`. A token's value is shown once: a token whose variable is
 *    missing is regenerated; a variable that is there is never written again.
 * 6. `deploy` — Core's archive and `zerops.yml` (`core`), as an app version built and deployed.
 * 7. `ready` — `/health` answering `official: ok` and `state: active`, which follows the anchor
 *    within Core's 30 s recheck.
 *
 * The **record** (`HqBirthRecord`) is what a step leaves for the next, and what *Try again* — or a
 * reload, where the client keeps it — resumes from: a step that stopped runs again, the ones
 * before it do not. The import is marked asked before it is sent. One whose answer was lost, or
 * never read because the page went away, is never sent again — that could make a second project:
 * its project is taken up only where the organization's process history names exactly one
 * `Headquarters` created by this person since it was asked (P-10); otherwise the birth stops
 * `uncertain`. No project is ever taken for HQ's by its name or its tag alone.
 *
 * Pure of platform globals (rule R1): the platform, Core's artifact, the health read, the clock
 * and the sleeps are passed in.
 *
 * @module hq/birth
 */
import { ZeropsApiError, type ZeropsApiClient } from "../api.ts";
import type { ZeropsProjectCreationRecord } from "../projectCreation.ts";
import { findOfficialHq, hqAnchorName, hqOrgTokenName } from "./anchor.ts";
import type { HqEndpoint, HqHealth } from "./client.ts";

export const HQ_PROJECT_NAME = "Headquarters";
/** For the Zerops GUI only: the official HQ is the one its anchor names, never a tag. */
export const HQ_PROJECT_TAG = "mate:hq";
const HQ_SERVICE = "hq";
const HQ_PORT = 8080;
const HQ_SERVICES = ["db", "vol", HQ_SERVICE] as const;
/** Core's working credential, as Core reads it (`apps/hq/src/main.ts`). */
const HQ_ORG_TOKEN_ENV = "HQ_ORG_TOKEN";
/** The `zerops.yml` entry Core deploys from (`apps/hq/zerops.yml`). */
const HQ_SETUP = "hq";

export type HqBirthStep =
  | "project"
  | "services"
  | "domain"
  | "anchor"
  | "credential"
  | "deploy"
  | "ready";

export const HQ_BIRTH_STEPS: ReadonlyArray<HqBirthStep> = [
  "project",
  "services",
  "domain",
  "anchor",
  "credential",
  "deploy",
  "ready",
];

/** What each step is doing, as its line says while it runs and names it when it stops. */
export const HQ_BIRTH_DOING: Readonly<Record<HqBirthStep, string>> = {
  project: "Creating HQ's project",
  services: "Starting HQ's services",
  domain: "Giving HQ its address",
  anchor: "Marking it this organization's HQ",
  credential: "Giving HQ its access",
  deploy: "Deploying HQ",
  ready: "Waiting for HQ to answer",
};

/** What a birth has made so far. */
export interface HqBirthRecord {
  /** The step to run next; `done` once HQ answered as the official one. */
  readonly step: HqBirthStep | "done";
  /**
   * When the import was sent (wall ms) while its answer is not read: the project may stand,
   * unknown to this birth. Null otherwise.
   */
  readonly importAskedAt: number | null;
  readonly projectId: string | null;
  /** The `hq` service. */
  readonly serviceId: string | null;
  /** Core's address, as its anchor names it. */
  readonly address: string | null;
  /** The deploy Zerops took, followed until it ends. */
  readonly deployProcessId: string | null;
}

export const HQ_BIRTH_START: HqBirthRecord = {
  step: "project",
  importAskedAt: null,
  projectId: null,
  serviceId: null,
  address: null,
  deployProcessId: null,
};

/** The platform calls a birth makes, as the account's client offers them. */
export type HqBirthPlatform = Pick<
  ZeropsApiClient,
  | "listProjectCreations"
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
  "Zerops did not confirm HQ's project, and its history shows no Headquarters of yours made since. Try again in a moment; before starting over, look for a Headquarters project in Zerops and delete it.";

/** How far the browser's clock may run ahead of the platform's. */
const CLOCK_SLACK_MS = 2 * 60_000;

/**
 * The project an unanswered import made: the one `Headquarters` the process history names as
 * created by this person since the import was asked — none where it names none, or more.
 */
export function importedHqProject(input: {
  readonly creations: ReadonlyArray<ZeropsProjectCreationRecord>;
  readonly userId: string | undefined;
  readonly askedAt: number;
}): string | undefined {
  if (input.userId === undefined) return undefined;
  const made = input.creations.filter(
    (creation) =>
      creation.projectName === HQ_PROJECT_NAME &&
      creation.createdByUserId === input.userId &&
      creation.createdAt >= input.askedAt - CLOCK_SLACK_MS,
  );
  return made.length === 1 ? made[0]?.projectId : undefined;
}

/** HQ's import: Core, its Postgres and its volume, and the variables Core reads besides its token. */
export function hqImportYaml(input: {
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
    "services:",
    "  - hostname: db",
    "    type: postgresql:single@18",
    "    mode: NON_HA",
    "  - hostname: vol",
    "    type: local-storage:single@1",
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
    "",
  ].join("\n");
}

export async function runHqBirth(input: {
  readonly record: HqBirthRecord;
  readonly clientId: string;
  /** The person bearing it: an unanswered import's project is theirs alone to take up. */
  readonly userId: string | undefined;
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
    /** The project an import asked at `askedAt` made, from the process history; or a stop. */
    const takeUpImport = async (askedAt: number) => {
      const projectId = importedHqProject({
        creations: await platform.listProjectCreations(clientId),
        userId: input.userId,
        askedAt,
      });
      if (projectId === undefined) throw new ImportUnanswered(IMPORT_UNANSWERED);
      return projectId;
    };

    if (record.step === "project") {
      const asked = record.importAskedAt;
      if (asked !== null) {
        advance({ step: "services", importAskedAt: null, projectId: await takeUpImport(asked) });
      } else {
        await assertNoOtherHq(null);
        const askedAt = deps.now();
        advance({ importAskedAt: askedAt });
        const projectId = await platform
          .importProject(
            clientId,
            hqImportYaml({ origins: input.origins, zeropsApi: input.zeropsApi }),
          )
          .then(
            (imported) => imported.projectId,
            (cause: unknown) => {
              if (cause instanceof ZeropsApiError && cause.kind === "uncertain") {
                return takeUpImport(askedAt);
              }
              // Refused outright: nothing was made, and Try again imports.
              advance({ importAskedAt: null });
              throw cause;
            },
          );
        advance({ step: "services", importAskedAt: null, projectId });
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
      advance({ step: "domain", serviceId: hq.id });
    }

    const serviceId = record.serviceId!;
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
      advance({ step: "credential" });
    }

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
        await platform.writeServiceSecret({ serviceId, key: HQ_ORG_TOKEN_ENV, content });
      }
      advance({ step: "deploy" });
    }

    if (record.step === "deploy") {
      if (record.deployProcessId === null) {
        const core = await deps.core();
        const version = await platform.createAppVersion(serviceId, "hq-core");
        await platform.uploadAppVersionArchive(version.id, core.archive);
        const { processId } = await platform.buildAndDeployAppVersion(version.id, {
          zeropsYaml: core.zeropsYaml,
          setup: HQ_SETUP,
        });
        advance({ deployProcessId: processId });
      }
      const processId = record.deployProcessId!;
      const status = await waitFor(waits.deployCapMs, "Deploying HQ", async () => {
        const read = await platform.readProcessStatus(processId);
        return read === "FINISHED" || read === "FAILED" || read === "CANCELED" ? read : undefined;
      });
      if (status !== "FINISHED") {
        // Try again deploys anew.
        advance({ deployProcessId: null });
        throw new BirthStopped("HQ's deploy did not finish. Its build log in Zerops says why.");
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

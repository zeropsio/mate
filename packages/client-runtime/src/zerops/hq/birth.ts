/**
 * The birth of an organization's HQ (SPEC §3.1, §6.2.1), run by an org Owner or Admin's client:
 * the HQ project, its anchor and working credential, and Core deployed from the build the client
 * itself came with.
 *
 * Six steps, each reading what is there before it writes:
 *
 * 1. `project` — the HQ project from an import: `hq` (Core; never `core`, every project's reserved
 *    system service, T0 §4), `db` and `vol`, named `Headquarters` as the Gitea project was, tagged
 *    `mate:hq` for the Zerops GUI alone. Never while the member list names an HQ already.
 * 2. `services` — the three services up, Core's subdomain published, and Core's address from the
 *    project (`https://hq-<zeropsSubdomainHost>-8080.<region>.zerops.app`, equal to the
 *    `zeropsSubdomain` Core reads; measured on the rig 2026-10-02). Core reads that address once,
 *    at its start, so the subdomain is on before Core is deployed where the platform allows it.
 * 3. `anchor` — `mate-hq:<projectId>:<address>`, org Admin, its value dropped at once: the mark
 *    that makes this HQ the official one (`anchor.ts`). Never while an anchor names another one.
 * 4. `credential` — `mate-hq-org:<projectId>`, org Read only and nothing else, written as the
 *    sensitive `HQ_ORG_TOKEN` of `hq`. A token's value is shown once: a token whose variable is
 *    missing is regenerated; a variable that is there is never written again.
 * 5. `deploy` — Core's archive and `zerops.yml` (`core`), as an app version built and deployed;
 *    then, where the platform would not publish the subdomain before there was code, it is
 *    published now and Core restarted, to start again with its address.
 * 6. `ready` — `/health` answering `official: ok` and `state: active`, which follows the anchor
 *    within Core's 30 s recheck.
 *
 * The **record** (`HqBirthRecord`) is what a step leaves for the next, and what *Try again*
 * resumes from: a step that stopped runs again, the ones before it do not. A creation the platform
 * may have carried out though its answer was lost stops `uncertain`, since running it again could
 * make a second project.
 *
 * Pure of platform globals (rule R1): the platform, Core's artifact, the health read, the clock
 * and the sleeps are passed in.
 *
 * @module hq/birth
 */
import { ZeropsApiError, type ZeropsApiClient } from "../api.ts";
import { zeropsRegionFromPublicZone } from "../containerAddress.ts";
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

export type HqBirthStep = "project" | "services" | "anchor" | "credential" | "deploy" | "ready";

export const HQ_BIRTH_STEPS: ReadonlyArray<HqBirthStep> = [
  "project",
  "services",
  "anchor",
  "credential",
  "deploy",
  "ready",
];

/** What each step is doing, as its line says while it runs and names it when it stops. */
export const HQ_BIRTH_DOING: Readonly<Record<HqBirthStep, string>> = {
  project: "Creating HQ's project",
  services: "Starting HQ's services",
  anchor: "Marking it this organization's HQ",
  credential: "Giving HQ its access",
  deploy: "Deploying HQ",
  ready: "Waiting for HQ to answer",
};

/** What a birth has made so far. */
export interface HqBirthRecord {
  /** The step to run next; `done` once HQ answered as the official one. */
  readonly step: HqBirthStep | "done";
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
  projectId: null,
  serviceId: null,
  address: null,
  deployProcessId: null,
};

/** The platform calls a birth makes, as the account's client offers them. */
export type HqBirthPlatform = Pick<
  ZeropsApiClient,
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
  | "enableSubdomainAccess"
  | "restartService"
>;

/** Core as this build of the app carries it (`hq-core/`). */
export interface HqCoreArtifact {
  readonly archive: Uint8Array<ArrayBuffer>;
  readonly zeropsYaml: string;
}

export interface HqBirthWaits {
  readonly pollMs: number;
  readonly servicesCapMs: number;
  readonly deployCapMs: number;
  readonly readyCapMs: number;
}

/** The import takes about a minute, a deploy about one (T0 §3, §4); both get ten times that. */
export const HQ_BIRTH_WAITS: HqBirthWaits = {
  pollMs: 3_000,
  servicesCapMs: 10 * 60_000,
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
    "    enableSubdomainAccess: true",
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
    if (record.step === "project") {
      await assertNoOtherHq(null);
      const { projectId } = await platform.importProject(
        clientId,
        hqImportYaml({ origins: input.origins, zeropsApi: input.zeropsApi }),
      );
      advance({ step: "services", projectId });
    }

    const projectId = record.projectId!;
    if (record.step === "services") {
      const hq = await waitFor(waits.servicesCapMs, "Starting HQ's services", async () => {
        const services = await platform.listProjectServices(projectId);
        const named = (name: string) => services.find((service) => service.name === name);
        const up = HQ_SERVICES.every((name) => named(name)?.status === "ACTIVE");
        return up ? named(HQ_SERVICE) : undefined;
      });
      const serviceId = hq.id;
      if (hq.subdomainAccess !== true) {
        // A service with no code yet may refuse it: the deploy step publishes it then.
        await platform.enableSubdomainAccess(serviceId).then(
          () => "published",
          () => "after the deploy",
        );
      }
      const address = await waitFor(waits.servicesCapMs, "HQ's address", async () => {
        const project = await platform.fetchProject(projectId);
        const region =
          project.publicZone === undefined ? null : zeropsRegionFromPublicZone(project.publicZone);
        return project.zeropsSubdomainHost === undefined || region === null
          ? undefined
          : `https://${HQ_SERVICE}-${project.zeropsSubdomainHost}-${HQ_PORT}.${region}.zerops.app`;
      });
      advance({ step: "anchor", serviceId, address });
    }

    const serviceId = record.serviceId!;
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
      const hq = (await platform.listProjectServices(projectId)).find(
        (service) => service.id === serviceId,
      );
      if (hq?.subdomainAccess !== true) {
        await platform.enableSubdomainAccess(serviceId);
        // Core started without its address, and reads it only at its start.
        await platform.restartService(serviceId);
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
      uncertain:
        step === "project" && cause instanceof ZeropsApiError && cause.kind === "uncertain",
    };
  }
}

import { readBirthIntent } from "../../zerops/birthIntent.ts";
import { mateRecordPermission } from "@t3tools/shared/zeropsPermissions";
import { mateContainerOf } from "../../zerops/containerAddress.ts";
import type { HqBirth } from "../../zerops/hq/client.ts";
import type { ProcessValue } from "../../zerops/projectProcesses.ts";
import { servicesScope } from "../families/service.ts";
import type { Projection } from "../store.ts";
import { sameValue } from "./equal.ts";
import { hqNavigation } from "./hqNavigation.ts";
import { decided, livePermissionFacts } from "./permissionFacts.ts";
import { organizationProjects, rosterAnswered } from "./projects.ts";
import { projectServices } from "./services.ts";
import { projectProcesses } from "./processes.ts";
import { firstBuildState } from "./mateArrival.ts";

export interface BirthEvidence {
  readonly birth: HqBirth;
  /** The person reading: an operation that waits for them is theirs to continue. */
  readonly viewer: string;
  readonly importProcess?: ProcessValue;
  /** The bound project's retained process facts, including a service's import and first build. */
  readonly processes?: ReadonlyArray<ProcessValue>;
  /** `undefined` is unread, `null` is absent, and `several` is an ambiguous live read. */
  readonly service: { readonly id: string; readonly status: string } | "several" | null | undefined;
}

export interface BirthProgress {
  readonly phase: "creating-project" | "project-created" | "import-accepted" | "container-starting";
  readonly next:
    | { readonly kind: "blocked" }
    /** Its operation waits for this person, its maker, to give it a fresh token. */
    | { readonly kind: "continue" }
    /** Nothing read proves what comes next: a birth without HQ's operation. */
    | { readonly kind: "unknown" }
    | {
        readonly kind: "wait";
        readonly for:
          | "hq"
          /** Its operation waits for its maker's Continue, someone other than this person. */
          | "maker"
          | "service-observation"
          | "service"
          | "several-services"
          | "container"
          | "hello";
      };
  readonly reason: string | null;
  readonly failedStep?: NonNullable<NonNullable<HqBirth["operation"]>["failure"]>["step"];
}

export interface SharedBirth {
  readonly id: string;
  readonly appId: string;
  readonly appName: string;
  readonly face: string;
  readonly madeBy?: string;
  readonly chief?: boolean;
  readonly adopted?: true;
  readonly projectId: string | null;
  readonly importProcessId: string | null;
  readonly intent: ReturnType<typeof readBirthIntent>;
  /** When HQ accepted its operation, wall ms by HQ's clock. */
  readonly startedAt?: number;
  readonly progress: BirthProgress;
  readonly canDelete: boolean;
}

export interface SharedBirthState {
  readonly open: ReadonlyArray<SharedBirth>;
  /** HQ retains a birth ID on the linked Mate after its admitted hello ends the birth. */
  readonly readyProjectIds: ReadonlyArray<string>;
}

export const sharedBirths: Projection<
  { readonly orgId: string; readonly personId: string },
  SharedBirthState
> = {
  name: "sharedBirths",
  keyOf: ({ orgId, personId }) => `${orgId}/${personId}`,
  derive: (read, { orgId, personId }) => {
    const navigation = hqNavigation.derive(read, orgId);
    if (navigation.structure === null) return { open: [], readyProjectIds: [] };
    const roster = organizationProjects.derive(read, orgId);
    const current = roster.complete && rosterAnswered.derive(read, orgId);
    const membership = read.fact("organizationUser", orgId);
    const roleLive = membership.kind === "known" && read.stream(membership.scope).phase === "live";
    const roleCurrent = personId !== "" && current && roleLive;
    const open = navigation.structure.apps.flatMap((app) =>
      (app.births ?? []).map((birth): SharedBirth => {
        const projectId = birth.projectId ?? null;
        const importFact =
          birth.importProcessId === undefined
            ? undefined
            : read.fact("process", birth.importProcessId);
        const services =
          projectId === null ? undefined : projectServices.derive(read, { orgId, projectId });
        const processes =
          projectId === null
            ? undefined
            : projectProcesses.derive(read, { orgId, projectId }).retained;
        const container =
          services?.services === undefined ||
          !services.live ||
          read.stream(servicesScope(orgId)).phase !== "live"
            ? undefined
            : mateContainerOf(services.services);
        const service =
          container === undefined
            ? undefined
            : container.kind === "one"
              ? container.service
              : container.kind === "none"
                ? null
                : "several";
        const progress = birthProgressOf({
          birth,
          viewer: personId,
          ...(importFact?.kind === "known" ? { importProcess: importFact.value } : {}),
          ...(processes === undefined ? {} : { processes }),
          service,
        });
        const authorized = roleCurrent && app.can?.add_mate?.allow === true;
        return {
          id: birth.id,
          appId: app.id,
          appName: app.name,
          face: birth.face,
          ...(birth.madeBy === undefined ? {} : { madeBy: birth.madeBy }),
          ...(birth.chief === undefined ? {} : { chief: birth.chief }),
          projectId,
          ...(birth.adopted === true ? { adopted: true as const } : {}),
          importProcessId: birth.importProcessId ?? null,
          intent: readBirthIntent(birth.intent),
          ...(birth.operation === undefined
            ? {}
            : { startedAt: Date.parse(birth.operation.acceptedAt) }),
          progress,
          canDelete:
            birth.adopted === true
              ? authorized
              : projectId === null
                ? authorized
                : roleCurrent &&
                  decided(livePermissionFacts(read, orgId), [projectId], (facts) =>
                    mateRecordPermission(facts, projectId, { create: false, held: "mate" }),
                  )?.allow === true,
        };
      }),
    );
    const openIds = new Set(open.map(({ id }) => id));
    const readyProjectIds = navigation.structure.apps.flatMap((app) =>
      app.projects.flatMap((project) =>
        project.mate?.birthId != null && !openIds.has(project.mate.birthId)
          ? [project.projectId]
          : [],
      ),
    );
    return { open, readyProjectIds };
  },
  equals: sameValue,
};

const failureOf = (process: ProcessValue | undefined): string | null | undefined => {
  if (process?.status !== "FAILED" && process?.status !== "CANCELED") return undefined;
  return process.failReason ?? process.error?.message ?? null;
};

/**
 * A birth's progress, failure and who may continue it are HQ's operation; from its accepted import
 * on, the project's services and processes say how far its Mate got. A verdict uses only HQ's
 * record and facts read from Zerops, never local elapsed time.
 */
export function birthProgressOf(evidence: BirthEvidence): BirthProgress {
  const { birth } = evidence;
  const operation = birth.operation;
  // Every birth is HQ's operation: one without proves nothing, and is only deleted.
  if (operation === undefined)
    return {
      phase: birth.projectId == null ? "creating-project" : "project-created",
      next: { kind: "unknown" },
      reason: null,
    };
  const operationPhase =
    operation.phase === "accepted" || operation.phase === "project_requested"
      ? "creating-project"
      : operation.phase === "import_accepted"
        ? "import-accepted"
        : "project-created";
  const { failure, continueBy } = operation;
  // A failure HQ names nobody to continue ends it. One it does waits for that person's fresh
  // token: theirs to continue, everyone else's to wait for.
  if (failure !== undefined)
    return {
      phase: operationPhase,
      next:
        continueBy === undefined
          ? { kind: "blocked" }
          : continueBy === evidence.viewer
            ? { kind: "continue" }
            : { kind: "wait", for: "maker" },
      reason: failure.code,
      failedStep: failure.step,
    };
  if (operationPhase !== "import-accepted")
    return { phase: operationPhase, next: { kind: "wait", for: "hq" }, reason: null };

  const projectId = birth.projectId;
  const service = evidence.service === "several" ? undefined : evidence.service;
  const matchingImports =
    service == null
      ? []
      : (evidence.processes ?? []).filter(
          (process) =>
            process.projectId === projectId &&
            process.actionName === "stack.create" &&
            process.serviceStackIds.includes(service.id),
        );
  const correlatedImport = matchingImports.length === 1 ? matchingImports[0] : undefined;
  const importProcess =
    evidence.importProcess !== undefined &&
    evidence.importProcess.projectId === projectId &&
    evidence.importProcess.id === birth.importProcessId
      ? evidence.importProcess
      : birth.importProcessId !== undefined &&
          (birth.importProcessId === service?.id || birth.importProcessId === correlatedImport?.id)
        ? correlatedImport
        : undefined;
  const importFailure = failureOf(importProcess);
  const phase = service != null ? "container-starting" : "import-accepted";
  if (importFailure !== undefined)
    return { phase, next: { kind: "blocked" }, reason: importFailure };
  const build = firstBuildState(evidence.processes, service?.id);
  const containerReason =
    build?.kind === "failed"
      ? build.why
      : service?.status.endsWith("FAILED") === true
        ? "Container failed."
        : service?.status === "STOPPED"
          ? "Container stopped."
          : null;
  return {
    phase,
    next: {
      kind: "wait",
      for:
        evidence.service === "several"
          ? "several-services"
          : service === undefined
            ? "service-observation"
            : service === null
              ? "service"
              : service.status === "ACTIVE"
                ? "hello"
                : "container",
    },
    reason: containerReason,
  };
}

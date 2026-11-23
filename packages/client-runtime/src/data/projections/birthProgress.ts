import { readBirthIntent } from "../../zerops/birthIntent.ts";
import { mateContainerOf } from "../../zerops/containerAddress.ts";
import type { HqBirth, HqBirthOffer, HqBirthState } from "../../zerops/hq/client.ts";
import { hqMateOffers } from "../../zerops/hq/placement.ts";
import type { ProcessValue } from "../../zerops/projectProcesses.ts";
import { servicesScope } from "../families/service.ts";
import type { Projection } from "../store.ts";
import { sameValue } from "./equal.ts";
import { hqNavigation } from "./hqNavigation.ts";
import { organizationProjects, rosterAnswered } from "./projects.ts";
import { projectServices } from "./services.ts";
import { projectProcesses } from "./processes.ts";
import { firstBuildState } from "./mateArrival.ts";

export interface BirthEvidence {
  readonly birth: Pick<HqBirth, "operation" | "projectId" | "importProcessId">;
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
    | {
        readonly kind: "wait";
        readonly for:
          | "hq"
          | "service-observation"
          | "service"
          | "several-services"
          | "container"
          | "hello";
      };
  /** What Zerops reported of its import or container: why it needs attention, or null. */
  readonly reason: string | null;
}

/** HQ stopped the birth (`state`): its own card says why and offers its ways on. */
export const birthStopped = (state: HqBirthState): boolean =>
  state === "failed" || state === "waiting_for_maker";

/**
 * What a person is offered of HQ's offers for a birth: Continue as HQ names its reader; Delete of
 * the birth alone where they may add a Mate to its application (`addMate`); its project's deletion
 * where HQ offers them the Mate's record (`editRecord`). Each permission is read live, else false.
 */
export function birthOffersFor(
  offers: ReadonlyArray<HqBirthOffer>,
  person: { readonly addMate: boolean; readonly editRecord: boolean },
): ReadonlyArray<HqBirthOffer> {
  return offers.filter(
    (offer) => offer === "continue" || (offer === "delete" ? person.addMate : person.editRecord),
  );
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
  readonly startedAt: number;
  readonly progress: BirthProgress;
  /** Its lifecycle state, HQ's. */
  readonly state: HqBirthState;
  /** HQ's offers this person's live permission allows (`birthOffersFor`). */
  readonly offers: ReadonlyArray<HqBirthOffer>;
  /** Its operation's failure as HQ sent it; absent while it has none. */
  readonly failure?: NonNullable<HqBirth["operation"]["failure"]>;
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
    const structure = navigation.structure;
    if (structure === null) return { open: [], readyProjectIds: [] };
    const roster = organizationProjects.derive(read, orgId);
    const current = roster.complete && rosterAnswered.derive(read, orgId);
    const membership = read.fact("organizationUser", orgId);
    const roleLive = membership.kind === "known" && read.stream(membership.scope).phase === "live";
    const roleCurrent = personId !== "" && current && roleLive;
    const open = structure.apps.flatMap((app) =>
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
          ...(importFact?.kind === "known" ? { importProcess: importFact.value } : {}),
          ...(processes === undefined ? {} : { processes }),
          service,
        });
        const authorized = roleCurrent && app.can?.add_mate?.allow === true;
        const offer = projectId === null ? undefined : hqMateOffers(structure, projectId);
        const editRecord = offer?.held === true && offer.edit.kind === "allowed";
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
          startedAt: Date.parse(birth.operation.acceptedAt),
          progress,
          state: birth.state,
          offers: birthOffersFor(birth.offers, { addMate: authorized, editRecord }),
          ...(birth.operation.failure === undefined ? {} : { failure: birth.operation.failure }),
        };
      }),
    );
    const openIds = new Set(open.map(({ id }) => id));
    const readyProjectIds = structure.apps.flatMap((app) =>
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
 * How far a birth got: HQ's operation phase, and from its accepted import on, what the project's
 * services and processes say of its Mate. Whether it stopped and who continues it is HQ's `state`
 * and `offers`, never this. It uses only HQ's record and facts read from Zerops, never local
 * elapsed time.
 */
export function birthProgressOf(evidence: BirthEvidence): BirthProgress {
  const { birth } = evidence;
  const operation = birth.operation;
  const operationPhase =
    operation.phase === "accepted" || operation.phase === "project_requested"
      ? "creating-project"
      : operation.phase === "import_accepted"
        ? "import-accepted"
        : "project-created";
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

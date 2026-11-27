import { readBirthIntent } from "../../zerops/birthIntent.ts";
import { mateContainerOf } from "../../zerops/containerAddress.ts";
import {
  HQ_BIRTH_LEFT,
  type HqBirth,
  type HqBirthLeft,
  type HqBirthOffer,
  type HqBirthState,
  type HqOperation,
} from "../../zerops/hq/client.ts";
import { hqMateOffers } from "../../zerops/hq/placement.ts";
import type { ProcessValue } from "../../zerops/projectProcesses.ts";
import { servicesScope } from "../families/service.ts";
import { hqBirthDeletionsScope } from "../families/hqBirthDeletion.ts";
import type { Projection } from "../store.ts";
import { sameValue } from "./equal.ts";
import { hqNavigation } from "./hqNavigation.ts";
import { organizationProjects, rosterAnswered } from "./projects.ts";
import { projectServices } from "./services.ts";
import { projectProcesses } from "./processes.ts";
import { firstBuildState } from "./mateArrival.ts";
import {
  accessLostLine,
  operationFailureWords,
  platformErrorLine,
  waitingWords,
  type WaitingPress,
} from "./operationFailure.ts";

export interface BirthEvidence {
  readonly birth: Pick<HqBirth, "operation" | "projectId" | "importProcessId">;
  readonly importProcess?: ProcessValue;
  /** The bound project's retained process facts, including a service's import and first build. */
  readonly processes?: ReadonlyArray<ProcessValue>;
  /** `undefined` is unread, `null` is absent, and `several` is an ambiguous live read. */
  readonly service: { readonly id: string; readonly status: string } | "several" | null | undefined;
}

export interface BirthProgress {
  readonly phase:
    | "creating-project"
    | "project-created"
    | "import-accepted"
    | "container-starting"
    | "deleting-project";
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
 * What a person is offered of HQ's offers for a birth: Continue and End as HQ names its reader; Delete of
 * the birth alone where they may add a Mate to its application (`addMate`); its project's deletion
 * where HQ offers them the Mate's record (`editRecord`). Each permission is read live, else false.
 */
export function birthOffersFor(
  offers: ReadonlyArray<HqBirthOffer>,
  person: { readonly addMate: boolean; readonly editRecord: boolean },
): ReadonlyArray<HqBirthOffer> {
  return offers.filter(
    (offer) =>
      offer === "continue" ||
      offer === "end" ||
      (offer === "delete" ? person.addMate : person.editRecord),
  );
}

/**
 * Whether a birth's Delete is drawn and not pressable: its operation runs, HQ offers no Delete
 * meanwhile, and the person holds the Mate's record, so its project's deletion comes to them when
 * the operation ends or waits for its maker.
 */
export function birthDeleteHeld(
  birth: { readonly state: HqBirthState; readonly offers: ReadonlyArray<HqBirthOffer> },
  editRecord: boolean,
  phase: BirthProgress["phase"],
): boolean {
  return (
    birth.state === "running" &&
    phase !== "deleting-project" &&
    editRecord &&
    !birth.offers.includes("delete") &&
    !birth.offers.includes("delete_project")
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
  /**
   * What an adopted birth's attempt may have written to the project, in
   * HQ's order (`births[].left`); absent for any other birth.
   */
  readonly left?: ReadonlyArray<HqBirthLeft>;
  readonly projectId: string | null;
  readonly importProcessId: string | null;
  readonly intent: ReturnType<typeof readBirthIntent>;
  /** When HQ accepted its operation, wall ms by HQ's clock. */
  readonly startedAt: number;
  readonly progress: BirthProgress;
  /** Its lifecycle state, HQ's. */
  readonly state: HqBirthState;
  /** HQ's Continue and End offers, and its Delete offers this person's live permission allows. */
  readonly offers: ReadonlyArray<HqBirthOffer>;
  /** Delete is drawn and not pressable until HQ offers it (`birthDeleteHeld`). */
  readonly deleteHeld?: true;
  /** Its operation's failure as HQ sent it; absent while it has none. */
  readonly failure?: NonNullable<HqBirth["operation"]["failure"]>;
  /** Its deletion while HQ still runs it, including a wait for its maker. */
  readonly deletion?: HqOperation;
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
    const deletions = read.members(hqBirthDeletionsScope(orgId)).ids.flatMap((id) => {
      const fact = read.fact("hqBirthDeletion", id);
      if (fact.kind !== "known" || fact.value.outcome !== undefined) return [];
      const operation = fact.value.operation;
      return operation.failure !== undefined && operation.continueBy === undefined
        ? []
        : [fact.value];
    });
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
        const placement = projectId === null ? undefined : read.fact("placement", projectId);
        const projectOperation =
          placement?.kind === "known" ? placement.value.operation : undefined;
        const deletion =
          deletions.find((entry) => entry.birthId === birth.id)?.operation ??
          (projectOperation?.kind === "birth_deletion" ? projectOperation : undefined);
        return {
          id: birth.id,
          appId: app.id,
          appName: app.name,
          face: birth.face,
          ...(birth.madeBy === undefined ? {} : { madeBy: birth.madeBy }),
          ...(birth.chief === undefined ? {} : { chief: birth.chief }),
          projectId,
          ...(birth.adopted === true ? { adopted: true as const } : {}),
          ...(birth.left === undefined
            ? {}
            : {
                left: birth.left.filter((left): left is HqBirthLeft =>
                  (HQ_BIRTH_LEFT as ReadonlyArray<string>).includes(left),
                ),
              }),
          importProcessId: birth.importProcessId ?? null,
          intent: readBirthIntent(birth.intent),
          startedAt: Date.parse(birth.operation.acceptedAt),
          progress,
          state: birth.state,
          offers: birthOffersFor(birth.offers, { addMate: authorized, editRecord }),
          ...(birthDeleteHeld(birth, editRecord, progress.phase)
            ? { deleteHeld: true as const }
            : {}),
          ...(birth.operation.failure === undefined ? {} : { failure: birth.operation.failure }),
          ...(deletion === undefined ? {} : { deletion }),
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

/** Each stage's words for a running birth, a stopped birth and its detail page. */
const BIRTH_STAGE: Record<
  BirthProgress["phase"],
  { going: string; stopped: string; detail: string }
> = {
  "creating-project": {
    going: "Creating its project…",
    stopped: "Setup stopped while creating its project",
    detail: "Creating project",
  },
  "project-created": {
    going: "Its project is made, setting it up…",
    stopped: "Setup stopped after its project was created",
    detail: "Project created",
  },
  "import-accepted": {
    going: "Making its services…",
    stopped: "Setup stopped while its services were being made",
    detail: "Import accepted",
  },
  "container-starting": {
    going: "Starting its computer…",
    stopped: "Setup stopped while its computer was starting",
    detail: "Container starting",
  },
  "deleting-project": {
    going: "Deleting its project…",
    stopped: "Setup stopped while deleting its project",
    detail: "Deleting project",
  },
};

const FAILURE_STEP: Record<NonNullable<SharedBirth["failure"]>["step"], string> = {
  create: "Creating project",
  watch: "Setting up project",
  access: "Granting project access",
  settings: "Updating project settings",
  key: "Creating project key",
  import: "Importing services",
  restart: "Restarting the Mate service",
  delete: "Deleting project",
  prove: "Proving project deletion",
  zerops: "Reaching Zerops",
};

/** The row, detail and actions of a birth, from HQ's state and offers and Zerops' evidence. */
export function birthPresentation(birth: SharedBirth): {
  readonly line: string;
  readonly row: string;
  readonly stopped: boolean;
  readonly attention: boolean;
  readonly actions: ReadonlyArray<"continue-operation" | "end-operation" | "delete">;
  readonly waitsOnMaker: boolean;
  readonly press: WaitingPress;
} {
  if (birth.deletion !== undefined) {
    const { failure, continueBy, offers = [] } = birth.deletion;
    const continues = offers.includes("continue");
    const line = failure === undefined ? "Deleting Mate setup" : operationFailureWords(failure);
    return {
      row: line,
      line,
      stopped: failure !== undefined,
      attention: failure !== undefined,
      waitsOnMaker: continueBy !== undefined && !continues,
      press: waitingWords(failure?.code ?? "").press,
      actions: [
        ...(continues ? ["continue-operation" as const] : []),
        ...(offers.includes("end") ? ["end-operation" as const] : []),
      ],
    };
  }
  const { phase, next, reason } = birth.progress;
  const stage = BIRTH_STAGE[phase];
  const stopped = birthStopped(birth.state);
  const continues = birth.offers.includes("continue");
  const waits = birth.state === "waiting_for_maker";
  const failure = birth.failure;
  const platformError =
    failure === undefined
      ? null
      : platformErrorLine(failure, waits ? (continues ? "continue" : "maker-continues") : "ended");
  const waiting =
    waits && failure?.code === "token_expired"
      ? continues
        ? "Its Zerops sign-in ran out before it finished."
        : "Its maker can continue it."
      : null;
  const accessLost = waits && failure !== undefined ? accessLostLine(failure, continues) : null;
  const cleanupRefused =
    phase === "deleting-project" &&
    birth.state === "failed" &&
    failure?.origin === "zerops" &&
    failure.step === "delete";
  const failureWords =
    platformError ??
    accessLost ??
    waiting ??
    (failure === undefined
      ? null
      : cleanupRefused
        ? `Mate could not delete the project${birth.intent?.projectName ? ` ${birth.intent.projectName}` : ""} it created: delete it in Zerops. ${operationFailureWords(failure)}`
        : phase === "deleting-project" &&
            (failure.code === "chief_already_registered" ||
              failure.code === "another_persons_chief")
          ? operationFailureWords(failure)
          : `${FAILURE_STEP[failure.step]} · ${operationFailureWords(failure)}`);
  const detail =
    reason ??
    (next.kind === "blocked"
      ? "Zerops reported that the step failed or was canceled"
      : {
          hq: null,
          "service-observation": "Waiting for Zerops service information",
          service: "The Mate service has not appeared in Zerops",
          "several-services": "Several Mate services are present in the project",
          container: "Waiting for the Mate container to start",
          hello: "Waiting for the Mate to link",
        }[next.for]);
  const attention =
    stopped ||
    reason !== null ||
    next.kind === "blocked" ||
    (next.kind === "wait" && next.for === "several-services");
  return {
    row: failureWords ?? (attention ? stage.stopped : stage.going),
    line:
      failureWords ??
      (next.kind === "wait" && next.for === "hq"
        ? stage.going
        : [stage.detail, detail].filter((part) => part !== null).join(" · ")),
    stopped,
    attention,
    waitsOnMaker: waits && !continues,
    press: waitingWords(failure?.code ?? "").press,
    actions: [
      ...(continues ? ["continue-operation" as const] : []),
      ...(birth.offers.includes("end") ? ["end-operation" as const] : []),
      ...(birth.offers.includes("delete") || birth.offers.includes("delete_project")
        ? ["delete" as const]
        : []),
    ],
  };
}

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
    operation.phase === "delete_requested" ||
    operation.phase === "delete_accepted" ||
    operation.phase === "project_gone"
      ? "deleting-project"
      : operation.phase === "accepted" || operation.phase === "project_requested"
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

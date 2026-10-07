/**
 * *New project* and *Add a Mate*, from the press of Create or Add: the Mate drawn at once where it
 * will live — its own view (`/mate/new/$birthId`) and its row in the left menu — before the
 * platform has made anything (the owner, 2026-09-30: "you should add the project and the first
 * mate in the same step, then you should go to the mate detail and the only diff would be the
 * progress").
 *
 * A New project's creation takes, in order — over the organization's HQ, which stands before
 * any project does (ADR 0001):
 * - `registry` — the project's application in HQ, which is what makes the project exist. HQ names
 *   it: its id is the project's group from then on. Then its first Mate's birth intent there —
 *   its face, before its project exists — which the project is created under (F6c).
 * - `create` — its first Mate's Zerops project, named in full under its application. Once the
 *   platform takes it the Mate's press carries the rest (`matePress.ts`), and the view hands the
 *   route to the Mate's own (`/mate/$projectId`), in its place.
 *
 * A pending creation is its operations: each step is recorded under an id named from the
 * creation's own (`creationSteps`), and where it stands, where it stopped and why are read off
 * them. What the person asked — the project, the Mate's name and face, where — is held in this
 * tab (`creations.ts`) by the creation's id; a reload forgets it. A step that stops says why on
 * the view, with *Try again*, which resumes from that step — except one the platform may have
 * taken anyway (`uncertain`), which a second try could make twice.
 */
import {
  creationStepId,
  type CreationRead,
  type MateRegistration,
} from "@t3tools/client-runtime/data";
import {
  appProjectName,
  formatMateFace,
  recipeTierServices,
  splitRecipeTier,
  UNCONFIRMED_PROJECT,
  UNCONFIRMED_WRITE,
  type BirthPlacement,
  type EnvironmentCreationOutcome,
  type EnvironmentCreationStep,
  type EnvironmentCreationStepProgress,
  type RecipeRuntime,
  type ZeropsAgentType,
  type ZeropsMateFace,
  type ZeropsPlacedBirth,
} from "@t3tools/client-runtime/zerops";
import {
  birthRuntimesFacts,
  deriveBirthProgress,
} from "@t3tools/client-runtime/zerops/birthProgress";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import type { HqEndpoint } from "@t3tools/client-runtime/zerops/hq";

import type {
  BirthLineProgress,
  BirthLineStep,
} from "../components/zerops/ZeropsBirthProgress.logic";
import { COMING_UP_LINE, NOT_SET_UP_LINE } from "../components/zerops/ZeropsProjectRow.logic";
import { HQ_UNFOLLOWED } from "./accountOperations";
import type { ArrivalSubstep } from "./mateArrival";
import { asSentence, type MateComing } from "./mateComing";
import { PRESS_MAY_HAVE_LANDED } from "./matePress";
import { newMateView, type NewMateAgain } from "./newMate";

/** A step of a New project's creation, before the platform has taken its first Mate's project. */
export type NewProjectStep = "registry" | "create";

/** What Create or Add asked for: the project, its Mate, and where. */
export interface NewProjectAsk {
  readonly organizationId: string;
  /** The creation's own id, made on the press: where its view is, and its group until HQ names one. */
  readonly birthId: string;
  /** The project's name. */
  readonly name: string;
  /** Its first Mate's name. */
  readonly botName: string;
  readonly face: ZeropsMateFace;
  readonly locationId: string | null;
  /** Empty for every agent: an empty selection omits `ZCP_AGENTS` (`newProject.ts`). */
  readonly agents: ReadonlyArray<ZeropsAgentType>;
  /**
   * Add a Mate, not a New project: the Mate goes into the project `name` that stands — no Git
   * hosting or registration of the project's own — its Zerops project named in full under it,
   * and its own registration written where `registers`.
   */
  readonly adds?:
    | {
        /** The existing application in HQ. */
        readonly appId: string;
        readonly registers: boolean;
        /** The managed services its recipe names, from the press (`recipeManaged`). */
        readonly managed?: ReadonlyArray<string> | undefined;
        /** The runtimes its workspace brings, from the press (`recipeRuntimes`). */
        readonly runtimes?: ReadonlyArray<RecipeRuntime> | undefined;
      }
    | undefined;
}

export interface NewProjectFailure {
  readonly reason: string;
  /** The platform may have taken the creation anyway: trying again could make it twice. */
  readonly uncertain: boolean;
}

/**
 * A creation this tab holds (`creations.ts`): what the person asked, when, against which HQ —
 * the person's own input, never a step's state, which its operations hold.
 */
export interface CreationAsk {
  readonly ask: NewProjectAsk;
  /** When Create was pressed, wall ms: the view's clock counts from here. */
  readonly startedAt: number;
  /** The organization's HQ when it was pressed, where the registry lives. */
  readonly hq: HqEndpoint;
  /** An Add's presses: the first, then one per *Try again*, each recorded under its own id. */
  readonly presses: number;
  /** Why this tab refused an Add's press before it sent anything (its plan, its account gone). */
  readonly refusedHere: string | null;
}

/**
 * The id a creation's steps are recorded under: a New project's, its own — a step tried again
 * takes its next attempt (`creationStepId`); an Add's, its press's, as each *Try again* presses
 * it whole again.
 */
export function creationRunId(held: Pick<CreationAsk, "ask" | "presses">): string {
  return held.ask.adds === undefined || held.presses <= 1
    ? held.ask.birthId
    : `${held.ask.birthId}#${held.presses}`;
}

/** A creation as its surfaces draw it: the ask, and where its steps stand (`creationOf`). */
export interface NewProjectBirth extends NewProjectAsk {
  /** When Create was pressed, wall ms: the view's clock counts from here. */
  readonly startedAt: number;
  /** The organization's HQ, where the registry lives. */
  readonly hq: HqEndpoint;
  /** The project's application in HQ — its group — once registered. */
  readonly appId: string | null;
  /** Its first Mate's birth intent in that application, once HQ recorded it. */
  readonly intent: string | null;
  /** The step running, or — `failed` — the one that stopped it; `created` once the platform took the Mate's project. */
  readonly step: NewProjectStep | "created";
  readonly failed: NewProjectFailure | null;
  /** The first Mate's Zerops project, once the platform took it. */
  readonly projectId: string | null;
}

/** A step's stop in the words its run would have thrown (`runToEnd`). */
const stopOf = (
  step: CreationRead["steps"][keyof CreationRead["steps"]],
  unobserved: string,
  /** HQ's writes are tried again as they stopped: they never said "may have landed" here. */
  certain = false,
): NewProjectFailure | null =>
  step.state === "stopped"
    ? { reason: step.reason ?? unobserved, uncertain: certain ? false : step.uncertain }
    : null;

/** Where a creation this tab holds stands, read off its steps' operations (`creationSteps`). */
export function creationOf(held: CreationAsk, read: CreationRead): NewProjectBirth {
  const { ask } = held;
  const { projectId, steps } = read;
  // HQ's records are its creation's once HQ's navigation shows them, as each step's run ends.
  const appId = steps.app.state === "done" ? read.appId : null;
  const shared = {
    ...ask,
    startedAt: held.startedAt,
    hq: held.hq,
    projectId,
    intent: steps.birth.state === "done" ? read.birthId : null,
  };
  if (projectId !== null)
    return { ...shared, appId: ask.adds?.appId ?? appId, step: "created", failed: null };
  if (ask.adds !== undefined) {
    const { project } = steps;
    const failed =
      stopOf(steps.birth, HQ_UNFOLLOWED, true) ??
      stopOf(
        project,
        project.state === "stopped" && project.kind === "import-project"
          ? UNCONFIRMED_WRITE
          : UNCONFIRMED_PROJECT,
      ) ??
      (held.refusedHere === null ? null : { reason: held.refusedHere, uncertain: false });
    return { ...shared, appId: ask.adds.appId, step: "create", failed };
  }
  const registry =
    stopOf(steps.app, HQ_UNFOLLOWED, true) ?? stopOf(steps.birth, HQ_UNFOLLOWED, true);
  const registered = steps.app.state === "done" && steps.birth.state === "done";
  return {
    ...shared,
    appId,
    step: registered ? "create" : "registry",
    failed: registered ? stopOf(steps.project, PRESS_MAY_HAVE_LANDED) : registry,
  };
}

/**
 * What the first Mate's project is created with: the project alone, named in full — its
 * application's name and its Mate's — under its birth intent. Its application and face are HQ's, written by its press's registration
 * before its container (F6b) — and its intent's before that (F6c).
 */
export interface NewProjectCreation {
  readonly name: string;
  readonly location?: string;
  /** The birth intent HQ holds of its Mate. */
  readonly birth: string;
}

/**
 * Where the project stands once registered: its organization's HQ, its application in it, and its
 * first Mate's birth intent there, which the Mate's attach closes.
 */
export interface NewProjectRegistration {
  readonly hq: HqEndpoint;
  readonly appId: string;
  readonly intent: string;
}

/**
 * What a New project's creation acts through: each step run to its end under the request id it is
 * recorded by, and the press it hands over to.
 */
export interface NewProjectPorts {
  /** Creates the project's application in HQ (`create-app`). */
  readonly registerGroup: (requestId: string, name: string) => Promise<{ readonly appId: string }>;
  /**
   * Records the first Mate's birth intent in its application (`record-birth`): its face,
   * before its project exists, under HQ's id.
   */
  readonly recordBirth: (
    requestId: string,
    birth: { readonly appId: string; readonly face: string },
  ) => Promise<{ readonly birthId: string }>;
  /**
   * Creates the first Mate's project, alone: taken the moment the platform takes it. Its press
   * attaches it to its application, then imports its container (F6b).
   */
  readonly createProject: (
    requestId: string,
    creation: NewProjectCreation,
  ) => Promise<{ readonly projectId: string }>;
  /** The platform took the first Mate's project: its press attaches it, then imports its container. */
  readonly accepted: (projectId: string, registration: NewProjectRegistration) => void;
}

// ── What its surfaces draw ───────────────────────────────────────────────────────────────────

/**
 * Where the project and its first Mate stand in the account's projects, as the creation knows
 * them: its row in the menu from the press, and its birth's from the moment the platform takes it
 * — in the group HQ named, once it named one.
 */
export function newProjectPlacement(
  ask: NewProjectAsk & { readonly appId?: string | null },
): BirthPlacement {
  return {
    groupId: ask.appId ?? ask.birthId,
    groupName: ask.name,
    kind: "mate",
    // The group has no project of its own; its first Mate's project is named in full, the
    // application's name and the Mate's, and drawn by the Mate's own name under it.
    displayName: ask.botName,
    face: ask.face,
  };
}

/**
 * The creations the platform has not taken yet in the organization in view, placed as the birth
 * store's are (`placedBirthsIn`): the project, and its Mate in it, drawn from the press — by the
 * creation's id, which its own view is at. One the platform took is its birth's to draw.
 */
export function placedNewProjects(
  births: ReadonlyArray<NewProjectBirth>,
  organizationId: string | undefined,
): ReadonlyArray<ZeropsPlacedBirth> {
  return births.flatMap((birth) =>
    birth.projectId !== null || birth.organizationId !== organizationId
      ? []
      : [
          {
            projectId: birth.birthId,
            ...(birth.intent === null ? {} : { intent: birth.intent }),
            startedAt: birth.startedAt,
            placement: newProjectPlacement(birth),
            // The first thing its Mate's birth will owe.
            step: "tags" as const,
            overdue: false,
            awaitingProject: true,
            ...(birth.failed === null ? {} : { failed: true }),
          },
        ],
  );
}

const ORDER: ReadonlyArray<NewProjectBirth["step"]> = ["registry", "create", "created"];

/** A step's state: done once the creation is past it, and the running one active or failed. */
function stateOf(birth: NewProjectBirth, own: NewProjectStep): BirthLineStep["state"] {
  const at = ORDER.indexOf(birth.step);
  const mine = ORDER.indexOf(own);
  if (mine < at) return "done";
  if (mine > at) return "waiting";
  return birth.failed === null ? "active" : "failed";
}

/** The project's own step, before its first Mate's: its registration, under the project's name. */
export function newProjectSteps(birth: NewProjectBirth): ReadonlyArray<BirthLineStep> {
  // An added Mate's project stands: its copy is its first row.
  if (birth.adds !== undefined) return [];
  const step = (id: string, label: string, own: NewProjectStep, doing: string): BirthLineStep => {
    const state = stateOf(birth, own);
    const detail =
      state === "active" ? doing : state === "failed" ? birth.failed?.reason : undefined;
    return { id, label, state, ...(detail === undefined ? {} : { detail }) };
  };
  return [step("registry", birth.name, "registry", "Registering the project")];
}

/**
 * How far a New project's creation has got, as its first Mate's view draws it: the project's own
 * steps, then the Mate's six (`deriveBirthProgress`) — its birth's, once the platform took its
 * project, and read off the creation itself before that. The Mate's steps wait while the
 * project's run: none of them begins before the project stands. One clock, from the press.
 */
export function newProjectProgress(
  birth: NewProjectBirth,
  /** The Mate's birth as its view reads it, once the platform took its project; null before. */
  mate: BirthLineProgress | null,
  nowMs: number,
): BirthLineProgress {
  const own = newProjectSteps(birth);
  // An added Mate's runtimes are named from the press, as its own view names them after.
  const runtimes = birthRuntimesFacts({ planned: creationRuntimes(birth), services: undefined });
  const theirs =
    mate ??
    deriveBirthProgress(
      {
        project: undefined,
        ...(birth.step === "create" && birth.failed !== null
          ? { creationFailed: { message: birth.failed.reason } }
          : {}),
        container: undefined,
        processes: [],
        health: undefined,
        connection: "none",
        ...(runtimes === undefined ? {} : { runtimes }),
      },
      nowMs,
    );
  const stands = own.every((step) => step.state === "done");
  const steps: ReadonlyArray<BirthLineStep> = [
    ...own,
    ...(stands
      ? theirs.steps
      : theirs.steps.map(({ id, label }) => ({ id, label, state: "waiting" as const }))),
  ];
  return {
    steps,
    active: steps.find((step) => step.state === "active") ?? null,
    failed: steps.find((step) => step.state === "failed") ?? null,
    doneCount: steps.filter((step) => step.state === "done").length,
    total: steps.length,
    complete: steps.at(-1)?.state === "done",
    startedAt: new Date(birth.startedAt).toISOString(),
    ...(theirs.runtimes === undefined ? {} : { runtimes: theirs.runtimes }),
  };
}

/**
 * What its view says under the headline (`MateComing`): coming up while it runs; where it stopped,
 * why, with *Try again* — or, where the platform may have taken it anyway, the way to the projects,
 * where it would be listed.
 */
export function newProjectComing(birth: NewProjectBirth): MateComing {
  if (birth.failed === null) return { kind: "coming", line: COMING_UP_LINE };
  const why = asSentence(birth.failed.reason);
  return {
    kind: "failed",
    line: why.length === 0 ? NOT_SET_UP_LINE : why,
    verb: birth.failed.uncertain ? "go-to-projects" : "try-again",
  };
}

/** Where Create lands: the first Mate's own view, before the platform has made anything. */
export function newProjectView(birthId: string): {
  readonly to: "/mate/new/$birthId";
  readonly params: { readonly birthId: string };
} {
  return { to: "/mate/new/$birthId", params: { birthId } };
}

/**
 * Where its view goes once the platform took its first Mate's project: that Mate's own view, in
 * place of this one — the route replaced, so going back never lands on a creation that is over.
 */
export function newProjectHandOver(
  birth: NewProjectBirth | undefined,
): (ReturnType<typeof newMateView> & { readonly replace: true }) | null {
  if (birth?.projectId == null) return null;
  return { ...newMateView(birth.projectId), replace: true };
}

// ── Running it ───────────────────────────────────────────────────────────────────────────────

/** The request id a step is sent under next: its first attempt, or the one after a stop. */
const nextAttempt = (read: CreationRead, creationId: string, step: keyof CreationRead["steps"]) =>
  creationStepId(creationId, step, read.steps[step].attempt + 1);

/**
 * Runs a New project's creation from the step it stands on until the platform takes its first
 * Mate's project, or until a step stops it — a step done is never sent again, one under way is
 * left to its run, and one stopped is sent anew under its next attempt.
 *
 * The order is the point: the application is what makes the project exist, and a Mate created
 * before it would be a Mate in a project nobody has heard of. A registration that fails creates
 * nothing; a Mate's creation that fails leaves a registered project with no Mate in it, which is
 * one the person can add a Mate to, not a mess to clean up. What stopped it is its operation's to
 * say (`creationOf`).
 */
export async function runNewProjectBirth(
  held: CreationAsk,
  /** Where its steps stand now. */
  read: () => CreationRead,
  ports: NewProjectPorts,
): Promise<void> {
  const { ask, hq } = held;
  const id = ask.birthId;
  const step = async <T>(
    name: keyof CreationRead["steps"],
    done: (read: CreationRead) => T | null,
    send: (requestId: string) => Promise<T>,
  ): Promise<T | null> => {
    const now = read();
    if (now.steps[name].state === "done") return done(now);
    if (now.steps[name].state === "running") return null;
    try {
      return await send(nextAttempt(now, id, name));
    } catch {
      return null;
    }
  };
  if (read().projectId !== null) return;
  const appId = await step(
    "app",
    (now) => now.appId,
    async (requestId) => (await ports.registerGroup(requestId, ask.name)).appId,
  );
  if (appId === null) return;
  // Recorded once: a creation tried again goes on under the intent it holds.
  const intent = await step(
    "birth",
    (now) => now.birthId,
    async (requestId) =>
      (await ports.recordBirth(requestId, { appId, face: formatMateFace(ask.face) })).birthId,
  );
  if (intent === null) return;
  const projectId = await step(
    "project",
    (now) => now.projectId,
    async (requestId) =>
      (
        await ports.createProject(requestId, {
          name: appProjectName(ask.name, ask.botName),
          ...(ask.locationId === null ? {} : { location: ask.locationId }),
          birth: intent,
        })
      ).projectId,
  );
  if (projectId !== null) ports.accepted(projectId, { hq, appId, intent });
}

/** What an Add's press answers once it is over (`useEnvironmentCreation`). */
export type AddRun =
  | { readonly kind: "refused"; readonly reason: string | null }
  | { readonly kind: "ran"; readonly outcome: EnvironmentCreationOutcome };

/**
 * Runs an Add's press under its press's id (`creationRunId`). Its steps' operations say where it
 * stopped; what stopped it before it sent anything — its own plan, or a throw no step recorded —
 * is told to `refusedHere`, the moment it stands before the platform took its project. A stop
 * after that is its press's to say on the Mate's own view (`matePress.ts`).
 */
export async function runAdd(
  held: CreationAsk,
  /** Where a press's steps stand now, by its id. */
  read: (creationId: string) => CreationRead,
  press: (creationId: string) => Promise<AddRun>,
  refusedHere: (reason: string) => void,
): Promise<void> {
  const creationId = creationRunId(held);
  let refusal: string | null;
  try {
    const run = await press(creationId);
    refusal = run.kind === "refused" ? (run.reason ?? ADD_REFUSED) : null;
  } catch (cause) {
    refusal = zeropsErrorMessage(cause);
  }
  if (refusal !== null && read(creationId).projectId === null) refusedHere(refusal);
}

const ADD_REFUSED = "It could not be added.";

/** The creation this tab made whose first Mate's project this is, while the tab holds it. */
export function madeOf(
  creations: ReadonlyArray<NewProjectBirth>,
  projectId: string,
): NewProjectBirth | undefined {
  return creations.find((creation) => creation.projectId === projectId);
}

/**
 * What ends a creation that stopped before Zerops took its project as far as this tab knows:
 * *Dismiss* takes it out of the menu — and, for an Add refused for certain (a quota, a right),
 * *Start over* asks for it again over its project, its name there to change. One Zerops may have
 * made is dismissed, never started over: a second could make it twice. Null for any other: one
 * running, one Zerops took (its press finishes it), a New project refused for certain (its own
 * *Try again*).
 */
export function creationEnds(birth: NewProjectBirth): {
  readonly startOver: { readonly groupId: string; readonly again: NewMateAgain } | null;
} | null {
  if (birth.projectId !== null || birth.failed === null) return null;
  if (birth.failed.uncertain) return { startOver: null };
  if (birth.adds === undefined) return null;
  return {
    startOver: {
      groupId: birth.adds.appId,
      again: {
        botName: birth.botName,
        tint: birth.face.tint,
        shape: birth.face.shape,
      },
    },
  };
}

/** The managed services a recipe's yaml names, in its order: none where it names none. */
export function recipeManaged(yaml: string): ReadonlyArray<string> | undefined {
  const managed = (recipeTierServices(yaml) ?? []).flatMap((service) =>
    service.role === "managed" ? [service.hostname] : [],
  );
  return managed.length === 0 ? undefined : managed;
}

/** The managed services an added Mate's copy waits on, as its recipe named them at the press. */
export function creationManaged(birth: NewProjectBirth): ReadonlyArray<string> | undefined {
  return birth.adds?.managed;
}

/** The runtimes a recipe's tier brings up once its Mate is closed off: none where it names none. */
export function recipeRuntimes(yaml: string): ReadonlyArray<RecipeRuntime> | undefined {
  return splitRecipeTier(yaml)?.runtimes?.services;
}

/**
 * The runtimes an added Mate's workspace brings, named from the press so its line under the
 * workspace stands from the first frame, as its recipe named them. A New project's first Mate has
 * none.
 */
export function creationRuntimes(birth: NewProjectBirth): ReadonlyArray<RecipeRuntime> | undefined {
  return birth.adds?.runtimes;
}

/**
 * What a Mate's view names before its project lists them — its copy's managed services, its
 * workspace's runtimes: its press's while this tab holds it, then the creation's ask, which this
 * tab holds all session; so a press over never takes back a line its view drew (run 6's review).
 */
export function comingPlanned(
  press:
    | {
        readonly managed?: ReadonlyArray<string> | undefined;
        readonly runtimes?: ReadonlyArray<RecipeRuntime> | undefined;
      }
    | undefined,
  made: NewProjectBirth | undefined,
): {
  readonly managed?: ReadonlyArray<string>;
  readonly runtimes?: ReadonlyArray<RecipeRuntime>;
} {
  const managed = press?.managed ?? (made === undefined ? undefined : creationManaged(made));
  const runtimes = press?.runtimes ?? (made === undefined ? undefined : creationRuntimes(made));
  return {
    ...(managed === undefined ? {} : { managed }),
    ...(runtimes === undefined ? {} : { runtimes }),
  };
}

const REGISTRATION_REFUSED = "It was refused.";

/** Each step of a press, by the runner's steps that make it. */
const PRESS_KINDS = {
  created: ["create-project", "import-project", "import-managed"],
  container: ["import-container"],
  "closed-off": ["close-off"],
} as const satisfies Record<string, ReadonlyArray<EnvironmentCreationStep["kind"]>>;

/** A step of the press as its entries say it: stopped, through, under way, or not begun. */
function pressedStep(
  progress: ReadonlyArray<EnvironmentCreationStepProgress> | null,
  kinds: ReadonlyArray<EnvironmentCreationStep["kind"]>,
): { readonly state: ArrivalSubstep["state"]; readonly error?: string } | null {
  const own = (progress ?? []).filter((entry) => kinds.includes(entry.step.kind));
  if (own.length === 0) return null;
  const failed = own.find((entry) => entry.state === "failed");
  if (failed !== undefined) {
    return { state: "failed", ...(failed.error === undefined ? {} : { error: failed.error }) };
  }
  if (own.every((entry) => entry.state === "done")) return { state: "done" };
  return {
    state: own.some((entry) => entry.state === "running" || entry.state === "done")
      ? "active"
      : "waiting",
  };
}

/** The registration receipt's line, retained even when the originating press is gone. */
export function registrationSubstep(name: string, registration: MateRegistration): ArrivalSubstep {
  return registration.state === "unfinished"
    ? {
        id: "registered",
        label: "Not registered",
        state: "unfinished",
        why: asSentence(registration.reason) || REGISTRATION_REFUSED,
      }
    : { id: "registered", label: `${name} registered`, state: registration.state };
}

/**
 * The steps this tab runs for a creation, as its view draws them under its project's row: a New
 * project registered and created, then its Mate registered, its container imported and closed
 * off; an added Mate follows the same HQ order after its copy is created. Each step carries its
 * state and the full reason when it stops. A refused registration offers Finish setup. Its Mate's
 * steps are its press's (`progress`, null before the press begins).
 */
export function creationSubsteps(
  birth: NewProjectBirth,
  progress: ReadonlyArray<EnvironmentCreationStepProgress> | null,
  registration: MateRegistration = { attempt: 0, state: "waiting" },
): ReadonlyArray<ArrivalSubstep> {
  const said = (
    id: string,
    label: string,
    state: ArrivalSubstep["state"],
    why?: string,
  ): ArrivalSubstep => ({ id, label, state, ...(why === undefined ? {} : { why }) });
  const fromPress = (id: keyof typeof PRESS_KINDS, label: string): ArrivalSubstep => {
    const step = pressedStep(progress, PRESS_KINDS[id]);
    if (step === null) return said(id, label, "waiting");
    return said(id, label, step.state, step.state === "failed" ? step.error : undefined);
  };
  const registered = registrationSubstep(birth.botName, registration);
  if (birth.adds === undefined) {
    const own = (id: string, label: string, step: NewProjectStep): ArrivalSubstep => {
      const state = stateOf(birth, step);
      return said(id, label, state, state === "failed" ? birth.failed?.reason : undefined);
    };
    return [
      own("registered-project", "Registered", "registry"),
      own("created", "Created", "create"),
      registered,
      fromPress("container", "Container"),
      fromPress("closed-off", "Closed off"),
    ];
  }
  // Before the platform took its project the creation says where it stands; after, its press.
  const pressedCreated = pressedStep(progress, PRESS_KINDS.created);
  const created: ArrivalSubstep =
    birth.failed !== null
      ? said("created", "Created", "failed", birth.failed.reason)
      : birth.projectId === null
        ? said("created", "Created", "active")
        : pressedCreated === null
          ? said("created", "Created", "done")
          : said(
              "created",
              "Created",
              pressedCreated.state,
              pressedCreated.state === "failed" ? pressedCreated.error : undefined,
            );
  return [
    created,
    ...(birth.adds.registers ? [registered] : []),
    fromPress("container", "Container"),
    fromPress("closed-off", "Closed off"),
  ];
}

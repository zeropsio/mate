/**
 * The press: everything a new environment needs the person's rights for, done in the foreground
 * before Add returns (pass 28; the owner: "this should never ever be tied to user having to have
 * browser open"). For a Mate: its project, its key and its container (`ZCP_API_KEY`, with the
 * tier's runtimes for zcp to import on boot), its project closed off, its registration written.
 * Every step is safe to ask again, so a press that stopped resumes where it stopped, and a
 * half-made Mate is finished from its ⋯ menu, in any browser, by an owner or an admin (*Finish
 * setup*) — the same steps.
 *
 * After the press the container does the rest — zcp imports the runtimes and enrolls the Mate with
 * its HQ, which is its Git access, the server starts the stand-up — and any browser, or none, reads
 * where that stands off `/mate/setup.json` (`mateSetup.ts`).
 *
 * This tab keeps what it pressed, in memory, for as long as the screen needs it: where a new
 * environment is drawn before the listing holds it, and where its press stopped and how to try
 * again. Nothing is stored: a reload forgets it, and the listing — the project is tagged into its
 * group at birth — draws the rest.
 */
import {
  PRESS_STEP_ATTEMPTS,
  PRESS_STEP_RETRY_MS,
  PROJECT_ENV_ISOLATION_KEY,
  resumableEnvironmentCreationStep,
  runEnvironmentCreation,
  type BirthPlacement,
  type EnvironmentCreationOutcome,
  type EnvironmentCreationPlatform,
  type EnvironmentCreationStep,
  type EnvironmentCreationStepProgress,
  formatMateFace,
  type RecipeRuntime,
  type ZeropsAgentType,
  type ZeropsApiClient,
  type ZeropsMateFace,
  type ZeropsPlacedBirth,
  heldOf,
  mateContainerOf,
  readMateFace,
  readZeropsMembership,
  severalMatesLine,
  type MateContainer,
} from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { ZeropsServiceId } from "@t3tools/client-runtime/zerops/data";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import {
  attachToApp,
  birthIntentOf,
  type HqEndpoint,
  type HqPlacement,
  type HqStructure,
} from "@t3tools/client-runtime/zerops/hq";
import type * as Effect from "effect/Effect";
import { useEffect, useMemo } from "react";
import { create } from "zustand";

import { onAccountLifetimeClose } from "./accountLifetime";
import {
  browserLocks,
  matePressLockName,
  withExclusiveLock,
  withLockIfFree,
  type LockManagerLike,
} from "./mateLocks";
import { accountHqApi } from "./accountHq";
import { addGroupEnvironment } from "./addGroupEnvironment";
import { createMateRecord, markClosedOffAtHq } from "./hqMateBirth";
import {
  pressSteps,
  pressThrough,
  type PressStepView,
} from "../components/zerops/ZeropsEnvironmentCreationDialog.logic";
import { setUpMateRecord } from "../components/zerops/ZeropsProjectRow.logic";
import { useNewMate } from "./newMate";
import { placedNewProjects, type NewProjectBirth } from "./newProjectBirth";
import {
  runZeropsCommand,
  useZeropsAtomSelections,
  type ZeropsDataContextValue,
} from "./zeropsDataContext";

/** Where a press stands. */
export type MatePressState =
  | { readonly kind: "pressing" }
  /** Every step is through: the container does the rest. */
  | { readonly kind: "pressed" }
  | {
      readonly kind: "failed";
      readonly step: EnvironmentCreationStep["kind"];
      readonly reason: string;
      /** Tries the press again from the step that stopped; null where that is not safe. */
      readonly retry: (() => Promise<void>) | null;
    };

/** A press this tab made, from the moment the platform took its project. */
export interface MatePress {
  readonly projectId: string;
  /** The organization the project was created in — never the one a tab has open now. */
  readonly organizationId: string;
  /** When the platform took the project, wall ms. */
  readonly startedAt: number;
  /** Its group, as the press knew it; null for a project already listed. */
  readonly placement: BirthPlacement | null;
  /** Whether a Mate container comes up at all: false for a stage or a production. */
  readonly container: boolean;
  /** Its copy's managed services, by hostname in the tier's order. */
  readonly managed?: ReadonlyArray<string>;
  /** The runtimes zcp imports on boot, as the plan named them. */
  readonly runtimes?: ReadonlyArray<RecipeRuntime>;
  /** *Finish setup* on a Mate made before, not an Add: its view draws the steps and their end. */
  readonly finishing?: boolean;
  /** Each step's state as the press moves. */
  readonly progress?: ReadonlyArray<EnvironmentCreationStepProgress>;
  /**
   * Why the harden of the Mate it adopts left its key as it was: the platform refused this account
   * the key's write — an admin's, on a key an owner made.
   */
  readonly keyNotLowered?: string;
  readonly state: MatePressState;
}

interface MatePressStore {
  readonly presses: Readonly<Record<string, MatePress>>;
}

const usePressStore = create<MatePressStore>(() => ({ presses: {} }));

onAccountLifetimeClose(() => {
  usePressStore.setState({ presses: {} });
});

/** The platform took the project of a press: it is drawn from now on. */
export function beginPress(press: Omit<MatePress, "state">): void {
  usePressStore.setState((store) => ({
    presses: { ...store.presses, [press.projectId]: { ...press, state: { kind: "pressing" } } },
  }));
}

/** The harden of a Mate a press adopts could not lower its key, for `reason`. */
function noteKeyNotLowered(projectId: string, reason: string): void {
  usePressStore.setState((store) => {
    const press = store.presses[projectId];
    return press === undefined
      ? store
      : { presses: { ...store.presses, [projectId]: { ...press, keyNotLowered: reason } } };
  });
}

/** How long a Mate's row says its Finish setup stopped before the row is the Mate's again. */
export const STOPPED_SHOWN_MS = 10_000;

/**
 * A Finish setup that stopped before the container it was bringing came — at its import, or
 * before any step (its harden, another tab's lock): the one stop its own view answers, with
 * *Try again*. Read off what it brought, never off a step's name: a stop before any step names
 * its close-off. Any other stop leaves a Mate with its container.
 */
function stopStands(press: MatePress): boolean {
  return (
    press.finishing === true &&
    press.container &&
    press.state.kind === "failed" &&
    press.progress?.some(
      (entry) => entry.step.kind === "import-container" && entry.state === "done",
    ) !== true
  );
}

/** A Finish setup that stopped and goes once its row has said so (`stopStands`). */
const stopGoes = (press: MatePress): boolean =>
  press.finishing === true && press.state.kind === "failed" && !stopStands(press);

/**
 * A press ran to its end, or stopped. A Finish setup that stopped on a Mate with its container —
 * one it had, or one it brought before a later step stopped — goes once its row has said so:
 * nothing of that Mate waits on the press, and its menu offers Finish setup again from the
 * platform's facts. One that stopped bringing its container stays, for its own view's *Try again*.
 */
export function settlePress(projectId: string, state: MatePressState): void {
  let stopped: MatePress | undefined;
  usePressStore.setState((store) => {
    const press = store.presses[projectId];
    if (press === undefined) return store;
    const settled = { ...press, state };
    if (stopGoes(settled)) stopped = settled;
    return { presses: { ...store.presses, [projectId]: settled } };
  });
  if (stopped === undefined) return;
  const said = stopped;
  setTimeout(() => {
    if (readMatePress(projectId) === said) forgetPress(projectId);
  }, STOPPED_SHOWN_MS);
}

/** A press moved on: each step's state, kept on a press this tab holds. */
export function progressPress(
  projectId: string,
  progress: ReadonlyArray<EnvironmentCreationStepProgress>,
): void {
  usePressStore.setState((store) => {
    const press = store.presses[projectId];
    if (press === undefined) return store;
    return { presses: { ...store.presses, [projectId]: { ...press, progress } } };
  });
}

/**
 * Whether a press is over at this progress: its project marked closed off — the Mate needs no
 * browser — and its registration through or refused. Its record then goes; *Finish setup*'s after
 * its view has said it is done for a moment ({@link FINISHED_SHOWN_MS}), never waiting for a
 * connect that may not come.
 */
export function pressDoneAt(progress: ReadonlyArray<EnvironmentCreationStepProgress>): boolean {
  return pressThrough(progress);
}

/** How long Finish setup's view says it is done before its record goes. */
export const FINISHED_SHOWN_MS = 4_000;

/** A press is over: its record goes, Finish setup's after its view has said it is done. */
function endPress(projectId: string, finishing: boolean): void {
  if (!finishing) {
    forgetPress(projectId);
    return;
  }
  settlePress(projectId, { kind: "pressed" });
  setTimeout(() => {
    if (readMatePress(projectId)?.state.kind === "pressed") forgetPress(projectId);
  }, FINISHED_SHOWN_MS);
}

/**
 * The presses (or creations) whose Mate has connected: nothing of them is left to say. A *Finish
 * setup* is not one of them: it runs on a Mate that may have been up all along, and ends on its own
 * (`endPress`) once its row has said so.
 */
export function connectedPresses(
  presses: ReadonlyArray<{ readonly projectId: string; readonly finishing?: boolean }>,
  candidates: ReadonlyArray<{ readonly project: { readonly id: string }; readonly group: string }>,
): ReadonlyArray<string> {
  const connected = new Set(
    candidates.flatMap((candidate) =>
      candidate.group === "connected" ? [candidate.project.id] : [],
    ),
  );
  return presses.flatMap((press) =>
    connected.has(press.projectId) && press.finishing !== true ? [press.projectId] : [],
  );
}

/**
 * Ends the presses whose Mate has connected, as the listing reads them — and this tab's creations
 * of them: a creation reads as coming up only until its Mate first connects (`mateComing`).
 */
export function useForgetConnectedPresses(
  candidates: ReadonlyArray<{ readonly project: { readonly id: string }; readonly group: string }>,
): void {
  const presses = useMatePresses();
  const creations = useNewMate((state) => state.creations);
  const forgetCreation = useNewMate((state) => state.forget);
  useEffect(() => {
    for (const projectId of connectedPresses(presses, candidates)) forgetPress(projectId);
  }, [candidates, presses]);
  useEffect(() => {
    for (const projectId of connectedPresses(Object.values(creations), candidates)) {
      forgetCreation(projectId);
    }
  }, [candidates, creations, forgetCreation]);
}

/** The presses in flight in this browser, their project made or not (`whilePressing`). */
let inFlight = 0;
const inFlightListeners = new Set<() => void>();

/**
 * Runs a press — any press's steps, or a New project's creation before them — counted in flight
 * until it ends: the background mints no throwaway meanwhile (`pressesInFlight`), as the press
 * reads the token list each throwaway is written to (E2E 2026-10-03).
 */
export async function whilePressing<T>(run: () => Promise<T>): Promise<T> {
  inFlight += 1;
  if (inFlight === 1) for (const listener of inFlightListeners) listener();
  try {
    return await run();
  } finally {
    inFlight -= 1;
    if (inFlight === 0) for (const listener of inFlightListeners) listener();
  }
}

/** Whether a press is in flight in this browser (`environments.ts`'s `pressInFlight` port). */
export const pressesInFlight = {
  read: (): boolean => inFlight > 0,
  subscribe: (listener: () => void): (() => void) => {
    inFlightListeners.add(listener);
    return () => {
      inFlightListeners.delete(listener);
    };
  },
};

/** The press this tab holds for a project, read outside a render. */
export function readMatePress(projectId: string): MatePress | undefined {
  return usePressStore.getState().presses[projectId];
}

/**
 * Where a Mate's press placed it — its application and its face — as the press knew it when it
 * began; undefined for a press of a stage or a production, or one that placed nothing.
 */
export function matePressPlacement(press: MatePress | undefined): BirthPlacement | undefined {
  return press?.placement?.kind === "mate" ? press.placement : undefined;
}

/**
 * A Mate HQ holds no record of, finished into the application its press placed it in, under the
 * face it was made with — never a new Mate in none (F6b, 2026-10-03).
 */
export function placedMateRegistration(
  hq: HqEndpoint,
  placement: BirthPlacement,
): Extract<PressRegistration, { readonly kind: "mate" }> {
  return {
    hq,
    groupId: placement.groupId,
    kind: "mate",
    mate: { face: placement.face },
    standUp: false,
  };
}

/**
 * What *Finish setup* and *Set up Mate* register for a Mate, by one rule, so neither mints a new
 * Mate where HQ holds one or may yet (F6b, F6c, 2026-10-03):
 *
 * - HQ's structure not read: nothing — a project it places nowhere has no record only once it is;
 * - HQ holds it in its application: there again, under HQ's face, by a registry writer — an
 *   attach that finds it there writes nothing; nothing for anyone else;
 * - HQ holds it in no application: nothing, its record standing;
 * - HQ holds no record of it: into the application its project's birth intent names, under its
 *   face, the attach closing the intent — in any browser; else into the application the press
 *   this tab still holds placed it in, under its face; else, for whoever HQ's rule lets write one,
 *   a new Mate in no application (`setUpMateRecord`) — what a refused attach leaves; else nothing.
 *
 * Its name is none of these: it is its project's in Zerops (D3).
 */
export function mateFinishRegistration(input: {
  readonly hq: HqEndpoint;
  /** HQ's structure is known: only then does a project it places nowhere have no record. */
  readonly hqKnown: boolean;
  /** HQ's structure, where its open birth intents are (`birthIntentOf`). */
  readonly structure: HqStructure | null;
  readonly project: ZeropsCandidate["project"];
  readonly press: MatePress | undefined;
  /** The viewer writes the registry: an owner or an admin (`canWriteRegistry`). */
  readonly writer: boolean;
  /** HQ's rule lets the viewer write the record of a Mate it holds none of (`create_mate_record`). */
  readonly mayCreateRecord: boolean;
  /** The stand-up a new record asks for. */
  readonly standUp: boolean;
  readonly candidates: ReadonlyArray<ZeropsCandidate>;
}): PressRegistration | null {
  if (!input.hqKnown) return null;
  if (heldOf(input.project) !== "none") {
    const { groupId, face } = readZeropsMembership(input.project);
    if (groupId === undefined || !input.writer) return null;
    return {
      hq: input.hq,
      groupId,
      kind: "mate",
      mate: {
        face:
          face?.tint === undefined || face.shape === undefined
            ? undefined
            : { tint: face.tint, shape: face.shape },
      },
      standUp: false,
    };
  }
  const { birth } = readZeropsMembership(input.project);
  const intent = birth === undefined ? undefined : birthIntentOf(input.structure, birth);
  if (birth !== undefined && intent !== undefined) {
    const face = readMateFace(intent.face);
    return {
      hq: input.hq,
      groupId: intent.appId,
      kind: "mate",
      mate: {
        face:
          face?.tint === undefined || face.shape === undefined
            ? undefined
            : { tint: face.tint, shape: face.shape },
      },
      standUp: false,
      intent: birth,
    };
  }
  const placed = matePressPlacement(input.press);
  if (placed !== undefined) return placedMateRegistration(input.hq, placed);
  if (!input.mayCreateRecord) return null;
  const record = setUpMateRecord(input);
  return record === undefined
    ? null
    : { hq: input.hq, kind: "mate-record", record, standUp: input.standUp };
}

/** The project is gone: nothing more is said of it. */
export function forgetPress(projectId: string): void {
  usePressStore.setState((store) => {
    if (store.presses[projectId] === undefined) return store;
    const { [projectId]: _gone, ...rest } = store.presses;
    return { presses: rest };
  });
}

/** Every press this tab made. */
export function useMatePresses(): ReadonlyArray<MatePress> {
  const presses = usePressStore((store) => store.presses);
  return useMemo(() => Object.values(presses), [presses]);
}

/** The press this tab made for a project, if any. */
export function useMatePress(projectId: string | undefined): MatePress | undefined {
  return usePressStore((store) => (projectId === undefined ? undefined : store.presses[projectId]));
}

/**
 * Why a press stopped, in words, while it is stopped — of a Finish setup only a stop bringing its
 * container: any other leaves a Mate with its container, whose row says its setup stopped
 * (`finishSetupRowLine`).
 */
export function pressFailure(press: MatePress | undefined): string | undefined {
  if (press?.finishing === true && !stopStands(press)) return undefined;
  return press?.state.kind === "failed" ? press.state.reason : undefined;
}

/** A Mate closed off and running whose registration was refused: an owner finishes it. */
const AWAITING_OWNER_LINE = "It still needs an owner to register it.";

/** *Finish setup* through its close-off: the container does the rest. */
export const FINISHED_SETUP_LINE =
  "Its setup is finished. It comes up on its own now, with no browser needed.";

/** A key the harden could not lower, and who can. */
const keyNotLoweredLine = (reason: string) =>
  `The Mate's key couldn't be lowered: ${reason.replace(/\.$/u, "")}; an owner can do it.`;

/**
 * *Finish setup* as a Mate's own view draws it: the steps the Add dialog draws, and — once its
 * project is marked closed off — a clear end. Undefined for any other press. A step that stops is
 * said by the press's failure (`pressFailure`), with *Try again*.
 */
export function finishSetupView(press: MatePress | undefined):
  | {
      readonly steps: ReadonlyArray<PressStepView>;
      readonly line: string;
      readonly done: boolean;
    }
  | undefined {
  if (press?.finishing !== true) return undefined;
  const progress = press.progress ?? [];
  const registered = progress.find((entry) => entry.step.kind === "register");
  const steps = pressSteps(progress);
  const done = press.state.kind === "pressed";
  const finished =
    registered?.state === "failed"
      ? `${FINISHED_SETUP_LINE} ${AWAITING_OWNER_LINE}`
      : FINISHED_SETUP_LINE;
  return {
    steps,
    line: !done
      ? "Finishing its setup…"
      : press.keyNotLowered === undefined
        ? finished
        : `${finished} ${keyNotLoweredLine(press.keyNotLowered)}`,
    done,
  };
}

/**
 * The presses that make a Mate — an Add's, a New project's — whose conversation the press lands the
 * person in once it connects. Never a Finish setup: it runs on a Mate that is there already, its
 * row says how it went, and the person stays where they pressed it.
 */
export function birthPresses(presses: ReadonlyArray<MatePress>): ReadonlyArray<string> {
  return presses.flatMap((press) => (press.finishing === true ? [] : [press.projectId]));
}

/** Whether a Finish setup runs on this Mate now: its menu does not offer it again meanwhile. */
export function finishSetupRunning(press: MatePress | undefined): boolean {
  return press?.finishing === true && press.state.kind === "pressing";
}

/**
 * *Finish setup* as its Mate's row says it, on every screen — its own view draws the steps only
 * while its container is missing: running, through for the moment its record stays
 * (`FINISHED_SHOWN_MS`), or stopped, when its menu offers it again. Undefined for any other press.
 */
export function finishSetupRowLine(press: MatePress | undefined): string | undefined {
  if (press?.finishing !== true) return undefined;
  switch (press.state.kind) {
    case "pressing":
      return "Finishing setup…";
    case "pressed":
      return press.keyNotLowered === undefined
        ? "Setup finished"
        : `Setup finished. ${keyNotLoweredLine(press.keyNotLowered)}`;
    case "failed":
      return "Setup stopped";
  }
}

/** Each step of a press, as a person names it where it stopped. */
const PRESS_STEP_NAMES: Readonly<Record<EnvironmentCreationStep["kind"], string>> = {
  "create-project": "Creating the project",
  "import-project": "Creating the project",
  "import-managed": "Adding its services",
  "import-recipe": "Adding its services",
  "import-container": "Adding its container",
  "close-off": "Closing the project off",
  register: "Registering it",
  "await-ready": "Waiting for it",
};

/** Where a press stopped and why, in one line: "Closing the project off stopped: …". */
export function pressFailureLine(press: MatePress | undefined): string | undefined {
  if (press?.state.kind !== "failed") return undefined;
  return `${PRESS_STEP_NAMES[press.state.step]} stopped: ${press.state.reason}`;
}

/** A press as `mateComing` reads it. */
export function pressComing(press: MatePress | undefined):
  | {
      readonly startedAt: number;
      readonly container: boolean;
      readonly retryable: boolean;
    }
  | undefined {
  if (press === undefined) return undefined;
  return {
    startedAt: press.startedAt,
    // A Finish setup that stopped with its Mate's container brings nothing more: it is not coming.
    container: press.container && !stopGoes(press),
    retryable: press.state.kind === "failed" && press.state.retry !== null,
  };
}

/** Where a Mate this tab pressed stands, as every surface asks `mateComing` about it. */
export function pressComingInput(
  presses: ReadonlyArray<MatePress>,
  projectId: string,
): {
  readonly press: ReturnType<typeof pressComing>;
  readonly setUpFailed: string | undefined;
} {
  const press = presses.find((entry) => entry.projectId === projectId);
  return { press: pressComing(press), setUpFailed: pressFailure(press) };
}

/**
 * The creations this tab pressed in the organization in view, as the group tree places them
 * (`deriveZeropsGroups`' `births`): the projects page and the left menu read this one mapping, so
 * the two draw the same pending members. A press on a project already listed places nothing. The
 * New projects this tab is still making come after them, drawn from their press.
 */
export function placedPressesIn(
  presses: ReadonlyArray<MatePress>,
  organizationId: string | undefined,
  made: ReadonlyArray<NewProjectBirth> = [],
): ReadonlyArray<ZeropsPlacedBirth> {
  return [
    ...presses.flatMap(({ projectId, organizationId: madeIn, startedAt, placement }) =>
      placement === null || organizationId === undefined || madeIn !== organizationId
        ? []
        : [{ projectId, startedAt, placement }],
    ),
    ...placedNewProjects(made, organizationId),
  ];
}

// ── The press's ports ────────────────────────────────────────────────────────────────────────

/** What a press acts through: the account's command layer and its API client. */
export interface PressInputs {
  readonly client: ZeropsApiClient;
  readonly data: Pick<ZeropsDataContextValue, "runtime" | "organizationRef" | "projectRef">;
  readonly organizationId: string;
}

/**
 * The group registration a press writes, as the person who pressed may write it: into the
 * organization's HQ, a Mate with its face and its birth — in its application, or in none where HQ
 * holds no record of it — a stage or a production as an environment of its application, keyed.
 * A Mate's name is its project's in Zerops (D3), and none of HQ's.
 */
export type PressRegistration = {
  /** The organization's HQ, where the registry lives. */
  readonly hq: HqEndpoint;
} & (
  | {
      readonly kind: "mate";
      /** The project's group: its application in HQ. */
      readonly groupId: string;
      /** Its face as picked; none where the press gives it its name's own. */
      readonly mate: { readonly face: ZeropsMateFace | undefined };
      /**
       * The person pressing asks for its stand-up, in its attach; one that closes a birth intent
       * takes the intent's ask instead.
       */
      readonly standUp: boolean;
      /** The birth intent its project was created under: the attach closes it. */
      readonly intent?: string;
    }
  | {
      /** A Mate HQ holds no record of, set up in no application (`POST /api/mates`). */
      readonly kind: "mate-record";
      /** Its face as HQ records it (`setUpMateRecord`). */
      readonly record: { readonly face: string };
      /** The person pressing asks for its stand-up, with its record. */
      readonly standUp: boolean;
    }
  | {
      readonly kind: "stage" | "production";
      /** The project's group: its application in HQ. */
      readonly groupId: string;
    }
);

/**
 * The `register` step: a Mate's record in HQ — attached to its application, or in none — with its
 * stand-up ask in the same write, naming `serviceId`, its zcp service, where its project holds it
 * already (one Mate per project, audit D2); for a stage or a production, `addGroupEnvironment` —
 * the attachment and its deploy key. Each write reads what is there first, so asking again writes
 * nothing twice.
 */
export function pressRegistration(
  inputs: PressInputs,
  registration: PressRegistration,
  serviceId?: string,
): (projectId: string) => Promise<void> {
  const hq = accountHqApi(inputs.client, inputs.organizationId, registration.hq);
  const service = serviceId === undefined ? {} : { serviceId };
  return async (projectId) => {
    if (registration.kind === "mate-record") {
      await createMateRecord(hq, {
        projectId,
        ...registration.record,
        standUp: registration.standUp,
        ...service,
      });
      return;
    }
    if (registration.kind === "mate") {
      await attachToApp(hq, registration.groupId, {
        projectId,
        kind: "mate",
        mate: {
          // Empty where none was picked: the Mate wears its name's tint.
          face: registration.mate.face === undefined ? "" : formatMateFace(registration.mate.face),
          standUp: registration.standUp,
          ...service,
        },
        ...(registration.intent === undefined ? {} : { birth: registration.intent }),
      });
      return;
    }
    const added = await addGroupEnvironment({
      client: inputs.client,
      hq,
      clientId: inputs.organizationId,
      groupId: registration.groupId,
      environment: { tier: registration.kind, project: projectId },
    });
    if (added.failed !== undefined) throw new Error(added.failed.reason);
  };
}

/** How long one command of a press is given to answer before the try counts as failed. */
export const PRESS_CALL_CAP_MS = 60_000;

/** What a press's command that did not answer in time says, and the press with it once it stops. */
export const PRESS_CALL_SILENT = "Zerops did not answer within a minute, so the setup stopped.";

/**
 * One command of a press, given {@link PRESS_CALL_CAP_MS} to answer: one that has not is ended
 * where it stands — never sent where it had not been — and its try fails, to be tried again as
 * the step's tries are. A command that never answered held Dan's press "pressing" for two hours,
 * its workspace's clock running on (F6b, 2026-10-03).
 */
async function answered<Value, Failure>(
  command: Effect.Effect<{ readonly value: Value }, Failure>,
): Promise<Value> {
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), PRESS_CALL_CAP_MS);
  try {
    return await runZeropsCommand(command, stop.signal);
  } catch (cause) {
    throw stop.signal.aborted ? new Error(PRESS_CALL_SILENT) : cause;
  } finally {
    clearTimeout(timer);
  }
}

/** The press's platform calls, through the account's command layer, each bounded (`answered`). */
export function pressPlatform(
  inputs: PressInputs,
  options: {
    /** Null where the press writes no registration. */
    readonly register: ((projectId: string) => Promise<void>) | null;
    /**
     * The organization's HQ, where the close-off is marked. Null where it is not open here: the
     * close-off is then not marked, the press's marker holds the Mate, and *Finish setup* marks it.
     */
    readonly hq: HqEndpoint | null;
    readonly readObservedServices: EnvironmentCreationPlatform["readObservedServices"];
  },
): EnvironmentCreationPlatform {
  const { client, data, organizationId } = inputs;
  const organization = data.organizationRef(organizationId);
  const projectOf = (projectId: string) => data.projectRef(organizationId, projectId);
  return {
    createProject: ({ clientId: _clientId, ...input }) =>
      answered(data.runtime.commands.createProject({ organization, ...input })),
    // Reads, not writes: the platform's verdict on what the press made, waited on by the runner.
    readProjectCreation: (input) => client.readProjectCreation(input),
    importDevelopmentContainer: ({ projectId, projectName, agents, setupRuntimesYaml }) =>
      answered(
        data.runtime.commands.importDevelopmentContainer({
          project: projectOf(projectId),
          projectName,
          agents,
          ...(setupRuntimesYaml === undefined ? {} : { setupRuntimesYaml }),
        }),
      ),
    importServices: (projectId, yaml) =>
      answered(data.runtime.commands.importServices(projectOf(projectId), yaml)),
    importProject: ({ clientId: _clientId, yaml }) =>
      answered(data.runtime.commands.importProject(organization, yaml)),
    // The same hardening a Mate made before this pass is finished with: for a key the press
    // minted it writes nothing to the key, and closes the project off.
    closeOff: async (projectId) => {
      await answered(data.runtime.commands.isolateProjectEnv(projectOf(projectId)));
    },
    readIsolation: async (projectId) =>
      (await client.readProjectEnv(organizationId, projectId)).find(
        (entry) => entry.key === PROJECT_ENV_ISOLATION_KEY,
      )?.content,
    markClosedOff: async (projectId) => {
      if (options.hq === null) return;
      await markClosedOffAtHq(accountHqApi(client, organizationId, options.hq), projectId);
    },
    register: async (projectId) => {
      await options.register?.(projectId);
    },
    readObservedServices: options.readObservedServices,
  };
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Runs a press's steps and settles its record: through, or stopped at a step with the reason and
 * — where the step is safe to ask again — a way to try again from it, on the same project.
 */
export async function runPress(input: {
  readonly organizationId: string;
  readonly steps: ReadonlyArray<EnvironmentCreationStep>;
  readonly platform: EnvironmentCreationPlatform;
  readonly isCurrent: () => boolean;
  readonly resume?: {
    readonly from: number;
    readonly projectId: string;
    readonly projectName: string;
  };
  readonly onProjectAccepted?: (projectId: string, projectName: string) => void;
  readonly onProgress?: Parameters<typeof runEnvironmentCreation>[0]["onProgress"];
  /** This browser's locks; the page's own where omitted. */
  readonly locks?: LockManagerLike | undefined;
  /** The caller holds the project's press lock already (`finishMateSetup`). */
  readonly heldLock?: boolean;
  /** Between a step's tries and reads; the clock's own where omitted. */
  readonly sleep?: (ms: number) => Promise<void>;
}): Promise<EnvironmentCreationOutcome> {
  const locks = "locks" in input ? input.locks : browserLocks();
  const resume = input.resume;
  // One press or *Finish setup* per project at a time, across this browser's tabs.
  if (resume !== undefined && input.heldLock !== true) {
    return withLockIfFree(
      locks,
      matePressLockName(resume.projectId),
      () => pressRun({ ...input, locks, heldLock: true }),
      () => pressedElsewhere(input, resume),
    );
  }
  return pressRun({ ...input, locks });
}

/** What a press says where another tab is running one for the project. */
export const PRESSED_ELSEWHERE = "Its setup is already running in another tab.";

function pressedElsewhere(
  input: Parameters<typeof runPress>[0],
  resume: NonNullable<Parameters<typeof runPress>[0]["resume"]>,
): EnvironmentCreationOutcome {
  const failedStep = input.steps[resume.from] ?? input.steps[0]!;
  if (input.isCurrent()) {
    settlePress(resume.projectId, {
      kind: "failed",
      step: failedStep.kind,
      reason: PRESSED_ELSEWHERE,
      retry: async () => {
        settlePress(resume.projectId, { kind: "pressing" });
        await runPress(input);
      },
    });
  }
  return { ok: false, projectId: resume.projectId, failedStep, error: PRESSED_ELSEWHERE };
}

async function pressRun(
  input: Parameters<typeof runPress>[0],
): Promise<EnvironmentCreationOutcome> {
  let projectName = input.resume?.projectName ?? "";
  for (const step of input.steps) {
    if (step.kind === "create-project" || step.kind === "import-project") projectName = step.name;
  }
  // Each step's state is kept on the press, once the platform has taken its project.
  let accepted = input.resume?.projectId;
  // A new project's press holds its lock from the moment the platform takes it to its end.
  let ended: () => void = () => undefined;
  const end = new Promise<void>((resolve) => {
    ended = resolve;
  });
  const outcome = await whilePressing(() =>
    runEnvironmentCreation({
      clientId: input.organizationId,
      steps: input.steps,
      platform: input.platform,
      isCurrent: input.isCurrent,
      describeError: zeropsErrorMessage,
      sleep: input.sleep ?? sleep,
      ...(input.resume === undefined ? {} : { resume: input.resume }),
      onProjectAccepted: (projectId) => {
        accepted = projectId;
        if (input.heldLock !== true) {
          void withExclusiveLock(input.locks, matePressLockName(projectId), () => end);
        }
        input.onProjectAccepted?.(projectId, projectName);
      },
      onProgress: (progress) => {
        if (accepted !== undefined && input.isCurrent()) {
          const held = readMatePress(accepted);
          progressPress(accepted, progress);
          // Closed off and registered: the Mate needs no browser, and its press record goes —
          // Finish setup's once its view has said so.
          if (held !== undefined && pressDoneAt(progress))
            endPress(accepted, held.finishing === true);
        }
        input.onProgress?.(progress);
      },
    }),
  ).finally(ended);
  const projectId = outcome.projectId;
  if (projectId === undefined || !input.isCurrent()) return outcome;
  if (outcome.ok) {
    settlePress(projectId, { kind: "pressed" });
    return outcome;
  }
  const from = input.steps.indexOf(outcome.failedStep);
  const retry = resumableEnvironmentCreationStep(outcome.failedStep)
    ? async () => {
        settlePress(projectId, { kind: "pressing" });
        await runPress({ ...input, heldLock: false, resume: { from, projectId, projectName } });
      }
    : null;
  settlePress(projectId, {
    kind: "failed",
    step: outcome.failedStep.kind,
    reason: outcome.error,
    retry,
  });
  return outcome;
}

/**
 * The press's steps on a Mate whose project exists: its container with its key — nothing written
 * where it has one — its project closed off, its registration. A New project's first Mate goes on
 * with them once the platform took its project; *Finish setup* runs them on a half-made Mate, in
 * any browser — for one it adopts, which HQ holds no record of, the close-off also lowers a key
 * still at `ADMIN` and moves it off the project's variables (`hardenMate`). A project holds one
 * Mate (audit D2): one holding several zcp services stops before anything is written, naming them,
 * and the one it holds is the service its record names.
 */
export async function finishMateSetup(input: {
  readonly inputs: PressInputs;
  readonly projectId: string;
  readonly projectName: string;
  /**
   * The container to import where the project has none, with these agents; null where the
   * caller just imported it — a listing read this soon may not show it yet, and a second import
   * would make a second container.
   */
  readonly container: { readonly agents: ReadonlyArray<ZeropsAgentType> } | null;
  /** Null where there is no registry to write it in. */
  readonly registration: PressRegistration | null;
  /** The organization's HQ, where the close-off is marked; null where it is not open here. */
  readonly hq: HqEndpoint | null;
  readonly isCurrent: () => boolean;
  /**
   * A Mate adopted — one HQ holds no record of: its key lowered from `ADMIN`, its delegations
   * dropped and its key moved off the project's variables (`hardenMate`) before the steps run.
   */
  readonly harden?: boolean;
  /** Each step's state as the press moves, for a dialog that stays on it. */
  readonly onProgress?: (progress: ReadonlyArray<EnvironmentCreationStepProgress>) => void;
  /** This browser's locks; the page's own where omitted. */
  readonly locks?: LockManagerLike | undefined;
  /** Between the harden's tries; the clock's own where omitted. */
  readonly sleep?: (ms: number) => Promise<void>;
}): Promise<EnvironmentCreationOutcome> {
  const locks = "locks" in input ? input.locks : browserLocks();
  // The whole of it holds the project's press lock: no other tab presses it meanwhile.
  return withLockIfFree(
    locks,
    matePressLockName(input.projectId),
    () => finishLocked({ ...input, locks }),
    () => {
      if (input.isCurrent()) {
        settlePress(input.projectId, {
          kind: "failed",
          step: "close-off",
          reason: PRESSED_ELSEWHERE,
          retry: async () => {
            settlePress(input.projectId, { kind: "pressing" });
            await finishMateSetup(input);
          },
        });
      }
      return {
        ok: false,
        projectId: input.projectId,
        failedStep: { kind: "close-off" },
        error: PRESSED_ELSEWHERE,
      };
    },
  );
}

/**
 * An attempt tried again while it fails, a little apart, up to the press's own tries: what a
 * pool-claimed Mate's harden and *Finish setup*'s get.
 */
export async function withPressTries(
  attempt: () => Promise<void>,
  wait: (ms: number) => Promise<void> = sleep,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly error: string }> {
  for (let tried = 1; ; tried += 1) {
    try {
      await attempt();
      return { ok: true };
    } catch (cause) {
      if (tried >= PRESS_STEP_ATTEMPTS) return { ok: false, error: zeropsErrorMessage(cause) };
      await wait(PRESS_STEP_RETRY_MS);
    }
  }
}

/** The id of the key the Mate of `input.projectId` named to HQ; none where HQ does not say one. */
async function mateKeyAtHq(input: Parameters<typeof finishMateSetup>[0]): Promise<string | null> {
  if (input.hq === null) return null;
  try {
    return await accountHqApi(input.inputs.client, input.inputs.organizationId, input.hq).mateKey(
      input.projectId,
    );
  } catch {
    // HQ not answering, or not telling this person: the harden matches the token list instead.
    return null;
  }
}

/**
 * The Mate's zcp service of the project, one Mate per project (audit D2): its id where the project
 * holds one, none where it holds none yet; a project holding several is refused, naming them.
 */
async function mateServiceOf(
  input: Parameters<typeof finishMateSetup>[0],
): Promise<
  | { readonly ok: true; readonly serviceId: string | undefined }
  | { readonly ok: false; readonly error: string }
> {
  const read: { container?: MateContainer } = {};
  const listed = await withPressTries(async () => {
    read.container = mateContainerOf(
      await input.inputs.client.listProjectServices(input.projectId),
    );
  }, input.sleep);
  if (!listed.ok) return listed;
  const container = read.container ?? { kind: "none" };
  if (container.kind === "several") return { ok: false, error: severalMatesLine(container.names) };
  return { ok: true, serviceId: container.kind === "one" ? container.service.id : undefined };
}

/** A Finish setup stopped at `failedStep` before its steps ran, with Try again: it runs again, whole. */
function finishStopped(
  input: Parameters<typeof finishMateSetup>[0],
  failedStep: EnvironmentCreationStep,
  error: string,
): EnvironmentCreationOutcome {
  if (input.isCurrent()) {
    settlePress(input.projectId, {
      kind: "failed",
      step: failedStep.kind,
      reason: error,
      retry: async () => {
        settlePress(input.projectId, { kind: "pressing" });
        await finishMateSetup(input);
      },
    });
  }
  return { ok: false, projectId: input.projectId, failedStep, error };
}

async function finishLocked(
  input: Parameters<typeof finishMateSetup>[0],
): Promise<EnvironmentCreationOutcome> {
  const steps: ReadonlyArray<EnvironmentCreationStep> = [
    // Its record in its application before its container (F6b, 2026-10-03): a Finish setup that
    // stops after leaves a Mate HQ holds there. A registration that failed — refused, or failing
    // after its tries — stops nothing: the container and the close-off still run, and the Mate
    // stays in no application until a Finish setup attaches it where its birth intent says.
    ...(input.registration === null ? [] : [{ kind: "register" } as const]),
    ...(input.container === null
      ? []
      : [{ kind: "import-container", agents: input.container.agents } as const]),
    // Isolated a moment ago by the harden, which the close-off trusts where no container comes
    // after it.
    input.harden === true && input.container === null
      ? { kind: "close-off", isolated: true }
      : { kind: "close-off" },
    { kind: "await-ready", withAgent: true },
  ];
  // Read before anything is written: a project holding several zcp services is no one Mate's, and
  // the one it holds is the Mate its record names.
  const service = await mateServiceOf(input);
  if (!service.ok) return finishStopped(input, steps[0]!, service.error);
  if (input.harden === true) {
    let keyNotLowered: string | null = null;
    // The key its Mate named to HQ by its id, hardened by it alone (audit K3); matched on the token
    // list only where the Mate named none, or HQ does not say.
    const keyTokenId = await mateKeyAtHq(input);
    const hardened = await withPressTries(
      () =>
        runZeropsCommand(
          input.inputs.data.runtime.commands.isolateProjectEnv(
            input.inputs.data.projectRef(input.inputs.organizationId, input.projectId),
            keyTokenId ?? undefined,
          ),
        ).then((hardened) => {
          keyNotLowered = hardened.keyNotLowered;
        }),
      input.sleep,
    );
    // A key the platform refused this account is said, and the adoption goes on (step A, A11).
    if (hardened.ok && keyNotLowered !== null && input.isCurrent()) {
      noteKeyNotLowered(input.projectId, keyNotLowered);
    }
    // The harden is safe to ask again: Finish setup runs again, whole.
    if (!hardened.ok) return finishStopped(input, { kind: "close-off" }, hardened.error);
  }
  return runPress({
    organizationId: input.inputs.organizationId,
    steps,
    platform: pressPlatform(input.inputs, {
      register:
        input.registration === null
          ? null
          : pressRegistration(input.inputs, input.registration, service.serviceId),
      hq: input.hq,
      readObservedServices: async () => [],
    }),
    isCurrent: input.isCurrent,
    resume: { from: 0, projectId: input.projectId, projectName: input.projectName },
    ...(input.onProgress === undefined ? {} : { onProgress: input.onProgress }),
    locks: input.locks,
    heldLock: true,
    ...(input.sleep === undefined ? {} : { sleep: input.sleep }),
  });
}

// ── The press's marker on Mates made elsewhere ───────────────────────────────────────────────

interface MarkedCandidate {
  readonly service?: { readonly id: string } | undefined;
  readonly project: { readonly hq?: HqPlacement | undefined };
}

/** Whether HQ's record of the project's Mate says it is closed off. */
const closedOffAtHq = (candidate: MarkedCandidate): boolean =>
  candidate.project.hq?.mate?.closedOff === true;

/**
 * The zcp services of the Mates whose press was interrupted before its close-off: the container
 * carries the press's marker (`MATE_SETUP_RUNTIMES`) while HQ does not know the project closed off.
 * A marker the store has not read, or could not, says nothing.
 */
export function interruptedPresses(
  candidates: ReadonlyArray<MarkedCandidate>,
  markers: ReadonlyMap<string, boolean | "unknown" | "unread">,
): ReadonlySet<string> {
  return new Set(
    candidates.flatMap((candidate) =>
      candidate.service !== undefined &&
      !closedOffAtHq(candidate) &&
      markers.get(candidate.service.id) === true
        ? [candidate.service.id]
        : [],
    ),
  );
}

/**
 * Which of these Mates' presses were interrupted before their close-off, as the account's store
 * states their containers' variables — the organization's own stream, no read of its own — for
 * every Mate HQ does not know closed off.
 */
export function useInterruptedPresses(
  candidates: ReadonlyArray<
    MarkedCandidate & { readonly project: { readonly id: string; readonly clientId?: string } }
  >,
  data: Pick<ZeropsDataContextValue, "runtime" | "projectRef">,
): ReadonlySet<string> {
  const selections = useMemo(
    () =>
      candidates.flatMap((candidate) =>
        candidate.service === undefined ||
        candidate.project.clientId === undefined ||
        closedOffAtHq(candidate)
          ? []
          : [
              [
                candidate.service.id,
                data.runtime.reads.setupMarker({
                  kind: "service",
                  project: data.projectRef(candidate.project.clientId, candidate.project.id),
                  serviceId: ZeropsServiceId.make(candidate.service.id),
                }),
              ] as const,
            ],
      ),
    [candidates, data],
  );
  const markers = useZeropsAtomSelections(selections);
  return useMemo(() => interruptedPresses(candidates, markers), [candidates, markers]);
}

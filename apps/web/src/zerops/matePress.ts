import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import {
  creationProgress,
  creationPressStoreAtom,
  beginCreationPress,
  recordCreationProgress,
  projectServicesAtom,
} from "@t3tools/client-runtime/data";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { randomUUID } from "~/lib/utils";
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
  acquireHqPressLease,
  hardenMateProject,
  type PressHold,
} from "@t3tools/client-runtime/data";
import type { MateRegistration } from "@t3tools/client-runtime/data";
import {
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
  mateContainerOf,
  readMateFace,
  severalMatesLine,
} from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { hqMateSetupAtom, type HqMateSetup } from "@t3tools/client-runtime/data";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import {
  birthIntentOf,
  heldOf,
  type HqEndpoint,
  type HqStructure,
} from "@t3tools/client-runtime/zerops/hq";
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
import { HQ_UNFOLLOWED, type AccountOperations } from "./accountOperations";
import { addGroupEnvironment } from "./addGroupEnvironment";
import {
  pressSteps,
  pressThrough,
  type PressStepView,
} from "../components/zerops/ZeropsEnvironmentCreationDialog.logic";
import { setUpMateRecord } from "../components/zerops/ZeropsProjectRow.logic";
import { useZeropsAtomSelections } from "./zeropsDataContext";

/** Where a press stands. */
export type MatePressState =
  | { readonly kind: "pressing" }
  /** Every step is through: the container does the rest. */
  | { readonly kind: "pressed" }
  | {
      readonly kind: "failed";
      readonly step: EnvironmentCreationStep["kind"];
      readonly reason: string;
      readonly uncertain?: true;
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
  /**
   * A stopped Finish setup on a Mate with its container has said so (`STOPPED_SHOWN_MS`): its row is
   * the Mate's again, the press kept for its plan (`resumeSetup`).
   */
  readonly stopSaid?: true;
  /** This account lifetime's stopped plan, shared by Try again and Finish setup. */
  readonly resumeSetup?: (
    heldLock: boolean,
    onProgress?: Parameters<typeof runEnvironmentCreation>[0]["onProgress"],
    platform?: EnvironmentCreationPlatform,
  ) => Promise<EnvironmentCreationOutcome>;
}

interface MatePressStore {
  readonly presses: Readonly<
    Record<
      string,
      Omit<MatePress, "state" | "progress"> & {
        readonly requestId: string;
        readonly retry?: (() => Promise<void>) | null;
      }
    >
  >;
}

const usePressStore = create<MatePressStore>(() => ({ presses: {} }));

onAccountLifetimeClose(() => {
  usePressStore.setState({ presses: {} });
});

/** The platform took the project of a press: it is drawn from now on. */
export function beginPress(press: Omit<MatePress, "state">): void {
  const owner = appAtomRegistry.get(creationPressStoreAtom);
  if (owner === null) throw new Error("The account must be ready before starting a press.");
  const stopped = readMatePress(press.projectId);
  const requestId = randomUUID();
  beginCreationPress(owner, requestId, press.organizationId, press.projectId);
  const { progress: suppliedProgress, ...intent } = press;
  const progress =
    suppliedProgress ?? (stopped?.state.kind === "failed" ? stopped.progress : undefined);
  if (progress !== undefined) recordCreationProgress(owner, requestId, { progress });
  usePressStore.setState((store) => ({
    presses: {
      ...store.presses,
      [press.projectId]: {
        ...intent,
        requestId,
        ...(stopped?.state.kind === "failed" && stopped.resumeSetup !== undefined
          ? { resumeSetup: stopped.resumeSetup }
          : {}),
      },
    },
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

/** A stopped Finish setup that already has its container brings nothing more. */
const stoppedWithContainer = (press: MatePress): boolean =>
  press.finishing === true && press.state.kind === "failed" && !stopStands(press);

/** How long a Mate's row says its Finish setup stopped before the row is the Mate's again. */
export const STOPPED_SHOWN_MS = 10_000;

/**
 * Keep a stopped press's reason and receipts until its creator explicitly continues it — nothing
 * tries it again on its own (76a0c48f8). A Finish setup that stopped on a Mate with its container
 * — one it had, or one it brought before a later step stopped — is said, then its row is the
 * Mate's again (restores 6027014ee, 3d194e2e7): nothing of that Mate waits on the press, and its
 * menu offers Finish setup again. One that stopped bringing its container stands, for its own
 * view's *Try again*.
 */
export function recordPressOutcome(
  projectId: string,
  state: MatePressState,
  resumeSetup?: MatePress["resumeSetup"],
): void {
  const intent = usePressStore.getState().presses[projectId];
  const owner = appAtomRegistry.get(creationPressStoreAtom);
  if (intent === undefined || owner === null) return;
  let requestId = intent.requestId;
  if (state.kind === "pressing") {
    requestId = randomUUID();
    const previous = readMatePress(projectId)?.progress;
    beginCreationPress(owner, requestId, intent.organizationId, projectId);
    if (previous !== undefined) recordCreationProgress(owner, requestId, { progress: previous });
  } else {
    const evidence =
      state.kind === "failed"
        ? {
            kind: "failed" as const,
            step: state.step,
            reason: state.reason,
            ...(state.uncertain === true ? { uncertain: true as const } : {}),
          }
        : state;
    recordCreationProgress(owner, requestId, { state: evidence });
  }
  const { resumeSetup: previousResume, retry: _retry, stopSaid: _said, ...held } = intent;
  const continuation =
    state.kind === "failed" && state.uncertain === true
      ? undefined
      : (resumeSetup ?? (state.kind === "pressed" ? undefined : previousResume));
  const next = {
    ...held,
    requestId,
    ...(state.kind === "failed" ? { retry: state.retry } : {}),
    ...(continuation === undefined ? {} : { resumeSetup: continuation }),
  };
  usePressStore.setState((store) => ({ presses: { ...store.presses, [projectId]: next } }));
  const stopped = readMatePress(projectId);
  if (stopped === undefined || !stoppedWithContainer(stopped)) return;
  setTimeout(() => {
    usePressStore.setState((store) =>
      store.presses[projectId] === next
        ? { presses: { ...store.presses, [projectId]: { ...next, stopSaid: true } } }
        : store,
    );
  }, STOPPED_SHOWN_MS);
}

/** The executor reports each observed child result into its retained operation receipt. */
export function progressPress(
  projectId: string,
  progress: ReadonlyArray<EnvironmentCreationStepProgress>,
): void {
  const intent = usePressStore.getState().presses[projectId];
  const owner = appAtomRegistry.get(creationPressStoreAtom);
  if (intent !== undefined && owner !== null)
    recordCreationProgress(owner, intent.requestId, { progress });
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
  recordPressOutcome(projectId, { kind: "pressed" });
  if (!finishing) {
    forgetPress(projectId);
    return;
  }
  setTimeout(() => {
    if (readMatePress(projectId)?.state.kind === "pressed") forgetPress(projectId);
  }, FINISHED_SHOWN_MS);
}

/**
 * The presses whose Mate has connected: nothing of them is left to say. A *Finish
 * setup* is not one of them: it runs on a Mate that may have been up all along, and ends on its own
 * (`endPress`) once its row has said so.
 */
export function connectedPresses(
  presses: ReadonlyArray<{
    readonly projectId: string;
    readonly finishing?: boolean;
    readonly state?: MatePressState;
  }>,
  candidates: ReadonlyArray<{ readonly project: { readonly id: string }; readonly group: string }>,
): ReadonlyArray<string> {
  const connected = new Set(
    candidates.flatMap((candidate) =>
      candidate.group === "connected" ? [candidate.project.id] : [],
    ),
  );
  return presses.flatMap((press) =>
    connected.has(press.projectId) && press.finishing !== true && press.state?.kind !== "failed"
      ? [press.projectId]
      : [],
  );
}

/** Ends the presses whose Mate has connected, as the listing reads them. */
export function useForgetConnectedPresses(
  candidates: ReadonlyArray<{ readonly project: { readonly id: string }; readonly group: string }>,
): void {
  const presses = useMatePresses();
  useEffect(() => {
    for (const projectId of connectedPresses(presses, candidates)) forgetPress(projectId);
  }, [candidates, presses]);
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
  const intent = usePressStore.getState().presses[projectId];
  const owner = appAtomRegistry.get(creationPressStoreAtom);
  if (intent === undefined || owner === null) return undefined;
  const result = appAtomRegistry.get(owner.data.project(creationProgress, intent.requestId));
  if (result === null) return undefined;
  return {
    ...intent,
    progress: result.progress,
    state:
      result.state.kind === "failed"
        ? { ...result.state, retry: intent.retry ?? null }
        : result.state,
  };
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
 * - HQ holds it already, in an application or none: nothing, its record standing;
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
  /** HQ's rule lets the viewer write the record of a Mate it holds none of (`create_mate_record`). */
  readonly mayCreateRecord: boolean;
  /** The stand-up a new record asks for. */
  readonly standUp: boolean;
  readonly candidates: ReadonlyArray<ZeropsCandidate>;
}): PressRegistration | null {
  if (!input.hqKnown) return null;
  if (heldOf(input.project) !== "none") return null;
  const app = input.structure?.apps.find((entry) =>
    entry.births?.some((birth) => birth.projectId === input.project.id),
  );
  const intent = app?.births?.find((birth) => birth.projectId === input.project.id);
  if (app !== undefined && intent !== undefined) {
    const face = readMateFace(intent.face);
    return {
      hq: input.hq,
      groupId: app.id,
      kind: "mate",
      mate: {
        face:
          face?.tint === undefined || face.shape === undefined
            ? undefined
            : { tint: face.tint, shape: face.shape },
      },
      standUp: false,
      intent: intent.id,
    };
  }
  const creation = input.press?.progress?.find(
    (entry) => entry.step.kind === "create-project" || entry.step.kind === "import-project",
  );
  const localId =
    creation !== undefined &&
    (creation.step.kind === "create-project" || creation.step.kind === "import-project")
      ? creation.step.birth
      : undefined;
  const localIntent = localId === undefined ? undefined : birthIntentOf(input.structure, localId);
  if (localId !== undefined && localIntent !== undefined) {
    const face = readMateFace(localIntent.face);
    return {
      hq: input.hq,
      groupId: localIntent.appId,
      kind: "mate",
      mate: {
        face:
          face?.tint === undefined || face.shape === undefined
            ? undefined
            : { tint: face.tint, shape: face.shape },
      },
      standUp: false,
      intent: localId,
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
  const intents = usePressStore((store) => store.presses);
  const atom = useMemo(
    () =>
      Atom.make((get) => {
        const owner = get(creationPressStoreAtom);
        if (owner === null) return [];
        return Object.values(intents).flatMap((intent) => {
          const result = get(owner.data.project(creationProgress, intent.requestId));
          return result === null
            ? []
            : [
                {
                  ...intent,
                  progress: result.progress,
                  state:
                    result.state.kind === "failed"
                      ? { ...result.state, retry: intent.retry ?? null }
                      : result.state,
                },
              ];
        });
      }),
    [intents],
  );
  return useAtomValue(atom);
}
export function useMatePress(projectId: string | undefined): MatePress | undefined {
  return useMatePresses().find((press) => press.projectId === projectId);
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
export function finishSetupView(
  press: MatePress | undefined,
  registration: MateRegistration = { attempt: 0, state: "waiting" },
):
  | {
      readonly steps: ReadonlyArray<PressStepView>;
      readonly line: string;
      readonly done: boolean;
    }
  | undefined {
  if (press?.finishing !== true) return undefined;
  const progress = press.progress ?? [];
  const steps = pressSteps(progress);
  const done = press.state.kind === "pressed";
  const finished =
    registration.state === "unfinished"
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

type CloseOffHold = "open" | "checking" | "awaiting-hq";

/**
 * Whether a Mate's row says the close-off gate holds it: its project is known not closed off, and
 * no Finish setup runs on it in this tab — whose own words say that. Its other holds are said
 * where it is opened (`closeOffHoldOf`): a row it is not opened from waits on nothing.
 */
export function closeOffOpenOf(
  holds: ReadonlyMap<string, CloseOffHold>,
  projectId: string,
  press: MatePress | undefined,
): boolean {
  return holds.get(projectId) === "open" && !finishSetupRunning(press);
}

/**
 * Why the close-off gate holds a Mate, as its own view says it (`mateComing`'s `closeOffHold`) —
 * never silent; none while a Finish setup runs on it in this tab, whose own words say that.
 */
export function closeOffHoldOf(
  holds: ReadonlyMap<string, CloseOffHold>,
  projectId: string,
  press: MatePress | undefined,
): CloseOffHold | undefined {
  return finishSetupRunning(press) ? undefined : holds.get(projectId);
}

/**
 * The projects this browser knows are not closed off yet (`closeOffPending`): a press here that
 * brings a Mate and runs, or stopped, with its close-off not done. Where HQ says nothing, only
 * these are held (`closeOffGate`).
 */
export function closeOffPendingOf(presses: ReadonlyArray<MatePress>): ReadonlySet<string> {
  return new Set(
    presses.flatMap((press) => {
      if (press.state.kind === "pressed") return [];
      const closeOff = press.progress?.find((entry) => entry.step.kind === "close-off");
      const pending =
        closeOff === undefined
          ? (press.progress ?? []).length === 0 && press.container
          : closeOff.state !== "done";
      return pending ? [press.projectId] : [];
    }),
  );
}

/** `closeOffPendingOf` over this tab's presses, as the account's environments port reads it. */
export const closeOffPendingProjects = {
  read: (): ReadonlySet<string> =>
    closeOffPendingOf(
      Object.keys(usePressStore.getState().presses).flatMap((id) => {
        const press = readMatePress(id);
        return press === undefined ? [] : [press];
      }),
    ),
  subscribe: (listener: () => void): (() => void) => usePressStore.subscribe(listener),
};

/**
 * *Finish setup* as its Mate's row says it, on every screen — its own view draws the steps only
 * while its container is missing: running, through for the moment its record stays
 * (`FINISHED_SHOWN_MS`), or stopped, when its menu offers it again. Undefined for any other press,
 * and for a stop already said (`STOPPED_SHOWN_MS`) or on a Mate that is `up`: its sign-in line,
 * its dot and its last message are its own.
 */
export function finishSetupRowLine(
  press: MatePress | undefined,
  mate: { readonly up: boolean } = { up: false },
): string | undefined {
  if (press?.finishing !== true) return undefined;
  if (press.state.kind === "failed" && (press.stopSaid === true || mate.up)) return undefined;
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
    container: press.container && !stoppedWithContainer(press),
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
 * creations this tab is still making come after them, placed from their ask (`placedNewProjects`).
 */
export function placedPressesIn(
  presses: ReadonlyArray<MatePress>,
  organizationId: string | undefined,
  made: ReadonlyArray<ZeropsPlacedBirth> = [],
): ReadonlyArray<ZeropsPlacedBirth> {
  return [
    ...presses.flatMap(({ projectId, organizationId: madeIn, startedAt, placement }) =>
      placement === null || organizationId === undefined || madeIn !== organizationId
        ? []
        : [{ projectId, startedAt, placement }],
    ),
    ...made,
  ];
}

// ── The press's ports ────────────────────────────────────────────────────────────────────────

/** What a press acts through: the account's command layer and its API client. */
export interface PressInputs {
  readonly client: ZeropsApiClient;
  /**
   * The account's operations: each write a press makes, at Zerops or at HQ, run to its end, and
   * HQ's navigation read for what an attach recorded.
   */
  readonly operations: Pick<AccountOperations, "run" | "untilEnvironment">;
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
  const orgId = inputs.organizationId;
  const service = serviceId === undefined ? {} : { serviceId };
  const run: <Intent extends Parameters<PressInputs["operations"]["run"]>[0]>(
    intent: Intent,
  ) => ReturnType<PressInputs["operations"]["run"]> = (intent) =>
    inputs.operations.run(intent, { orgId, unobserved: HQ_UNFOLLOWED });
  return async (projectId) => {
    if (registration.kind === "mate-record") {
      await run({
        kind: "create-mate-record",
        orgId,
        mate: { projectId, ...registration.record, standUp: registration.standUp, ...service },
      });
      return;
    }
    if (registration.kind === "mate") {
      if (registration.intent !== undefined)
        await run({
          kind: "bind-birth",
          orgId,
          appId: registration.groupId,
          birthId: registration.intent,
          projectId,
        });
      await run({
        kind: "attach-project",
        orgId,
        appId: registration.groupId,
        attach: {
          projectId,
          kind: "mate",
          mate: {
            // Empty where none was picked: the Mate wears its name's tint.
            face:
              registration.mate.face === undefined ? "" : formatMateFace(registration.mate.face),
            standUp: registration.standUp,
            ...service,
          },
          ...(registration.intent === undefined ? {} : { birth: registration.intent }),
        },
      });
      return;
    }
    const added = await addGroupEnvironment({
      operations: inputs.operations,
      orgId,
      groupId: registration.groupId,
      environment: { tier: registration.kind, project: projectId },
    });
    if (added.failed !== undefined) throw new Error(added.failed.reason);
  };
}

/**
 * What a press stopped by a write that may have landed says beside its reason: its answer was lost
 * or its deadline passed. Only a step that reads what is there before it writes is tried again.
 */
export const PRESS_MAY_HAVE_LANDED =
  "Zerops may have done it anyway: Try again reads what is there before it writes.";

/**
 * The press's platform: its Zerops writes as the account's operations, its close-off marked at HQ,
 * its registration, and the wait for its services on the account's services listing.
 */
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
    readonly untilServicesSettled: EnvironmentCreationPlatform["untilServicesSettled"];
  },
): EnvironmentCreationPlatform {
  const { organizationId } = inputs;
  return {
    run: inputs.operations.run,
    markClosedOff: async (projectId) => {
      if (options.hq === null) return;
      await inputs.operations.run(
        { kind: "mark-closed-off", orgId: organizationId, projectId },
        { orgId: organizationId, unobserved: HQ_UNFOLLOWED },
      );
    },
    register: async (projectId) => {
      await options.register?.(projectId);
    },
    untilServicesSettled: options.untilServicesSettled,
  };
}

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
    readonly serviceName?: string;
  };
  readonly onProjectAccepted?: (projectId: string, projectName: string) => void | Promise<void>;
  readonly onProgress?: Parameters<typeof runEnvironmentCreation>[0]["onProgress"];
  /** This browser's locks; the page's own where omitted. */
  readonly locks?: LockManagerLike | undefined;
  /** The caller holds the project's press lock already (`finishMateSetup`). */
  readonly heldLock?: boolean;
  /**
   * Its hold at HQ, where its organization's HQ is open here (`pressHold`): taken once its project
   * is known, let go at its end; another browser's press holding it stops this one.
   */
  readonly hold?: PressHold | undefined;
}): Promise<EnvironmentCreationOutcome> {
  const locks = "locks" in input ? input.locks : browserLocks();
  const resume = input.resume;
  // One press or *Finish setup* per project at a time, across this browser's tabs.
  if (resume !== undefined && input.heldLock !== true) {
    return withLockIfFree(
      locks,
      matePressLockName(resume.projectId),
      () => pressRun({ ...input, locks, heldLock: true }),
      () => pressedElsewhere(input, resume, PRESSED_ELSEWHERE),
    );
  }
  return pressRun({ ...input, locks });
}

/** What a press says where another tab is running one for the project. */
export const PRESSED_ELSEWHERE = "Its setup is already running in another tab.";

/** What a press says where HQ holds another browser's press of the project (`pressHold`). */
export const PRESSED_IN_ANOTHER_BROWSER = "Its setup is already running in another browser.";

function pressedElsewhere(
  input: Parameters<typeof runPress>[0],
  resume: NonNullable<Parameters<typeof runPress>[0]["resume"]>,
  reason: string,
): EnvironmentCreationOutcome {
  const failedStep = input.steps[resume.from] ?? input.steps[0]!;
  if (input.isCurrent()) {
    recordPressOutcome(resume.projectId, {
      kind: "failed",
      step: failedStep.kind,
      reason,
      retry: async () => {
        recordPressOutcome(resume.projectId, { kind: "pressing" });
        await runPress(input);
      },
    });
  }
  return { ok: false, projectId: resume.projectId, failedStep, error: reason };
}

/**
 * How often a running press renews its hold at HQ, besides each of its steps: once a minute. HQ
 * holds it five minutes from each renewal (`PRESS_HOLD_MS`); a browser wakes a hidden tab's timers
 * at most once a minute (Chrome's intensive throttling), so a press in a background tab keeps its
 * hold with four minutes to spare, and a closed tab's hold runs out within five.
 */

async function pressRun(
  input: Parameters<typeof runPress>[0],
): Promise<EnvironmentCreationOutcome> {
  let projectName = input.resume?.projectName ?? "";
  for (const step of input.steps) {
    if (step.kind === "create-project" || step.kind === "import-project") projectName = step.name;
  }
  // Each step's state is kept on the press, once the platform has taken its project.
  let accepted = input.resume?.projectId;
  // A press on a project that exists holds it at HQ before it writes: another browser's press
  // holding it stops this one before anything is written twice.
  if (input.resume !== undefined && input.hold !== undefined) {
    if ((await input.hold.take(input.resume.projectId)) === "elsewhere") {
      return pressedElsewhere(input, input.resume, PRESSED_IN_ANOTHER_BROWSER);
    }
  }
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
      ...(input.resume === undefined ? {} : { resume: input.resume }),
      onProjectAccepted: async (projectId) => {
        accepted = projectId;
        if (input.heldLock !== true) {
          void withExclusiveLock(input.locks, matePressLockName(projectId), () => end);
        }
        // Its new project is held at HQ from the moment Zerops takes it: nobody else's yet.
        await input.hold?.take(projectId);
        await input.onProjectAccepted?.(projectId, projectName);
      },
      // Followed by its import's own process from now on, in any browser.
      onContainerImported: async ({ processId }) => {
        if (processId !== undefined) await input.hold?.imported(processId);
      },
      onProgress: (progress) => {
        // Each step that moves renews the press's hold, whatever its timers are let do.
        input.hold?.renew();
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
  // A press that went through leaves no record at HQ; one that stopped keeps it, its hold ended.
  void input.hold?.end(outcome.ok);
  const projectId = outcome.projectId;
  if (projectId === undefined || !input.isCurrent()) return outcome;
  if (outcome.ok) {
    recordPressOutcome(projectId, { kind: "pressed" });
    return outcome;
  }
  const from = input.steps.indexOf(outcome.failedStep);
  const resumeSetup: MatePress["resumeSetup"] =
    outcome.uncertain !== true && resumableEnvironmentCreationStep(outcome.failedStep)
      ? async (heldLock, onProgress = input.onProgress, platform = input.platform) => {
          recordPressOutcome(projectId, { kind: "pressing" });
          return runPress({
            ...input,
            heldLock,
            platform,
            ...(onProgress === undefined ? {} : { onProgress }),
            resume: {
              from,
              projectId,
              projectName,
              ...(outcome.serviceName === undefined ? {} : { serviceName: outcome.serviceName }),
            },
          });
        }
      : undefined;
  recordPressOutcome(
    projectId,
    {
      kind: "failed",
      step: outcome.failedStep.kind,
      ...(outcome.uncertain === true ? { uncertain: true as const } : {}),
      reason:
        outcome.uncertain === true ? `${outcome.error} ${PRESS_MAY_HAVE_LANDED}` : outcome.error,
      retry:
        resumeSetup === undefined
          ? null
          : async () => {
              await resumeSetup(false);
            },
    },
    resumeSetup,
  );
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
  /**
   * HQ says the Mate's key reads other projects too (`keyWider`, ADR 0003's fallout): its harden
   * matches that widened key on the token list — HQ never takes it for the Mate's key — takes its
   * sibling grants off, and asks HQ to read the key again.
   */
  readonly keyWider?: boolean;
  /** Each step's state as the press moves, for a dialog that stays on it. */
  readonly onProgress?: (progress: ReadonlyArray<EnvironmentCreationStepProgress>) => void;
  /** This browser's locks; the page's own where omitted. */
  readonly locks?: LockManagerLike | undefined;
}): Promise<EnvironmentCreationOutcome> {
  const locks = "locks" in input ? input.locks : browserLocks();
  // The whole of it holds the project's press lock: no other tab presses it meanwhile.
  return withLockIfFree(
    locks,
    matePressLockName(input.projectId),
    () => finishLocked({ ...input, locks }),
    () => {
      if (input.isCurrent()) {
        recordPressOutcome(input.projectId, {
          kind: "failed",
          step: "close-off",
          reason: PRESSED_ELSEWHERE,
          retry: async () => {
            recordPressOutcome(input.projectId, { kind: "pressing" });
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
 * The Mate's zcp service of the project, one Mate per project (audit D2): its id where the project
 * holds one, none where it holds none yet; a project holding several is refused, naming them.
 */
async function mateServiceOf(
  input: Parameters<typeof finishMateSetup>[0],
): Promise<
  | { readonly ok: true; readonly serviceId: string | undefined }
  | { readonly ok: false; readonly error: string }
> {
  try {
    const container = mateContainerOf(await currentProjectServices(input.projectId));
    if (container.kind === "several")
      return { ok: false, error: severalMatesLine(container.names) };
    return { ok: true, serviceId: container.kind === "one" ? container.service.id : undefined };
  } catch (cause) {
    return { ok: false, error: zeropsErrorMessage(cause) };
  }
}

/** A Finish setup stopped at `failedStep` before its steps ran, with Try again: it runs again, whole. */
function finishStopped(
  input: Parameters<typeof finishMateSetup>[0],
  failedStep: EnvironmentCreationStep,
  error: string,
): EnvironmentCreationOutcome {
  if (input.isCurrent()) {
    recordPressOutcome(input.projectId, {
      kind: "failed",
      step: failedStep.kind,
      reason: error,
      retry: async () => {
        recordPressOutcome(input.projectId, { kind: "pressing" });
        await finishMateSetup(input);
      },
    });
  }
  return { ok: false, projectId: input.projectId, failedStep, error };
}

async function finishLocked(
  input: Parameters<typeof finishMateSetup>[0],
): Promise<EnvironmentCreationOutcome> {
  // A menu can redraw the press before entering here. Its retained plan still owns the
  // stopped step and accepted handles, and its captured account lifetime gates every call.
  const resumeSetup = readMatePress(input.projectId)?.resumeSetup;
  const steps: ReadonlyArray<EnvironmentCreationStep> = [
    // Its record in its application before its container (F6b, 2026-10-03): a Finish setup that
    // stops after leaves a Mate HQ holds there. A failed registration stops here with its birth
    // intent retained, for the creator to finish its setup explicitly.
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
  // Held at HQ while it runs, so another browser neither finishes it too nor reads it half made.
  const hold =
    input.hq === null
      ? undefined
      : acquireHqPressLease(
          accountHqApi(input.inputs.client, input.inputs.organizationId, input.hq),
          {
            kind: "mate",
            active: input.isCurrent,
            appId:
              input.registration !== null && input.registration.kind === "mate"
                ? input.registration.groupId
                : undefined,
          },
          randomUUID(),
        );
  const platform = pressPlatform(input.inputs, {
    register:
      input.registration === null
        ? null
        : pressRegistration(input.inputs, input.registration, service.serviceId),
    hq: input.hq,
    // A Mate's press hands over at the wait for its agent: no services' wait of its own.
    untilServicesSettled: async () => [],
  });
  // The harden first, whatever plan this tab keeps: a kept plan never skips the key's lowering.
  if (input.harden === true) {
    let keyNotLowered: string | null = null;
    try {
      ({ keyNotLowered } = await hardenMateProject({
        api:
          input.hq === null
            ? null
            : accountHqApi(input.inputs.client, input.inputs.organizationId, input.hq),
        orgId: input.inputs.organizationId,
        projectId: input.projectId,
        keyWider: input.keyWider === true,
        active: input.isCurrent,
        run: input.inputs.operations.run,
        unobserved: PRESS_MAY_HAVE_LANDED,
      }));
    } catch (cause) {
      return finishStopped(input, { kind: "close-off" }, zeropsErrorMessage(cause));
    }
    // A key the platform refused this account is said, and the adoption goes on (step A, A11).
    if (keyNotLowered !== null && input.isCurrent()) {
      noteKeyNotLowered(input.projectId, keyNotLowered);
    }
  }
  if (resumeSetup !== undefined) return resumeSetup(true, input.onProgress, platform);
  return runPress({
    organizationId: input.inputs.organizationId,
    steps,
    platform,
    isCurrent: input.isCurrent,
    resume: { from: 0, projectId: input.projectId, projectName: input.projectName },
    ...(input.onProgress === undefined ? {} : { onProgress: input.onProgress }),
    locks: input.locks,
    heldLock: true,
    hold,
  });
}

// ── The press's marker on Mates made elsewhere ───────────────────────────────────────────────

interface MarkedCandidate {
  readonly service?: { readonly id: string } | undefined;
  readonly project: { readonly id: string };
}

/** Finish setup follows HQ's setup evidence, never a navigation read of container variables. */
export function interruptedPresses(
  candidates: ReadonlyArray<MarkedCandidate>,
  setups: ReadonlyMap<string, HqMateSetup>,
): ReadonlySet<string> {
  return new Set(
    candidates.flatMap((candidate) => {
      if (candidate.service === undefined) return [];
      const setup = setups.get(candidate.project.id);
      if (setup === undefined || setup.closedOff === true || setup.marker === false) return [];
      return setup.marker === true || setup.closedOff === false ? [candidate.service.id] : [];
    }),
  );
}

/** The organization's already observed navigation is the sole source of setup marker evidence. */
export function useInterruptedPresses(
  candidates: ReadonlyArray<MarkedCandidate>,
): ReadonlySet<string> {
  const selections = useMemo(
    () =>
      candidates.flatMap((candidate) =>
        candidate.service === undefined
          ? []
          : [[candidate.project.id, hqMateSetupAtom(candidate.project.id)] as const],
      ),
    [candidates],
  );
  const setups = useZeropsAtomSelections(selections);
  return useMemo(() => interruptedPresses(candidates, setups), [candidates, setups]);
}

async function currentProjectServices(projectId: string) {
  const atom = projectServicesAtom(projectId);
  const mounted = appAtomRegistry.mount(atom);
  try {
    const read = appAtomRegistry.get(atom);
    if (read.services === undefined || !read.live || read.unavailableReason !== undefined)
      throw new Error(
        "The project's current services are unavailable. Try Finish setup after they are read.",
      );
    return read.services;
  } finally {
    mounted();
  }
}

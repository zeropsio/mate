import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import {
  creationProgress,
  creationPressStoreAtom,
  beginCreationPress,
  recordCreationProgress,
} from "@t3tools/client-runtime/data";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { randomUUID } from "~/lib/utils";
/**
 * The press: everything a new environment needs the person's rights for, done in the foreground
 * before Add returns (pass 28; the owner: "this should never ever be tied to user having to have
 * browser open"). For a Mate: its project, its registration written, and one import of its
 * container with its key (`ZCP_API_KEY`) beside its tier's services, into a project whose
 * isolation admits the container to every service.
 * Every step is safe to ask again, so a stopped birth can resume where it stopped.
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
  type BirthIntent,
  type BirthPlacement,
  type EnvironmentCreationStep,
  type EnvironmentCreationStepProgress,
  formatMateFace,
  type RecipeRuntime,
  newMateTint,
  projectNameInApp,
} from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { MATE_SHAPE_OF_TINT } from "@t3tools/shared/brand";
import { useEffect, useMemo } from "react";
import { create } from "zustand";

import { onAccountLifetimeClose } from "./accountLifetime";
import { pressThrough } from "@t3tools/client-runtime/zerops/newMateDoor";

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
  /**
   * The person's first press of the Add that made it, wall ms (`pressSince`): a press tried again
   * is taken later. A New project's press starts on its first press already.
   */
  readonly pressedAt?: number;
  /** Its group, as the press knew it; null for a project already listed. */
  readonly placement: BirthPlacement | null;
  /** Whether a Mate container comes up at all: false for a stage or a production. */
  readonly container: boolean;
  /** Its copy's managed services, by hostname in the tier's order. */
  readonly managed?: ReadonlyArray<string>;
  /** The runtimes zcp imports on boot, as the plan named them. */
  readonly runtimes?: ReadonlyArray<RecipeRuntime>;
  /** Each step's state as the press moves. */
  readonly progress?: ReadonlyArray<EnvironmentCreationStepProgress>;
  readonly state: MatePressState;
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

/**
 * When a Mate's setup began, as every clock of it counts — its menu row, its card, its own view
 * (board D1, 2026-09-30; the owner, 2026-10-15: one time for one Mate): the first press of the
 * Create or Add that made it, through any Try again; else when the platform took its press.
 */
export function pressSince(press: Pick<MatePress, "startedAt" | "pressedAt">): number {
  return press.pressedAt ?? press.startedAt;
}

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
      [press.projectId]: { ...intent, requestId },
    },
  }));
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

/** Whether every step before the wait is through and its registration completed or was refused. */
export function pressDoneAt(progress: ReadonlyArray<EnvironmentCreationStepProgress>): boolean {
  return pressThrough(progress);
}

/**
 * The presses whose Mate has connected: nothing of them is left to say.
 */
export function connectedPresses(
  presses: ReadonlyArray<{
    readonly projectId: string;
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
    connected.has(press.projectId) && press.state?.kind !== "failed" ? [press.projectId] : [],
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
 * until it ends (`pressesInFlight`): the page holds its reload and its leave while one runs.
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

/** Whether a press is in flight in this browser. */
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
 * The one Create of a Mate on a project that exists — *Set up Mate* and *Enable* (`POST /api/births`
 * with `projectId`): HQ's operation grants `owner` the project first, records the Mate, mints its
 * key, and imports its container or turns on and restarts the one it holds; the tab writes none of
 * it. Its face is the one HQ records for the Mate already, else the tint its name gets among the
 * account's (`newMateTint`) and that tint's shape; its name is its project's in Zerops (D3).
 */
export function mateSetUpBirth(input: {
  readonly id: string;
  readonly project: ZeropsCandidate["project"];
  readonly candidates: ReadonlyArray<ZeropsCandidate>;
  /** The application it is adopted into; HQ places it otherwise. */
  readonly appId?: string | undefined;
  readonly agents: BirthIntent["agents"];
  /** Whom its operation grants `OWNER` on the project (`ownerAtAdd`); none where nobody. */
  readonly owner: string | null;
}) {
  const recorded = input.project.hq?.mate?.face;
  const tint = newMateTint(input.candidates, input.project.name);
  return {
    id: input.id,
    projectId: input.project.id,
    ...(input.appId === undefined ? {} : { appId: input.appId }),
    face:
      recorded === undefined || recorded === ""
        ? formatMateFace({ tint, shape: MATE_SHAPE_OF_TINT[tint] })
        : recorded,
    intent: {
      projectName: input.project.name,
      recipe: { kind: "none" },
      agents: input.agents,
      standUp: false,
      automated: false,
      placement: { role: "dev", name: projectNameInApp(input.project), chief: false },
      location: null,
      userRoles: [],
    } satisfies BirthIntent,
    ...(input.owner === null ? {} : { owner: input.owner }),
  };
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

/** Why a press stopped, in words, while it is stopped. */
export function pressFailure(press: MatePress | undefined): string | undefined {
  return press?.state.kind === "failed" ? press.state.reason : undefined;
}

/** Presses that make a Mate, whose conversation opens once it connects. */
export function birthPresses(presses: ReadonlyArray<MatePress>): ReadonlyArray<string> {
  return presses.map((press) => press.projectId);
}

/** Each step of a press, as a person names it where it stopped. */
const PRESS_STEP_NAMES: Readonly<Record<EnvironmentCreationStep["kind"], string>> = {
  "create-project": "Creating the project",
  "import-project": "Creating the project",
  "import-recipe": "Adding its services",
  "import-container": "Adding its computer",
  register: "Adding it to HQ",
  "await-ready": "Waiting for it",
};

/** Where a press stopped and why, in one line: "Making its network private stopped: …". */
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
      readonly state: MatePressState["kind"];
      readonly uncertain?: true;
    }
  | undefined {
  if (press === undefined) return undefined;
  return {
    startedAt: pressSince(press),
    container: press.container,
    retryable: press.state.kind === "failed" && press.state.retry !== null,
    state: press.state.kind,
    ...(press.state.kind === "failed" && press.state.uncertain === true
      ? { uncertain: true as const }
      : {}),
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
 * What a press stopped by a write that may have landed says beside its reason: its answer was lost
 * or its deadline passed. Only a step that reads what is there before it writes is tried again.
 */
export const PRESS_MAY_HAVE_LANDED =
  "Zerops may have done it anyway: Try again reads what is there before it writes.";

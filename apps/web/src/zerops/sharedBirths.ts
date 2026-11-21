import {
  sharedBirthsAtom,
  type MateComing,
  type SharedBirth,
  type SharedBirthState,
} from "@t3tools/client-runtime/data";
import { readMateFace, type ZeropsPlacedBirth } from "@t3tools/client-runtime/zerops";
import { useAtomValue } from "@effect/atom-react";
import { useZeropsSession } from "./ZeropsSessionProvider";

/** A birth that stopped, on a list's row: how far it got, in one statement that fits the row. */
const ROW_STOPPED: Record<SharedBirth["progress"]["phase"], string> = {
  "creating-project": "Setup stopped while creating its project",
  "project-created": "Setup stopped after its project was created",
  "import-accepted": "Setup stopped while its services were being made",
  "container-starting": "Setup stopped while its computer was starting",
};

/** A birth under way, on a list's row. */
const ROW_GOING: Record<SharedBirth["progress"]["phase"], string> = {
  "creating-project": "Creating its project…",
  "project-created": "Its project is made, setting it up…",
  "import-accepted": "Making its services…",
  "container-starting": "Starting its computer…",
};

const FAILURE_STEP = {
  create: "Creating project",
  watch: "Waiting for project",
  access: "Granting project access",
  settings: "Updating project settings",
  key: "Creating project key",
  import: "Importing services",
  restart: "Restarting the Mate service",
};

/** An operation HQ holds for its maker's Continue: to them, and to everyone else. */
const WAITS_FOR_MAKER = {
  maker: "Its Zerops sign-in ran out before it finished.",
  other: "Its maker can continue it.",
};

export function sharedBirthPresentation(birth: SharedBirth): {
  /** Everything known, for the birth's own page: its phase, why it stopped, who can continue. */
  readonly line: string;
  /**
   * One statement for a list's row, which opens the birth's own page for the rest: "Setup stopped
   * while creating its project".
   */
  readonly row: string;
  readonly attention: boolean;
  readonly actions: ReadonlyArray<"continue-operation" | "delete">;
} {
  const { phase, next, reason } = birth.progress;
  const phaseLine = {
    "creating-project": "Creating project",
    "project-created": "Project created",
    "import-accepted": "Import accepted",
    "container-starting": "Container starting",
  }[phase];
  const failedStep = birth.progress.failedStep;
  const waiting =
    next.kind === "continue"
      ? WAITS_FOR_MAKER.maker
      : next.kind === "wait" && next.for === "maker"
        ? WAITS_FOR_MAKER.other
        : null;
  const failure =
    waiting ??
    (failedStep === undefined ? null : `${FAILURE_STEP[failedStep]} · Zerops refused: ${reason}`);
  const detail =
    reason ??
    (next.kind === "unknown"
      ? "Outcome unknown — waiting for Zerops"
      : next.kind === "blocked"
        ? "Zerops reported that the step failed or was canceled"
        : next.kind === "wait"
          ? {
              hq: null,
              maker: WAITS_FOR_MAKER.other,
              "service-observation": "Waiting for Zerops service information",
              service: "The Mate service has not appeared in Zerops",
              "several-services": "Several Mate services are present in the project",
              container: "Waiting for the Mate container to start",
              hello: "Waiting for the Mate to link",
            }[next.for]
          : null);
  const attention =
    reason !== null ||
    next.kind === "unknown" ||
    next.kind === "blocked" ||
    (next.kind === "wait" && next.for === "several-services");
  return {
    row: failure ?? (attention ? ROW_STOPPED : ROW_GOING)[phase],
    line:
      failure ??
      (next.kind === "wait" && next.for === "hq"
        ? ROW_GOING[phase]
        : [phaseLine, detail].filter((part) => part !== null).join(" · ")),
    attention,
    actions: [
      ...(next.kind === "continue" ? ["continue-operation" as const] : []),
      ...(birth.canDelete ? ["delete" as const] : []),
    ],
  };
}

/**
 * A Mate's coming while HQ's birth of it is open, from the press to its hello, as its listed row
 * says it: the birth's row line and HQ's clock of it (`startedAt`, when HQ accepted its
 * operation) — never a clock of the tab that pressed, so every device draws one line and one time.
 */
export function comingOfBirth(birth: SharedBirth): MateComing {
  const shown = sharedBirthPresentation(birth);
  return {
    kind: "coming",
    line: shown.row,
    birth: { attention: shown.attention },
    since: birth.startedAt,
  };
}

/** The organization's births, proven by the account data layer for this person. */
export function useSharedBirthState(): SharedBirthState {
  const { user } = useZeropsSession();
  return useAtomValue(sharedBirthsAtom(user?.id ?? ""));
}

export function useSharedBirths(): ReadonlyArray<SharedBirth> {
  return useSharedBirthState().open;
}

/** A person's Chief remains visible during its shared birth, including after a reload. */
export function useOwnChiefBirth(): SharedBirth | undefined {
  const { user } = useZeropsSession();
  const { open } = useSharedBirthState();
  return user == null
    ? undefined
    : open.find((birth) => birth.chief === true && birth.madeBy === user.id);
}

/** Where a shared birth's Mate is drawn: its application, its kind, its name and face. */
export function birthPlacement(birth: SharedBirth): ZeropsPlacedBirth["placement"] {
  const face = readMateFace(birth.face);
  return {
    groupId: birth.appId,
    groupName: birth.appName,
    kind:
      birth.intent?.placement.role === "stage" || birth.intent?.placement.role === "devstage"
        ? "devstage"
        : "mate",
    displayName: birth.intent?.placement.name ?? "Mate",
    ...(face?.tint === undefined || face.shape === undefined
      ? {}
      : { face: { tint: face.tint, shape: face.shape } }),
  };
}

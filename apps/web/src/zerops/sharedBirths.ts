import {
  accessLostLine,
  birthStopped,
  operationFailureWords,
  outcomeUnknownLine,
  platformErrorLine,
  waitingWords,
  sharedBirthsAtom,
  type MateComing,
  type SharedBirth,
  type SharedBirthState,
  type WaitingPress,
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
  watch: "Setting up project",
  access: "Granting project access",
  settings: "Updating project settings",
  key: "Creating project key",
  import: "Importing services",
  restart: "Restarting the Mate service",
  zerops: "Reaching Zerops",
};

/** A birth HQ holds for its maker's Continue: to them, and to everyone else. */
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
  /** HQ stopped it (`state`): the birth's own card, never its Mate's page. */
  readonly stopped: boolean;
  /** It stopped, or what Zerops shows of its import or container needs a look. */
  readonly attention: boolean;
  readonly actions: ReadonlyArray<"continue-operation" | "delete">;
  /** It waits for its maker's Continue, which HQ does not offer the person reading. */
  readonly waitsOnMaker: boolean;
  /** The word on its Continue's button, by what it waits on. */
  readonly press: WaitingPress;
} {
  const { phase, next, reason } = birth.progress;
  const stopped = birthStopped(birth.state);
  const continues = birth.offers.includes("continue");
  const phaseLine = {
    "creating-project": "Creating project",
    "project-created": "Project created",
    "import-accepted": "Import accepted",
    "container-starting": "Container starting",
  }[phase];
  const waits = birth.state === "waiting_for_maker";
  const platformError =
    birth.failure === undefined
      ? null
      : platformErrorLine(
          birth.failure,
          waits ? (continues ? "continue" : "maker-continues") : "ended",
        );
  const waiting =
    waits && birth.failure?.code === "token_expired"
      ? continues
        ? WAITS_FOR_MAKER.maker
        : WAITS_FOR_MAKER.other
      : null;
  const accessLost =
    waits && birth.failure !== undefined ? accessLostLine(birth.failure, continues) : null;
  const outcomeUnknown =
    waits && birth.failure !== undefined ? outcomeUnknownLine(birth.failure, continues) : null;
  const failure =
    platformError ??
    accessLost ??
    outcomeUnknown ??
    waiting ??
    (birth.failure === undefined
      ? null
      : `${FAILURE_STEP[birth.failure.step]} · ${operationFailureWords(birth.failure)}`);
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
    row: failure ?? (attention ? ROW_STOPPED : ROW_GOING)[phase],
    line:
      failure ??
      (next.kind === "wait" && next.for === "hq"
        ? ROW_GOING[phase]
        : [phaseLine, detail].filter((part) => part !== null).join(" · ")),
    stopped,
    attention,
    waitsOnMaker: waits && !continues,
    press: waitingWords(birth.failure?.code ?? "").press,
    actions: [
      ...(continues ? ["continue-operation" as const] : []),
      ...(birth.offers.includes("delete") || birth.offers.includes("delete_project")
        ? ["delete" as const]
        : []),
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
    birth: { attention: shown.attention, ...(shown.waitsOnMaker ? { waitsOnMaker: true } : {}) },
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

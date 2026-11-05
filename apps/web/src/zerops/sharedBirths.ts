import {
  sharedBirthsAtom,
  type SharedBirth,
  type SharedBirthState,
} from "@t3tools/client-runtime/data";
import { readMateFace, type ZeropsPlacedBirth } from "@t3tools/client-runtime/zerops";
import { useAtomValue } from "@effect/atom-react";
import type { Atom, AtomRegistry } from "effect/reactivity";
import { useZeropsSession } from "./ZeropsSessionProvider";
import { onAccountLifetimeClose } from "./accountLifetime";

/** An answered HQ write is followed by its shared navigation, or stopped when authority is lost. */
export function waitForBirthPlacement(
  registry: AtomRegistry.AtomRegistry,
  source: Atom.Atom<SharedBirthState>,
  input: {
    readonly birthId: string;
    readonly projectId: string;
    readonly placement: "bound" | "attached";
    readonly active: () => boolean;
  },
): Promise<SharedBirth | undefined> {
  return new Promise((resolve) => {
    let ended = false;
    let cancel = () => {};
    let leave = () => {};
    const finish = (birth: SharedBirth | undefined) => {
      if (ended) return;
      ended = true;
      cancel();
      leave();
      resolve(birth);
    };
    const check = () => {
      const birth = registry.get(source).open.find((entry) => entry.id === input.birthId);
      if (
        !input.active() ||
        birth === undefined ||
        !birth.canContinue ||
        (birth.projectId !== null && birth.projectId !== input.projectId)
      ) {
        finish(undefined);
        return;
      }
      if (
        birth.projectId === input.projectId &&
        (input.placement === "bound" || birth.placement === "attached")
      )
        finish(birth);
    };
    leave = onAccountLifetimeClose(() => finish(undefined));
    cancel = registry.subscribe(source, check, { immediate: false });
    check();
  });
}

export function sharedBirthPresentation(birth: SharedBirth): {
  readonly line: string;
  readonly attention: boolean;
  readonly actions: ReadonlyArray<"continue" | "delete">;
} {
  const { phase, next, reason } = birth.progress;
  const phaseLine = {
    "creating-project": "Creating project",
    "project-created": "Project created",
    "import-accepted": "Import accepted",
    "container-starting": "Container starting",
  }[phase];
  const detail =
    reason ??
    (next.kind === "unknown"
      ? "Outcome unknown — waiting for Zerops"
      : next.kind === "blocked"
        ? "Zerops reported that the step failed or was canceled"
        : next.kind === "wait"
          ? {
              creation: "Waiting for project creation to finish",
              "creation-history": "Waiting for project creation history",
              project: "Waiting for Zerops to show the project",
              "service-observation": "Waiting for Zerops service information",
              service: "The Mate service has not appeared in Zerops",
              "several-services": "Several Mate services are present in the project",
              container: "Waiting for the Mate container to start",
              hello: "Waiting for the Mate to link",
            }[next.for]
          : null);
  const step = !birth.canContinue
    ? null
    : next.kind === "create"
      ? "Continue will create the project, attach the Mate, and submit the import."
      : next.kind === "register-chief"
        ? "Continue will register the Chief."
        : next.kind === "bind"
          ? "Continue will bind the project and check the next step."
          : next.kind === "import" && birth.projectId !== null
            ? birth.placement === "unplaced"
              ? "Continue will attach the Mate and submit the import."
              : birth.placement === "attached"
                ? "Continue will submit the import."
                : null
            : next.kind === "record-import"
              ? birth.placement === "unplaced"
                ? "Continue will attach the Mate and record the accepted import."
                : birth.placement === "attached"
                  ? "Continue will record the accepted import."
                  : null
              : next.kind === "wait" && next.attach
                ? "Continue will attach the Mate."
                : null;
  return {
    line: [
      phaseLine,
      birth.progress.sessionEnded === true ? "Setup session ended" : null,
      detail,
      step,
      birth.continueRequiresAdmin === true
        ? "An organization or project administrator can continue."
        : null,
    ]
      .filter((part) => part !== null)
      .join(" · "),
    attention:
      reason !== null ||
      next.kind === "unknown" ||
      next.kind === "blocked" ||
      (next.kind === "wait" && next.for === "several-services") ||
      birth.progress.sessionEnded === true,
    actions: [
      ...(birth.canContinue ? ["continue" as const] : []),
      ...(birth.canDelete ? ["delete" as const] : []),
    ],
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

/** Place shared births ahead of locally pending creations. */
export function placedSharedBirths(
  births: ReadonlyArray<SharedBirth>,
  local: ReadonlyArray<ZeropsPlacedBirth>,
  personId?: string,
): ReadonlyArray<ZeropsPlacedBirth> {
  const ids = new Set(births.map(({ id }) => id));
  const projects = new Set(
    births.flatMap(({ projectId }) => (projectId === null ? [] : [projectId])),
  );
  const shared = births.flatMap((birth): ReadonlyArray<ZeropsPlacedBirth> => {
    if (
      birth.intent?.placement.chief === true &&
      (personId === undefined ||
        birth.madeBy === personId ||
        birth.chiefRegistered !== false ||
        !birth.canContinue)
    )
      return [];
    const face = readMateFace(birth.face);
    return [
      {
        intent: birth.id,
        projectId: birth.projectId ?? birth.id,
        placement: {
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
        },
      },
    ];
  });
  return [
    ...shared,
    ...local.filter(
      (entry) =>
        !ids.has(entry.projectId) &&
        !projects.has(entry.projectId) &&
        (entry.intent === undefined || !ids.has(entry.intent)),
    ),
  ];
}
